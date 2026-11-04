import test from "node:test";
import assert from "node:assert/strict";
import { defaultSqlEngine } from "../sqlEngines/index.js";

const DBX = { DATABRICKS_HOST: "h", DATABRICKS_HTTP_PATH: "/p", DATABRICKS_TOKEN: "t", DATABRICKS_CATALOG: "c", DATABRICKS_SCHEMA: "s" };

test("defaultSqlEngine: SQL_ENGINE wins, then complete Databricks credentials, then SQLite", () => {
  assert.equal(defaultSqlEngine({ SQL_ENGINE: "Postgres" }), "postgres");
  assert.equal(defaultSqlEngine({ SQL_ENGINE: "sqlite", ...DBX }), "sqlite");
  assert.equal(defaultSqlEngine(DBX), "databricks-sql");
  assert.equal(defaultSqlEngine({}), "sqlite");
  assert.equal(defaultSqlEngine({ DATABRICKS_HOST: "h" }), "sqlite");
});
