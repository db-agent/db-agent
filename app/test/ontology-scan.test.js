import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { scanMetadata, readMetadata, renderScanMarkdown } from "../ontology/scan.js";
import { SQLiteEngine } from "../sqlEngines/sqlite.js";

const col = (name, extra = {}) => ({ name, type: "text", comment: null, primaryKey: false, ...extra });
const meta = {
  tables: {
    "sales.orders": {
      comment: "One row per order.", foreignKeys: [{ column: "customerid", refTable: "sales.customer", refColumn: "customerid" }],
      columns: [col("orderid", { primaryKey: true, comment: "Order id." }), col("customerid", { comment: "Buyer." }), col("status", { comment: null }), col("onlineorderflag")],
    },
    "sales.customer": { comment: null, foreignKeys: [], columns: [col("customerid", { primaryKey: true }), col("email"), col("col1")] },
    "person.address": { comment: null, foreignKeys: [], columns: [col("addressid"), col("city")] },
  },
};

test("scores tables and the overall score, worst first", () => {
  const scan = scanMetadata(meta);
  assert.equal(scan.summary.tables, 3);
  assert.equal(scan.tables[0].score <= scan.tables[2].score, true);
  assert.ok(scan.summary.overall > 0 && scan.summary.overall < 100);
  const orders = scan.tables.find((t) => t.name === "sales.orders");
  const address = scan.tables.find((t) => t.name === "person.address");
  assert.ok(orders.score > address.score, "documented table with a key scores higher");
  assert.ok(address.issues.includes("no primary key declared"));
});

test("flags code columns and sensitive columns for a person to answer", () => {
  const scan = scanMetadata(meta);
  const asks = scan.todo.map((x) => `${x.kind}:${x.table}.${x.column}`);
  assert.ok(asks.includes("code-meaning:orders.status"));
  assert.ok(asks.includes("code-meaning:orders.onlineorderflag"));
  assert.ok(asks.includes("sensitive:customer.email"));
  assert.ok(!asks.includes("code-meaning:orders.orderid"));
});

test("draft knowledge carries comments and where keys point", () => {
  const { draft } = scanMetadata(meta);
  assert.equal(draft.descriptions.orders, "One row per order.");
  assert.equal(draft.descriptions["orders.customerid"], "Buyer. Joins to sales.customer.customerid.");
  assert.equal(draft.descriptions["orders.status"], undefined, "nothing invented for undocumented columns");
  assert.deepEqual(draft.examples, []);
});

test("same table name in two schemas keeps the schema prefix", () => {
  const m = { tables: { "a.item": { comment: "A items", foreignKeys: [], columns: [col("id", { primaryKey: true })] }, "b.item": { comment: "B items", foreignKeys: [], columns: [col("id", { primaryKey: true })] } } };
  const { draft } = scanMetadata(m);
  assert.deepEqual(Object.keys(draft.descriptions).sort(), ["a.item", "b.item"]);
});

test("reads real SQLite metadata without touching rows", async () => {
  const engine = new SQLiteEngine({ dbPath: ":memory:" });
  engine.db.exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT); CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), status TEXT); INSERT INTO customers VALUES (1, 'a@b.c'); INSERT INTO orders VALUES (1, 1, 'x');");
  const m = await readMetadata(engine);
  assert.equal(m.tables.orders.foreignKeys[0].refTable, "customers");
  assert.equal(m.tables.orders.columns.find((c) => c.name === "id").primaryKey, true);
  const scan = scanMetadata(m);
  assert.ok(scan.todo.some((x) => x.column === "status"));
  assert.match(renderScanMarkdown(scan), /No table rows were read/);
});
