#!/usr/bin/env node
// Plans the SQL for each question in olist-questions.json (EXPLAIN only, nothing is
// executed) and checks which ones the Postgres engine flags as expensive. Validates
// issue #63 on a seeded Olist database; exits 1 if any expectation is not met.
//
//   DB_URL=postgresql://user:pw@host:5432/db PG_SSL=false node scripts/check-olist-questions.js
//
// PG_SSL=false for a local database without TLS. A read-only role is enough.
//
// --actual  also runs each query as count(*) to compare the planner's estimated result rows
//           with the real number. This EXECUTES the queries (the big joins take a while at
//           15M rows), so it is opt-in.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgresEngine } from "../sqlEngines/postgres.js";

const questions = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("./olist-questions.json", import.meta.url)), "utf8")
);
if (!process.env.DB_URL) {
  console.error("DB_URL is required (process environment only; .env is not read).");
  process.exit(2);
}

const engine = new PostgresEngine({
  connectionString: process.env.DB_URL,
  ssl: process.env.PG_SSL || "default",
  schema: process.env.PG_SCHEMA || "public",
  largeTableRows: process.env.PG_LARGE_TABLE_ROWS,
});

const { rows: idx } = await engine.pool.query(
  "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_order_items_shipping_limit_date'"
);
const withIndexes = idx.length > 0;
const compareActual = process.argv.includes("--actual");
console.log(`Demo indexes present: ${withIndexes ? "yes" : "no"}\n`);

let failures = 0;
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
console.log(`${pad("#", 3)}${pad("question", 38)}${pad("scans", 34)}${pad("est. rows", 12)}${pad("flagged", 9)}expected`);
for (const [i, q] of questions.entries()) {
  let plan;
  try {
    plan = await engine.analyzeQuery(q.sql);
  } catch (e) {
    console.log(`${pad(i + 1, 3)}${pad(q.question, 38)}ERROR ${e.message}`);
    failures += 1;
    continue;
  }
  const warns = plan.warnings.filter((w) => w.code !== "no_table_stats");
  const flagged = warns.length > 0;
  const expected = withIndexes ? q.flaggedWithIndexes : q.flagged;
  const ok = flagged === expected;
  if (!ok) failures += 1;
  const scans = [...new Set(plan.scans.map((s) => `${s.scanType.replace(" Scan", "")}:${s.table}`))].join(", ");
  let actualText = "";
  if (compareActual) {
    const { rows } = await engine.pool.query(`SELECT count(*)::bigint AS n FROM (${q.sql}) q`);
    const actual = Number(rows[0].n);
    const ratio = actual === 0 ? "-" : `${(plan.rowCount / actual).toFixed(2)}x`;
    actualText = `   actual ${actual.toLocaleString()} (est/actual ${ratio})`;
  }
  console.log(
    `${pad(i + 1, 3)}${pad(q.question, 38)}${pad(scans, 34)}${pad(Math.round(plan.rowCount).toLocaleString(), 12)}` +
      `${pad(flagged ? "YES" : "no", 9)}${expected ? "YES" : "no"}${ok ? "" : "   <-- MISMATCH"}${actualText}`
  );
  for (const w of warns) console.log(`     ${w.code}: ${w.message}`);
}
console.log(`\n${questions.length - failures}/${questions.length} as expected`);
await engine.pool.end();
process.exit(failures ? 1 : 0);
