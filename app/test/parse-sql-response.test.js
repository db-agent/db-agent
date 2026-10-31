import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.GATEWAY_DB = path.join(os.tmpdir(), `parse-test-${process.pid}.db`);
process.env.SQL_ENGINE = "sqlite";
const { parseSqlResponse } = await import("../server.js");

test("JSON answers still parse, with or without a code fence", () => {
  assert.deepEqual(parseSqlResponse('{"sql":"SELECT 1","explanation":"one"}'), { sql: "SELECT 1", explanation: "one" });
  assert.equal(parseSqlResponse('```json\n{"sql":"SELECT 2","explanation":""}\n```').sql, "SELECT 2");
});

test("a bare statement (SQL-tuned models) is accepted", () => {
  assert.equal(parseSqlResponse(" SELECT COUNT(*) FROM sales.customer;\n").sql, "SELECT COUNT(*) FROM sales.customer");
  assert.equal(parseSqlResponse("```sql\nWITH x AS (SELECT 1) SELECT * FROM x\n```").sql, "WITH x AS (SELECT 1) SELECT * FROM x");
});

test("text with no SQL and no JSON still fails", () => {
  assert.throws(() => parseSqlResponse("I cannot do that."), /No JSON object/);
});
