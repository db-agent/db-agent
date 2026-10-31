import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresEngine } from "../sqlEngines/postgres.js";
import { sqlFitsSchema } from "../exampleFit.js";
import { allowedTables } from "../gateway/config.js";

// A fake pool: records queries, returns canned rows for the schema listing.
function engineWith(schema, rows = []) {
  const engine = new PostgresEngine({ connectionString: "postgresql://u:p@localhost/db", schema });
  const seen = [];
  const client = {
    query: async (sql, params) => { seen.push({ sql: String(sql), params }); return { rows: [], fields: [] }; },
    release() {},
  };
  engine.pool = {
    query: async (sql, params) => { seen.push({ sql, params }); return { rows }; },
    connect: async () => client,
  };
  return { engine, seen };
}
const listing = [
  { table_schema: "sales", table_name: "customer", column_name: "customerid", data_type: "integer" },
  { table_schema: "sales", table_name: "customer", column_name: "personid", data_type: "integer" },
  { table_schema: "person", table_name: "address", column_name: "city", data_type: "text" },
];

test("one schema: table names stay unqualified (unchanged behavior)", async () => {
  const { engine, seen } = engineWith("public", [{ ...listing[0], table_schema: "public" }]);
  assert.deepEqual(Object.keys(await engine.getSchema()), ["customer"]);
  assert.deepEqual(seen[0].params, [["public"]]);
  assert.equal(engine.schemaName, "public");
});

test("several schemas: tables are schema-qualified and all schemas are queried", async () => {
  const { engine, seen } = engineWith("sales, person", listing);
  const schema = await engine.getSchema();
  assert.deepEqual(Object.keys(schema), ["sales.customer", "person.address"]);
  assert.deepEqual(schema["sales.customer"].map((c) => c.name), ["customerid", "personid"]);
  assert.deepEqual(seen[0].params, [["sales", "person"]]);
});

test("star: every user schema, no schema parameter", async () => {
  const { engine, seen } = engineWith("*", listing);
  assert.equal(Object.keys(await engine.getSchema()).length, 2);
  assert.match(seen[0].sql, /NOT IN \('pg_catalog', 'information_schema'\)/);
  assert.deepEqual(seen[0].params, []);
});

test("queries run with the configured search_path, quoted", async () => {
  const { engine, seen } = engineWith('sales,we"ird');
  await engine.runQuery("SELECT 1");
  assert.ok(seen.some((s) => s.sql === 'SET LOCAL search_path = "sales", "we""ird"'));
  assert.ok(seen.some((s) => s.sql.startsWith("DECLARE")));
});

test("qualified tables work with the example check and the table policy", () => {
  const schema = { "sales.customer": [{ name: "customerid" }, { name: "personid" }], "person.address": [{ name: "city" }] };
  assert.equal(sqlFitsSchema("SELECT c.personid FROM sales.customer c", schema), true);
  assert.equal(sqlFitsSchema("SELECT city FROM person.address", schema), true);
  assert.equal(sqlFitsSchema("SELECT x FROM sales.nothing", schema), false);
  const config = { tables: { deny: ["address"], allow: null } };
  assert.deepEqual(allowedTables(config, {}, ["sales.customer", "person.address"]), ["sales.customer"]);
  assert.deepEqual(allowedTables({ tables: { deny: ["person.address"], allow: null } }, {}, ["sales.customer", "person.address"]), ["sales.customer"]);
});
