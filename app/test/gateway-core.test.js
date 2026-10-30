import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { parseGatewayConfig, authenticate, allowedTables, sha256 } from "../gateway/config.js";
import { makeGuard } from "../gateway/tablePolicy.js";
import { openStore } from "../gateway/store.js";
import { createGateway } from "../gateway/core.js";
import { validateSql } from "../sqlSafety.js";

const KEY_A = "key-alice-claude-0123456789";
const KEY_B = "key-alice-copilot-0123456789";

const rawConfig = {
  callers: [
    { key: KEY_A, user: "alice", team: "analytics", tool: "claude-desktop" },
    { key: KEY_B, user: "alice", team: "analytics", tool: "vscode-copilot" },
    { key: "key-bob-ci-bot-0123456789", user: "bob", tool: "ci-bot", allowTables: ["orders"] },
  ],
  tables: { deny: ["customers"] },
};

const schema = {
  orders: [{ name: "id", type: "INTEGER" }, { name: "status", type: "TEXT" }],
  products: [{ name: "id", type: "INTEGER" }],
  customers: [{ name: "id", type: "INTEGER" }, { name: "email", type: "TEXT" }],
};

// Stands in for server.js's pipeline: same contract, no database or LLM.
function fakePipeline(calls = []) {
  return {
    getSchema: async () => schema,
    getKnowledge: () => ({ descriptions: { "orders.status": "one of completed, pending", orders: "one row per order" } }),
    approvalReason: (a) => (a.sizeInBytes > 1000 ? "Estimated data size 5 GB exceeds the 1 GB limit." : null),
    analyzeQuery: async () => ({ sizeInBytes: 5000, sizeLabel: "5 KB", rowCount: 10 }),
    runPipeline: async (question, { rawSql, allowTable, guardSql }) => {
      calls.push({ question, rawSql });
      const sql = rawSql || "SELECT id FROM orders";
      const out = { question, sql, explanation: null, validation: null, columns: null, rows: null, error: null, analysis: null, status: null, approvalReason: null };
      const validation = validateSql(sql);
      out.validation = validation;
      if (!validation.isSafe) return out;
      const blocked = guardSql?.(sql);
      if (blocked) { out.validation = { isSafe: false, reason: blocked }; return out; }
      if (sql.includes("big_scan")) {
        return { ...out, analysis: { sizeInBytes: 5000, rowCount: 10 }, status: "awaiting_approval", approvalReason: "Estimated data size 5 GB exceeds the 1 GB limit." };
      }
      return { ...out, columns: ["id"], rows: [{ id: 1 }, { id: 2 }], status: "complete", analysis: { sizeInBytes: 10, rowCount: 2, sizeLabel: "10 B" } };
    },
    executeApprovedSql: async (sql) => {
      const v = validateSql(sql);
      return v.isSafe ? { sql, columns: ["id"], rows: [{ id: 9 }], error: null, status: "complete" } : { sql, rows: null, error: v.reason };
    },
  };
}

function setup(pipeline = fakePipeline()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
  const store = openStore(path.join(dir, "gateway.db"));
  const config = parseGatewayConfig(rawConfig);
  const gateway = createGateway({ config, store, pipeline });
  const caller = (key) => gateway.authenticate(key);
  return { gateway, store, caller, dir };
}

test("config: keys are matched by hash, unknown keys are rejected, env: and keySha256 forms work", () => {
  process.env.GW_TEST_KEY = "env-key-0123456789abcdef";
  const cfg = parseGatewayConfig({ callers: [
    { key: "env:GW_TEST_KEY", user: "u1", tool: "t1" },
    { keySha256: sha256("hashed-key-0123456789"), user: "u2", tool: "t2" },
  ] });
  assert.equal(authenticate(cfg, "env-key-0123456789abcdef").user, "u1");
  assert.equal(authenticate(cfg, "hashed-key-0123456789").tool, "t2");
  assert.equal(authenticate(cfg, "wrong"), null);
  assert.equal(authenticate(cfg, undefined), null);
  assert.ok(!JSON.stringify(cfg).includes("env-key-0123456789abcdef"), "plain keys are not kept");
});

test("config: a caller with an unset env key is skipped with a warning; none left is an error", () => {
  delete process.env.GW_UNSET_KEY;
  const warnings = [];
  const cfg = parseGatewayConfig({ callers: [
    { key: "env:GW_UNSET_KEY", user: "u1", tool: "t1" },
    { key: KEY_A, user: "u2", tool: "t2" },
  ] }, { warn: (m) => warnings.push(m) });
  assert.equal(cfg.callers.length, 1);
  assert.match(warnings[0], /GW_UNSET_KEY/);
  assert.throws(() => parseGatewayConfig({ callers: [{ key: "env:GW_UNSET_KEY", user: "u1", tool: "t1" }] }, { warn() {} }), /no caller/);
});

test("config: weak or duplicate keys and missing fields are refused", () => {
  assert.throws(() => parseGatewayConfig({ callers: [{ key: "short", user: "a", tool: "b" }] }), /at least 16/);
  assert.throws(() => parseGatewayConfig({ callers: [{ key: KEY_A, tool: "b" }] }), /"user"/);
  assert.throws(() => parseGatewayConfig({ callers: [{ key: KEY_A, user: "a", tool: "b" }, { key: KEY_A, user: "c", tool: "d" }] }), /reuses/);
  assert.throws(() => parseGatewayConfig({ callers: [] }), /callers/);
});

test("allowedTables applies global deny, global allow and the per-caller list", () => {
  const cfg = parseGatewayConfig(rawConfig);
  const all = ["orders", "products", "customers"];
  assert.deepEqual(allowedTables(cfg, authenticate(cfg, KEY_A), all), ["orders", "products"]);
  assert.deepEqual(allowedTables(cfg, authenticate(cfg, "key-bob-ci-bot-0123456789"), all), ["orders"]);
});

test("table guard blocks hidden tables however they are written, and ignores strings and comments", () => {
  const guard = makeGuard(["customers"]);
  assert.match(guard("SELECT * FROM customers"), /customers/);
  assert.match(guard('SELECT * FROM "Customers"'), /Customers/);
  assert.match(guard("SELECT * FROM main.customers c"), /customers/);
  assert.match(guard("SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id"), /customers/);
  assert.equal(guard("SELECT 'customers' AS label FROM orders -- customers"), null);
  assert.equal(guard("SELECT id FROM orders"), null);
  assert.equal(makeGuard([])("SELECT * FROM customers"), null);
});

test("an invalid key is rejected and logged as rejected_auth without the key", () => {
  const { gateway, store } = setup();
  assert.equal(gateway.authenticate("not-a-real-key-000000000"), null);
  const [row] = store.listRequests();
  assert.equal(row.status, "rejected_auth");
  assert.ok(!JSON.stringify(row).includes("not-a-real-key"));
});

test("the same question from two keys is logged under two tools", async () => {
  const { gateway, store, caller } = setup();
  await gateway.call(caller(KEY_A), "ask", { question: "how many orders?" });
  await gateway.call(caller(KEY_B), "ask", { question: "how many orders?" });
  const rows = store.listRequests().filter((r) => r.mcp_tool === "ask");
  assert.deepEqual(rows.map((r) => r.tool).sort(), ["claude-desktop", "vscode-copilot"]);
  assert.ok(rows.every((r) => r.user === "alice" && r.team === "analytics" && r.status === "ok" && r.question === "how many orders?"));
});

test("writes are blocked with a readable message and logged as blocked", async () => {
  const { gateway, store, caller } = setup();
  const bad = [
    "DELETE FROM orders", "UPDATE orders SET status = 'x'", "DROP TABLE orders",
    "SELECT 1; DROP TABLE orders", "SELECT 1 /* ; */ ; DELETE FROM orders", "/* hi */ DELETE FROM orders",
    "SELECT id FROM orders -- \nDELETE FROM orders", "WITH x AS (DELETE FROM orders RETURNING id) SELECT * FROM x",
  ];
  for (const sql of bad) {
    const r = await gateway.call(caller(KEY_A), "run_sql", { sql });
    assert.equal(r.isError, true, sql);
    assert.match(r.text, /^Blocked: /, sql);
  }
  assert.equal(store.listRequests().filter((r) => r.status === "blocked").length, bad.length);
});

test("table policy blocks a hidden table in run_sql and ask, and hides it from list and describe", async () => {
  const { gateway, caller } = setup();
  const a = caller(KEY_A);
  const r = await gateway.call(a, "run_sql", { sql: "SELECT email FROM customers" });
  assert.equal(r.isError, true);
  assert.match(r.text, /^Blocked: table "customers"/);
  assert.deepEqual(JSON.parse((await gateway.call(a, "list_tables")).text).tables, ["orders", "products"]);
  const hidden = await gateway.call(a, "describe_table", { table: "customers" });
  const missing = await gateway.call(a, "describe_table", { table: "nope" });
  assert.equal(hidden.isError, true);
  assert.equal(hidden.text.replace("customers", "X"), missing.text.replace("nope", "X"), "hidden looks like missing");
  assert.deepEqual(JSON.parse((await gateway.call(caller("key-bob-ci-bot-0123456789"), "list_tables")).text).tables, ["orders"]);
});

test("describe_table adds descriptions from the knowledge file", async () => {
  const { gateway, caller } = setup();
  const body = JSON.parse((await gateway.call(caller(KEY_A), "describe_table", { table: "orders" })).text);
  assert.equal(body.description, "one row per order");
  assert.equal(body.columns.find((c) => c.name === "status").description, "one of completed, pending");
  assert.equal(body.columns.find((c) => c.name === "id").description, undefined);
});

test("an expensive query is held, then runs once after approval", async () => {
  const { gateway, store, caller } = setup();
  const a = caller(KEY_A);
  const held = await gateway.call(a, "run_sql", { sql: "SELECT * FROM orders -- big_scan" });
  assert.equal(held.isError, false);
  assert.match(held.text, /^Needs approval: Estimated data size 5 GB exceeds the 1 GB limit\. Approval id: (apr_[0-9a-f]+)/);
  const id = held.text.match(/apr_[0-9a-f]+/)[0];

  const pending = await gateway.call(a, "run_sql", { approval_id: id });
  assert.match(pending.text, /Still waiting for approval/);

  assert.equal(store.decideApproval(id, "approved", "carol"), true);
  const ran = await gateway.call(a, "run_sql", { approval_id: id });
  assert.equal(ran.isError, false);
  assert.match(ran.text, /Query returned 1 row/);
  assert.match(ran.text, /"approvedBy": "carol"/);

  const again = await gateway.call(a, "run_sql", { approval_id: id });
  assert.equal(again.isError, true);
  assert.match(again.text, /already used/);

  const statuses = store.listRequests().map((r) => r.status).reverse();
  assert.deepEqual(statuses, ["needs_approval", "needs_approval", "ok", "blocked"]);
  assert.equal(store.listRequests().find((r) => r.status === "ok").approval_id, id);
});

test("an approval for ask runs the held SQL, not a regenerated one", async () => {
  const calls = [];
  const { gateway, store, caller } = setup(fakePipeline(calls));
  const a = caller(KEY_A);
  // Make the fake "LLM" hold this question.
  const pipe = fakePipeline(calls);
  const orig = pipe.runPipeline;
  pipe.runPipeline = (q, o) => orig(q, { ...o, rawSql: "SELECT * FROM orders -- big_scan" });
  const gw = createGateway({ config: gateway.config, store, pipeline: pipe });
  const held = await gw.call(a, "ask", { question: "everything please" });
  const id = held.text.match(/apr_[0-9a-f]+/)[0];
  store.decideApproval(id, "approved", "carol");
  const before = calls.length;
  const ran = await gw.call(a, "ask", { approval_id: id });
  assert.equal(ran.isError, false);
  assert.equal(calls.length, before, "no second trip through the LLM pipeline");
});

test("approvals are bound to the caller, the tool, and the held SQL; denied and expired ones do not run", async () => {
  const { gateway, store, caller } = setup();
  const held = await gateway.call(caller(KEY_A), "run_sql", { sql: "SELECT * FROM orders -- big_scan" });
  const id = held.text.match(/apr_[0-9a-f]+/)[0];
  store.decideApproval(id, "approved", "carol");

  const other = await gateway.call(caller(KEY_B), "run_sql", { approval_id: id });
  assert.match(other.text, /different caller/);
  const wrongTool = await gateway.call(caller(KEY_A), "ask", { approval_id: id });
  assert.match(wrongTool.text, /issued for run_sql/);
  const swapped = await gateway.call(caller(KEY_A), "run_sql", { sql: "SELECT 2", approval_id: id });
  assert.match(swapped.text, /differs from the SQL that was held/);
  assert.match((await gateway.call(caller(KEY_A), "run_sql", { approval_id: "apr_deadbeef00" })).text, /unknown approval/);

  const held2 = await gateway.call(caller(KEY_A), "run_sql", { sql: "SELECT * FROM products -- big_scan" });
  const id2 = held2.text.match(/apr_[0-9a-f]+/)[0];
  store.decideApproval(id2, "denied", "carol");
  assert.match((await gateway.call(caller(KEY_A), "run_sql", { approval_id: id2 })).text, /denied by carol/);

  const gw2 = createGateway({ config: gateway.config, store, pipeline: fakePipeline(), approvalTtlMinutes: -1 });
  const held3 = await gw2.call(caller(KEY_A), "run_sql", { sql: "SELECT * FROM products -- big_scan" });
  const id3 = held3.text.match(/apr_[0-9a-f]+/)[0];
  assert.equal(store.decideApproval(id3, "approved", "carol"), false, "an expired approval cannot be decided");
  assert.match((await gw2.call(caller(KEY_A), "run_sql", { approval_id: id3 })).text, /expired/);
});

test("explain_cost estimates without running and says whether approval would be needed", async () => {
  const calls = [];
  const { gateway, caller } = setup(fakePipeline(calls));
  const r = await gateway.call(caller(KEY_A), "explain_cost", { sql: "SELECT * FROM orders" });
  const body = JSON.parse(r.text);
  assert.equal(body.cost.estimatedBytes, 5000);
  assert.equal(body.wouldNeedApproval, true);
  assert.equal(calls.length, 0, "nothing was executed");
  assert.match((await gateway.call(caller(KEY_A), "explain_cost", { sql: "DROP TABLE orders" })).text, /^Blocked: /);
});

test("rows are capped by limits.maxRows", async () => {
  const pipeline = fakePipeline();
  pipeline.runPipeline = async () => ({ sql: "SELECT 1", columns: ["n"], rows: Array.from({ length: 500 }, (_, n) => ({ n })), status: "complete", validation: { isSafe: true }, error: null });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
  const gateway = createGateway({ config: parseGatewayConfig({ ...rawConfig, limits: { maxRows: 50 } }), store: openStore(path.join(dir, "g.db")), pipeline });
  const r = await gateway.call(gateway.authenticate(KEY_A), "run_sql", { sql: "SELECT 1" });
  const body = JSON.parse(r.text.slice(r.text.indexOf("\n") + 1));
  assert.equal(body.rowCount, 500);
  assert.equal(body.rows.length, 50);
  assert.match(body.truncated, /first 50/);
});
