#!/usr/bin/env node
// Seed a scaled-up copy of samples.bakehouse into a writable Databricks schema,
// for testing EXPLAIN / full-table-scan flagging (issue #63).
//
// samples.bakehouse is read-only (3,333 transactions), so dimension tables are
// copied and sales_transactions is regenerated at SEED_ROWS with the same columns.
//
// Usage: node scripts/seed-bakehouse.js        (reads DATABRICKS_* from app/.env)
// Env:   SEED_ROWS (default 2000000), SEED_TARGET (default main.bakehouse_seed),
//        SEED_APPEND=1 adds SEED_ROWS more rows to an existing table instead of rebuilding
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const { DBSQLClient } = createRequire(import.meta.url)('@databricks/sql');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  const out = {};
  if (fs.existsSync(p)) {
    for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { ...out, ...process.env };
}

const env = loadEnv();
const ROWS = parseInt(env.SEED_ROWS || '2000000', 10);
const TARGET = env.SEED_TARGET || 'main.bakehouse_seed';
if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(TARGET)) throw new Error('SEED_TARGET must be catalog.schema');
const SRC = 'samples.bakehouse';

const COPY = ['sales_customers', 'sales_franchises', 'sales_suppliers', 'media_customer_reviews', 'media_gold_reviews_chunked'];

const APPEND = env.SEED_APPEND === '1';

// OFFSET shifts transactionIDs and the rand() seeds so appended batches are new rows, not repeats.
const transactionsSql = (offset) => `
${APPEND ? 'INSERT INTO' : 'CREATE OR REPLACE TABLE'} ${TARGET}.sales_transactions ${APPEND ? '' : 'AS'}
WITH pools AS (
  SELECT
    (SELECT collect_list(customerID) FROM ${SRC}.sales_customers)  AS cust,
    (SELECT collect_list(franchiseID) FROM ${SRC}.sales_franchises) AS fran,
    (SELECT collect_list(named_struct('product', product, 'unitPrice', unitPrice))
       FROM (SELECT product, max(unitPrice) AS unitPrice FROM ${SRC}.sales_transactions GROUP BY product)) AS prod,
    (SELECT collect_list(paymentMethod) FROM (SELECT DISTINCT paymentMethod FROM ${SRC}.sales_transactions)) AS pay
), draws AS (
  SELECT id, cust, fran, prod, pay,
         rand(1 + ${offset}) AS r_c, rand(2 + ${offset}) AS r_f, rand(3 + ${offset}) AS r_p, rand(4 + ${offset}) AS r_y, rand(5 + ${offset}) AS r_t, rand(6 + ${offset}) AS r_q, rand(7 + ${offset}) AS r_d
  FROM range(${ROWS}) CROSS JOIN pools
), picked AS (
  SELECT id,
    -- skew: squaring concentrates traffic on low-index customers/franchises/products
    element_at(cust, CAST(floor(r_c * r_c * size(cust)) AS INT) + 1) AS customerID,
    element_at(fran, CAST(floor(r_f * r_f * size(fran)) AS INT) + 1) AS franchiseID,
    element_at(prod, CAST(floor(r_p * r_p * size(prod)) AS INT) + 1) AS p,
    element_at(pay,  CAST(floor(r_y * size(pay)) AS INT) + 1)        AS paymentMethod,
    timestampadd(SECOND, CAST(floor(r_t * 3 * 365 * 86400) AS INT), TIMESTAMP'2023-01-01 00:00:00') AS dateTime,
    CAST(1 + floor(r_q * 10) AS BIGINT) AS quantity,
    CAST(4000000000000000 + floor(r_d * 1000000000000) AS BIGINT) AS cardNumber
  FROM draws
)
SELECT CAST(id + 1 + ${offset} AS BIGINT) AS transactionID, customerID, franchiseID, dateTime,
       p.product AS product, quantity, p.unitPrice AS unitPrice,
       quantity * p.unitPrice AS totalPrice, paymentMethod, cardNumber
FROM picked`;

async function main() {
  const client = new DBSQLClient();
  await client.connect({
    host: env.DATABRICKS_HOST.replace(/^https?:\/\//, ''),
    path: env.DATABRICKS_HTTP_PATH,
    token: env.DATABRICKS_TOKEN,
  });
  const session = await client.openSession();
  const run = async (sql) => {
    const op = await session.executeStatement(sql, { runAsync: true });
    const rows = await op.fetchAll();
    await op.close();
    return rows;
  };
  try {
    console.log(`Target ${TARGET}, ${ROWS} rows`);
    await run(`CREATE SCHEMA IF NOT EXISTS ${TARGET}`);
    for (const t of APPEND ? [] : COPY) {
      console.log('copy', t);
      await run(`CREATE OR REPLACE TABLE ${TARGET}.${t} AS SELECT * FROM ${SRC}.${t}`);
    }
    let offset = 0;
    if (APPEND) {
      const [m] = await run(`SELECT coalesce(max(transactionID), 0) AS m FROM ${TARGET}.sales_transactions`);
      offset = Number(m.m);
    }
    console.log(`${APPEND ? 'append to' : 'generate'} sales_transactions (id offset ${offset})`);
    await run(transactionsSql(offset));
    for (const t of ['sales_transactions', ...COPY]) {
      await run(`ANALYZE TABLE ${TARGET}.${t} COMPUTE STATISTICS FOR ALL COLUMNS`);
      const [r] = await run(`SELECT count(*) AS n FROM ${TARGET}.${t}`);
      console.log(`${t}: ${r.n} rows`);
    }
  } finally {
    await session.close();
    await client.close();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
