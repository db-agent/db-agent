#!/usr/bin/env node
// Seed an Olist-shaped (Brazilian e-commerce) dataset into Postgres at any scale,
// for testing EXPLAIN-based scan flagging (issue #63) on Postgres, Aurora, RDS or Lakebase.
//
// The real Olist dataset has ~112k order_items. This generates the same eight-table
// shape server-side with generate_series (no data passes through this machine), so
// the largest table can be grown to 10-20M rows.
//
// Usage:
//   SEED_DB_URL=postgresql://admin:pw@host:5432/db node scripts/seed-olist-postgres.js [command] [--yes]
//
// Commands:
//   seed          (default) drop + recreate all tables, load data, add primary keys, ANALYZE
//   ensure        like seed, but does nothing if order_items already has rows (used by docker compose)
//   add-indexes   add the date/state indexes that turn the seq-scan demos into index scans
//   drop-indexes  remove them again
//
// Env:
//   SEED_DB_URL        REQUIRED. A role that can CREATE/DROP tables. Deliberately does NOT
//                      fall back to DB_URL (that is the app's read-only role, and it may point
//                      at a database you do not want dropped).
//   SEED_ORDER_ITEMS   rows in order_items (default 15000000); other tables scale from it
//   SEED_SCHEMA        target schema (default public)
import readline from "node:readline/promises";
import pg from "pg";

const COMMANDS = new Set(["seed", "ensure", "add-indexes", "drop-indexes"]);
const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) || "seed";
const assumeYes = args.includes("--yes") || process.env.SEED_YES === "1";
if (!COMMANDS.has(command)) {
  console.error(`Unknown command "${command}". Use: ${[...COMMANDS].join(", ")}`);
  process.exit(2);
}

const URL_STR = process.env.SEED_DB_URL;
if (!URL_STR) {
  console.error("SEED_DB_URL is required (it is intentionally not read from DB_URL or .env).");
  process.exit(2);
}
const SCHEMA = process.env.SEED_SCHEMA || "public";
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(SCHEMA)) throw new Error("SEED_SCHEMA must be a plain identifier");

const N_ITEMS = Math.max(1000, parseInt(process.env.SEED_ORDER_ITEMS || "15000000", 10));
const N_ORDERS = Math.ceil(N_ITEMS / 1.14); // Olist: ~1.14 items per order
const N_PRODUCTS = Math.max(100, Math.round(N_ITEMS / 3.5));
const N_SELLERS = Math.max(50, Math.round(N_ITEMS / 36));
const N_UNIQUE_CUSTOMERS = Math.round(N_ORDERS * 0.97);
const CHUNK = 1_000_000;

const t = (name) => `${SCHEMA}.${name}`;

// Purchase time is a deterministic, monotone function of the order number, so order_items
// can derive shipping_limit_date from it without joining orders. Rows end up in date order
// on disk, like a real append-only orders table.
const purchaseTs = (o) =>
  `(timestamp '2016-09-01' + ((${o} - 1)::float8 / ${N_ORDERS}) * interval '730 days')`;

const DDL = `
DROP TABLE IF EXISTS ${t("order_reviews")}, ${t("order_payments")}, ${t("order_items")},
  ${t("orders")}, ${t("products")}, ${t("sellers")}, ${t("customers")} CASCADE;

CREATE TABLE ${t("customers")} (
  customer_id text NOT NULL, customer_unique_id text NOT NULL,
  customer_zip_code_prefix int, customer_city text, customer_state text);
CREATE TABLE ${t("sellers")} (
  seller_id text NOT NULL, seller_zip_code_prefix int, seller_city text, seller_state text);
CREATE TABLE ${t("products")} (
  product_id text NOT NULL, product_category_name text, product_name_length int,
  product_photos_qty int, product_weight_g int);
CREATE TABLE ${t("orders")} (
  order_id text NOT NULL, customer_id text NOT NULL, order_status text,
  order_purchase_timestamp timestamp, order_approved_at timestamp,
  order_delivered_customer_date timestamp, order_estimated_delivery_date timestamp);
CREATE TABLE ${t("order_items")} (
  order_id text NOT NULL, order_item_id int NOT NULL, product_id text, seller_id text,
  shipping_limit_date timestamp, price numeric(10,2), freight_value numeric(10,2));
CREATE TABLE ${t("order_payments")} (
  order_id text NOT NULL, payment_sequential int NOT NULL, payment_type text,
  payment_installments int, payment_value numeric(10,2));
CREATE TABLE ${t("order_reviews")} (
  review_id text NOT NULL, order_id text NOT NULL, review_score int,
  review_comment_message text, review_creation_date timestamp);
`;

const CITIES = ["sao paulo", "rio de janeiro", "belo horizonte", "brasilia", "curitiba", "campinas",
  "porto alegre", "salvador", "guarulhos", "sao bernardo do campo", "niteroi", "santo andre",
  "osasco", "santos", "ribeirao preto", "recife", "fortaleza", "goiania", "florianopolis", "manaus"];
const STATES = ["SP", "RJ", "MG", "DF", "PR", "SP", "RS", "BA", "SP", "SP", "RJ", "SP",
  "SP", "SP", "SP", "PE", "CE", "GO", "SC", "AM"];
const CATEGORIES = ["cama_mesa_banho", "beleza_saude", "esporte_lazer", "informatica_acessorios",
  "moveis_decoracao", "utilidades_domesticas", "relogios_presentes", "telefonia", "automotivo",
  "brinquedos", "cool_stuff", "ferramentas_jardim", "perfumaria", "bebes", "eletronicos",
  "papelaria", "fashion_bolsas_e_acessorios", "pet_shop", "livros_tecnicos", "alimentos"];
const MESSAGES = ["Produto chegou antes do prazo", "Recomendo a loja", "Nao gostei da qualidade",
  "Entrega muito demorada", "Tudo certo com o pedido", "Produto diferente do anunciado"];

const sqlArray = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(",")}]`;
const pick = (arr, skew = "random()") =>
  `(${sqlArray(arr)})[1 + floor(${skew} * ${arr.length})::int]`;

// One INSERT per range of row numbers so progress is visible and memory stays bounded.
const loaders = [
  {
    name: "sellers", total: N_SELLERS,
    sql: (lo, hi) => `INSERT INTO ${t("sellers")}
      SELECT md5('s' || i), 1000 + (random() * 98999)::int,
             ${pick(CITIES, "random()^2")}, ${pick(STATES, "random()^2")}
      FROM generate_series(${lo}::bigint, ${hi}::bigint) i`,
  },
  {
    name: "products", total: N_PRODUCTS,
    sql: (lo, hi) => `INSERT INTO ${t("products")}
      SELECT md5('p' || i), ${pick(CATEGORIES, "random()^2")}, 20 + (random() * 40)::int,
             1 + (random() * 5)::int, 50 + (random() ^ 3 * 20000)::int
      FROM generate_series(${lo}::bigint, ${hi}::bigint) i`,
  },
  {
    name: "customers", total: N_ORDERS,
    sql: (lo, hi) => `INSERT INTO ${t("customers")}
      SELECT md5('c' || i), md5('u' || (1 + floor(random() * ${N_UNIQUE_CUSTOMERS}))::bigint),
             1000 + (random() * 98999)::int,
             (${sqlArray(CITIES)})[k], (${sqlArray(STATES)})[k]
      FROM (SELECT i, 1 + floor(random() ^ 2 * ${CITIES.length})::int AS k FROM generate_series(${lo}::bigint, ${hi}::bigint) i) g`,
  },
  {
    name: "orders", total: N_ORDERS,
    sql: (lo, hi) => `INSERT INTO ${t("orders")}
      SELECT md5('o' || i), md5('c' || i),
             CASE WHEN r < 0.97 THEN 'delivered' WHEN r < 0.98 THEN 'shipped'
                  WHEN r < 0.986 THEN 'canceled' WHEN r < 0.992 THEN 'unavailable' ELSE 'processing' END,
             ${purchaseTs("i")},
             ${purchaseTs("i")} + random() * interval '1 day',
             CASE WHEN r < 0.97 THEN ${purchaseTs("i")} + interval '4 days' + random() * interval '20 days' END,
             ${purchaseTs("i")} + interval '18 days' + random() * interval '20 days'
      FROM (SELECT i, random() AS r FROM generate_series(${lo}::bigint, ${hi}::bigint) i) g`,
  },
  {
    // Item i belongs to order floor((i-1)*orders/items)+1; order_item_id is its rank inside that order.
    name: "order_items", total: N_ITEMS,
    sql: (lo, hi) => `INSERT INTO ${t("order_items")}
      SELECT md5('o' || o),
             (i - (((o - 1) * ${N_ITEMS} + ${N_ORDERS} - 1) / ${N_ORDERS} + 1) + 1)::int,
             md5('p' || (1 + floor(random() ^ 2 * ${N_PRODUCTS}))::bigint),
             md5('s' || (1 + floor(random() ^ 2 * ${N_SELLERS}))::bigint),
             ${purchaseTs("o")} + interval '3 days' + random() * interval '7 days',
             round((9.9 + random() ^ 3 * 1500)::numeric, 2),
             round((7 + random() * 40)::numeric, 2)
      FROM (SELECT i, ((i - 1) * ${N_ORDERS}) / ${N_ITEMS} + 1 AS o FROM generate_series(${lo}::bigint, ${hi}::bigint) i) g`,
  },
  {
    name: "order_payments", total: N_ORDERS,
    sql: (lo, hi) => `INSERT INTO ${t("order_payments")}
      SELECT md5('o' || i), 1,
             CASE WHEN r < 0.74 THEN 'credit_card' WHEN r < 0.93 THEN 'boleto'
                  WHEN r < 0.98 THEN 'voucher' ELSE 'debit_card' END,
             1 + (random() ^ 2 * 10)::int, round((10 + random() ^ 3 * 1500)::numeric, 2)
      FROM (SELECT i, random() AS r FROM generate_series(${lo}::bigint, ${hi}::bigint) i) g`,
  },
  {
    // ~4% of orders pay in two parts.
    name: "order_payments (split)", total: N_ORDERS,
    sql: (lo, hi) => `INSERT INTO ${t("order_payments")}
      SELECT md5('o' || i), 2, 'voucher', 1, round((5 + random() * 50)::numeric, 2)
      FROM generate_series(${lo}::bigint, ${hi}::bigint) i WHERE i % 25 = 0`,
  },
  {
    name: "order_reviews", total: N_ORDERS,
    sql: (lo, hi) => `INSERT INTO ${t("order_reviews")}
      SELECT md5('r' || i), md5('o' || i),
             CASE WHEN r < 0.57 THEN 5 WHEN r < 0.76 THEN 4 WHEN r < 0.88 THEN 1
                  WHEN r < 0.96 THEN 3 ELSE 2 END,
             CASE WHEN random() < 0.41 THEN ${pick(MESSAGES)} END,
             ${purchaseTs("i")} + interval '8 days' + random() * interval '20 days'
      FROM (SELECT i, random() AS r FROM generate_series(${lo}::bigint, ${hi}::bigint) i WHERE i % 100 <> 0) g`,
  },
];

const PRIMARY_KEYS = [
  `ALTER TABLE ${t("customers")} ADD PRIMARY KEY (customer_id)`,
  `ALTER TABLE ${t("sellers")} ADD PRIMARY KEY (seller_id)`,
  `ALTER TABLE ${t("products")} ADD PRIMARY KEY (product_id)`,
  `ALTER TABLE ${t("orders")} ADD PRIMARY KEY (order_id)`,
  `ALTER TABLE ${t("order_items")} ADD PRIMARY KEY (order_id, order_item_id)`,
  `ALTER TABLE ${t("order_payments")} ADD PRIMARY KEY (order_id, payment_sequential)`,
  `ALTER TABLE ${t("order_reviews")} ADD PRIMARY KEY (review_id)`,
];

// The "fix" step in the demo: without these, date and state filters cannot use an index.
const DEMO_INDEXES = [
  ["idx_order_items_shipping_limit_date", "order_items", "shipping_limit_date"],
  ["idx_orders_purchase_timestamp", "orders", "order_purchase_timestamp"],
  ["idx_customers_state", "customers", "customer_state"],
];

const TABLES = ["customers", "sellers", "products", "orders", "order_items", "order_payments", "order_reviews"];

function describeTarget() {
  try {
    const u = new URL(URL_STR);
    return `${u.hostname}:${u.port || 5432}${u.pathname} (schema ${SCHEMA})`;
  } catch {
    return "(unparseable SEED_DB_URL)";
  }
}

async function confirm() {
  if (assumeYes) return;
  if (!process.stdin.isTTY) {
    console.error("Refusing to modify a database non-interactively without --yes (or SEED_YES=1).");
    process.exit(2);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Target: ${describeTarget()}\nThis ${command === "seed" || command === "ensure" ? "DROPS and recreates the Olist tables" : "changes indexes"}. Type "yes" to continue: `);
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Aborted.");
    process.exit(1);
  }
}

async function main() {
  console.log(`Target ${describeTarget()}, command ${command}`);
  await confirm();
  const client = new pg.Client({ connectionString: URL_STR });
  await client.connect();
  const started = Date.now();
  const secs = () => ((Date.now() - started) / 1000).toFixed(0);
  try {
    if (command === "ensure") {
      const { rows } = await client.query("SELECT to_regclass($1) AS t", [`${SCHEMA}.order_items`]);
      if (rows[0].t) {
        const { rows: c } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${t("order_items")}) AS has_rows`);
        if (c[0].has_rows) {
          console.log("Olist tables already present and populated; nothing to do.");
          return;
        }
      }
    }
    if (command === "add-indexes") {
      for (const [name, table, col] of DEMO_INDEXES) {
        console.log(`create index ${name}`);
        await client.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${t(table)} (${col})`);
      }
      for (const table of ["order_items", "orders", "customers"]) await client.query(`ANALYZE ${t(table)}`);
    } else if (command === "drop-indexes") {
      for (const [name] of DEMO_INDEXES) await client.query(`DROP INDEX IF EXISTS ${SCHEMA}.${name}`);
    } else {
      console.log(`order_items=${N_ITEMS} orders=${N_ORDERS} products=${N_PRODUCTS} sellers=${N_SELLERS}`);
      await client.query("SELECT setseed(0.2026)"); // reproducible data
      await client.query(DDL);
      for (const l of loaders) {
        for (let lo = 1; lo <= l.total; lo += CHUNK) {
          const hi = Math.min(lo + CHUNK - 1, l.total);
          await client.query(l.sql(lo, hi));
          console.log(`[${secs()}s] ${l.name}: ${hi.toLocaleString()} / ${l.total.toLocaleString()}`);
        }
      }
      for (const stmt of PRIMARY_KEYS) {
        console.log(`[${secs()}s] ${stmt.replace(`${SCHEMA}.`, "")}`);
        await client.query(stmt);
      }
      console.log(`[${secs()}s] ANALYZE`);
      for (const table of TABLES) await client.query(`ANALYZE ${t(table)}`);
    }
    for (const table of TABLES) {
      const { rows } = await client.query(
        `SELECT reltuples::bigint AS n, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`, [SCHEMA, table]);
      if (rows[0]) console.log(`${table}: ~${Number(rows[0].n).toLocaleString()} rows, ${rows[0].size}`);
    }
    console.log(`Done in ${secs()}s`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
