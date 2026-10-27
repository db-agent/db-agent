import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sqlFitsSchema } from "../exampleFit.js";

const cols = (...names) => names.map((name) => ({ name, type: "text" }));
// Bundled SQLite demo (data/demo.db)
const demo = {
  customers: cols("id", "name", "email", "city", "joined_at"),
  products: cols("id", "name", "category", "price"),
  orders: cols("id", "customer_id", "product_id", "quantity", "ordered_at", "status"),
};
// Olist-shaped Postgres (scripts/seed-olist-postgres.js). Same table names as the demo for
// customers/orders, different columns.
const olist = {
  customers: cols("customer_id", "customer_unique_id", "customer_zip_code_prefix", "customer_city", "customer_state"),
  sellers: cols("seller_id", "seller_zip_code_prefix", "seller_city", "seller_state"),
  products: cols("product_id", "product_category_name", "product_name_length", "product_photos_qty", "product_weight_g"),
  orders: cols("order_id", "customer_id", "order_status", "order_purchase_timestamp", "order_approved_at", "order_delivered_customer_date", "order_estimated_delivery_date"),
  order_items: cols("order_id", "order_item_id", "product_id", "seller_id", "shipping_limit_date", "price", "freight_value"),
  order_payments: cols("order_id", "payment_sequential", "payment_type", "payment_installments", "payment_value"),
  order_reviews: cols("review_id", "order_id", "review_score", "review_comment_message", "review_creation_date"),
};
const seed = JSON.parse(fs.readFileSync(new URL("../benchmarks.json", import.meta.url), "utf8"));
const olistCases = JSON.parse(fs.readFileSync(new URL("../scripts/olist-eval-cases.json", import.meta.url), "utf8"));

test("every bundled seed example fits the demo schema it was written for", () => {
  for (const c of seed) assert.ok(sqlFitsSchema(c.groundTruthSql, demo), c.groundTruthSql);
});

test("only the schema-neutral seed example survives on Olist, even where table names overlap", () => {
  const kept = seed.filter((c) => sqlFitsSchema(c.groundTruthSql, olist)).map((c) => c.groundTruthSql);
  // "SELECT COUNT(*) FROM customers" is valid on Olist too; the other six use demo-only columns.
  assert.deepEqual(kept, ["SELECT COUNT(*) FROM customers"]);
});

test("same table name but a column that does not exist is rejected", () => {
  assert.equal(sqlFitsSchema("SELECT COUNT(*) FROM customers", olist), true);
  assert.equal(sqlFitsSchema("SELECT name FROM customers WHERE city = 'Berlin'", olist), false);
  assert.equal(sqlFitsSchema("SELECT * FROM orders WHERE status = 'pending'", olist), false);
});

test("all 20 Olist eval queries (joins, EXTRACT, COUNT DISTINCT, CASE) fit the Olist schema", () => {
  for (const c of olistCases) assert.ok(sqlFitsSchema(c.groundTruthSql, olist), c.groundTruthSql);
});

test("unknown table, unknown qualified column and empty SQL are rejected", () => {
  assert.equal(sqlFitsSchema("SELECT * FROM nope", olist), false);
  assert.equal(sqlFitsSchema("SELECT o.nope FROM orders o", olist), false);
  assert.equal(sqlFitsSchema("SELECT x.order_id FROM orders o", olist), false);
  assert.equal(sqlFitsSchema("", olist), false);
});

test("aliases, schema-qualified names, quoted identifiers, CTEs and output aliases are understood", () => {
  assert.ok(sqlFitsSchema("SELECT o.order_id AS oid FROM public.orders AS o ORDER BY oid", olist));
  assert.ok(sqlFitsSchema('SELECT "order_id" FROM "orders"', olist));
  assert.ok(sqlFitsSchema("WITH big AS (SELECT order_id FROM order_items) SELECT count(*) FROM big", olist));
  assert.ok(sqlFitsSchema("SELECT order_status, count(*) AS n FROM orders GROUP BY order_status ORDER BY n DESC", olist));
  assert.ok(sqlFitsSchema("SELECT CAST(price AS INTEGER) FROM order_items WHERE shipping_limit_date >= DATE '2018-01-01'", olist));
});

test("a string literal that looks like a column does not count as one", () => {
  assert.ok(sqlFitsSchema("SELECT count(*) FROM orders WHERE order_status = 'status_unknown'", olist));
});
