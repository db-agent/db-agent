import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePostgresPlan } from "../sqlEngines/postgres.js";

const stats = {
  "public.orders": { reltuples: 15_000_000, relpages: 200_000 },
  "public.customers": { reltuples: 500, relpages: 5 },
  "public.fresh": { reltuples: -1, relpages: 120 },
};
const seq = (extra = {}) => ({
  "Node Type": "Seq Scan", "Relation Name": "orders", Schema: "public", "Plan Rows": 15_000_000, "Plan Width": 100, ...extra,
});

test("seq scan with no filter on a large table is flagged and sized from the table pages", () => {
  const r = parsePostgresPlan(seq(), stats);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].code, "no_filter_large_table");
  assert.match(r.warnings[0].message, /15,000,000 rows/);
  assert.equal(r.sizeInBytes, 200_000 * 8192);
  assert.equal(r.scans[0].scanType, "Seq Scan");
  assert.equal(r.rowCount, 15_000_000);
});

test("seq scan with a filter is flagged differently and mentions the filter", () => {
  const r = parsePostgresPlan(seq({ Filter: "(status = 'x'::text)", "Plan Rows": 40 }), stats);
  assert.equal(r.warnings[0].code, "seq_scan_large_table");
  assert.match(r.warnings[0].message, /status = 'x'/);
  assert.equal(r.scans[0].filtered, true);
});

test("index scan is not flagged and reads only its estimated rows", () => {
  const r = parsePostgresPlan(
    { "Node Type": "Index Scan", "Relation Name": "orders", Schema: "public", "Index Name": "orders_pkey", "Index Cond": "(order_id = 'a')", "Plan Rows": 1, "Plan Width": 100 },
    stats
  );
  assert.deepEqual(r.warnings, []);
  assert.equal(r.sizeInBytes, 100);
  assert.equal(r.scans[0].indexName, "orders_pkey");
});

test("small tables are never flagged", () => {
  const r = parsePostgresPlan(seq({ "Relation Name": "customers", "Plan Rows": 500 }), stats);
  assert.deepEqual(r.warnings, []);
});

test("a LIMIT bounds the scan: no flag, rows and bytes follow the limit", () => {
  const r = parsePostgresPlan({ "Node Type": "Limit", "Plan Rows": 10, Plans: [seq()] }, stats);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.scans[0].bounded, true);
  assert.equal(r.scanRows, 10);
  assert.equal(r.sizeInBytes, 1000);
});

test("a LIMIT above a Sort does NOT bound the scan", () => {
  const r = parsePostgresPlan(
    { "Node Type": "Limit", "Plan Rows": 10, Plans: [{ "Node Type": "Sort", "Plan Rows": 15_000_000, Plans: [seq()] }] },
    stats
  );
  assert.equal(r.warnings[0].code, "no_filter_large_table");
});

test("a table that was never analyzed gets a stats warning, not a size claim", () => {
  const r = parsePostgresPlan(seq({ "Relation Name": "fresh", "Plan Rows": 1000 }), stats);
  assert.equal(r.warnings[0].code, "no_table_stats");
  assert.match(r.warnings[0].message, /ANALYZE fresh/);
});

test("a join with no condition is flagged as unbounded", () => {
  const r = parsePostgresPlan(
    { "Node Type": "Nested Loop", "Plan Rows": 250_000, Plans: [seq({ "Relation Name": "customers", "Plan Rows": 500 }), seq({ "Relation Name": "customers", "Plan Rows": 500 })] },
    stats
  );
  assert.ok(r.warnings.some((w) => w.code === "unbounded_join"));
});

test("an indexed nested loop join is not flagged", () => {
  const r = parsePostgresPlan(
    { "Node Type": "Nested Loop", "Plan Rows": 5, Plans: [
      { "Node Type": "Index Scan", "Relation Name": "customers", Schema: "public", "Index Cond": "(id = 1)", "Plan Rows": 1, "Plan Width": 8 },
      { "Node Type": "Index Scan", "Relation Name": "customers", Schema: "public", "Index Cond": "(id = c.id)", "Plan Rows": 5, "Plan Width": 8 },
    ] },
    stats
  );
  assert.deepEqual(r.warnings, []);
});

test("the large-table threshold is configurable", () => {
  const r = parsePostgresPlan(seq({ "Relation Name": "customers", "Plan Rows": 500 }), stats, { largeTableRows: 100 });
  assert.equal(r.warnings[0].code, "no_filter_large_table");
});

test("an index scan with no condition on a large table is a full scan and is flagged", () => {
  const r = parsePostgresPlan(
    { "Node Type": "Aggregate", "Plan Rows": 1, Plans: [
      { "Node Type": "Index Only Scan", "Relation Name": "orders", Schema: "public", "Index Name": "orders_pkey", "Plan Rows": 15_000_000, "Plan Width": 0 },
    ] },
    stats
  );
  assert.equal(r.warnings[0].code, "full_index_scan_large_table");
  assert.equal(r.sizeInBytes, 15_000_000 * 16);
});
