// End to end: real MCP clients (the official SDK) against `db-agent mcp serve`, which runs the
// real server.js pipeline on the bundled SQLite demo database. No LLM is called (run_sql only).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openStore } from "../gateway/store.js";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(appDir, "bin", "db-agent.js");
const KEY_CLAUDE = "e2e-claude-key-0123456789";
const KEY_COPILOT = "e2e-copilot-key-0123456789";

let dir, env, dbPath;
const children = [];

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-e2e-"));
  dbPath = path.join(dir, "gateway.db");
  const configPath = path.join(dir, "gateway.json");
  fs.writeFileSync(configPath, JSON.stringify({
    callers: [
      { key: KEY_CLAUDE, user: "alice", team: "analytics", tool: "claude-desktop" },
      { key: KEY_COPILOT, user: "alice", team: "analytics", tool: "vscode-copilot" },
    ],
    tables: { deny: ["customers"] },
  }));
  env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    SQL_ENGINE: "sqlite", MEMORY_ENABLED: "false", MEMORY_BACKEND: "local",
    GATEWAY_CONFIG: configPath, GATEWAY_DB: dbPath,
  };
});
after(() => children.forEach((c) => c.kill()));

async function stdioClient(key) {
  const transport = new StdioClientTransport({
    command: "node", args: [cli, "mcp", "serve", "--stdio"], env: { ...env, DB_AGENT_API_KEY: key }, stderr: "pipe",
  });
  const client = new Client({ name: "e2e", version: "1" });
  await client.connect(transport);
  return client;
}
const text = (r) => r.content[0].text;
const dbRows = () => {
  const store = openStore(dbPath);
  try { return store.listRequests({ limit: 500 }); } finally { store.close(); }
};

test("stdio: lists the five tools and answers run_sql with rows and cost", async () => {
  const client = await stdioClient(KEY_CLAUDE);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["ask", "describe_table", "explain_cost", "list_tables", "run_sql"]);
    assert.deepEqual(JSON.parse(text(await client.callTool({ name: "list_tables", arguments: {} }))).tables.sort(), ["orders", "products"]);
    const r = await client.callTool({ name: "run_sql", arguments: { sql: "SELECT COUNT(*) AS n FROM orders" } });
    assert.ok(!r.isError, text(r));
    assert.match(text(r), /Query returned 1 row/);
    const ex = await client.callTool({ name: "explain_cost", arguments: { sql: "SELECT COUNT(*) FROM orders" } });
    assert.match(text(ex), /cannot estimate cost/);
  } finally { await client.close(); }
});

test("stdio: writes, multi-statement and comment-hidden writes are blocked; hidden table is blocked", async () => {
  const client = await stdioClient(KEY_CLAUDE);
  try {
    const bad = [
      "DELETE FROM orders", "UPDATE orders SET status = 'x'", "DROP TABLE orders",
      "SELECT 1; DROP TABLE orders", "SELECT 1 /* ; */ ; DELETE FROM orders",
      "/* harmless */ DELETE FROM orders", "SELECT id FROM orders -- x\nDELETE FROM orders",
    ];
    for (const sql of bad) {
      const r = await client.callTool({ name: "run_sql", arguments: { sql } });
      assert.equal(r.isError, true, sql);
      assert.match(text(r), /^Blocked: /, sql);
    }
    const hidden = await client.callTool({ name: "run_sql", arguments: { sql: "SELECT email FROM customers" } });
    assert.match(text(hidden), /^Blocked: table "customers"/);
    // Nothing was deleted.
    const n = await client.callTool({ name: "run_sql", arguments: { sql: "SELECT COUNT(*) AS n FROM orders" } });
    assert.ok(!n.isError);
  } finally { await client.close(); }
});

test("stdio: an invalid key refuses to start and is logged as rejected", () => {
  const before = dbRows().filter((r) => r.status === "rejected_auth").length;
  const res = spawnSync("node", [cli, "mcp", "serve", "--stdio"], {
    env: { ...env, DB_AGENT_API_KEY: "wrong-key-0123456789abc" }, encoding: "utf8", timeout: 30_000,
  });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /not a known key/);
  assert.ok(!res.stderr.includes("wrong-key-0123456789abc"));
  assert.equal(dbRows().filter((r) => r.status === "rejected_auth").length, before + 1);
});

test("http: two keys are logged as two tools; a bad key gets 401 and is logged", async () => {
  const port = 3300 + Math.floor(Math.random() * 400);
  const child = spawn("node", [cli, "mcp", "serve", "--http", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("http server did not start")), 20_000);
    child.stdout.on("data", (d) => { if (String(d).includes("streamable HTTP")) { clearTimeout(t); resolve(); } });
    child.on("exit", (code) => reject(new Error(`exited ${code}`)));
  });
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const question = "SELECT COUNT(*) AS n FROM products";

  for (const key of [KEY_CLAUDE, KEY_COPILOT]) {
    const client = new Client({ name: "e2e-http", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
    const r = await client.callTool({ name: "run_sql", arguments: { sql: question } });
    assert.ok(!r.isError, text(r));
    await client.close();
  }
  const mine = dbRows().filter((r) => r.channel === "mcp" && r.sql === question && r.mcp_tool === "run_sql");
  assert.deepEqual(mine.map((r) => r.tool).sort(), ["claude-desktop", "vscode-copilot"]);

  const before = dbRows().filter((r) => r.status === "rejected_auth").length;
  const bad = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer nope-nope-nope-nope-nope" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(bad.status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal(dbRows().filter((r) => r.status === "rejected_auth").length, before + 2);
});

test("cli: approvals list, approve and deny update the shared store", () => {
  const store = openStore(dbPath);
  const caller = { user: "alice", team: "analytics", tool: "claude-desktop" };
  const a = store.createApproval({ caller, mcpTool: "run_sql", sql: "SELECT 1", reason: "too big", ttlMinutes: 10 });
  const b = store.createApproval({ caller, mcpTool: "run_sql", sql: "SELECT 2", reason: "too big", ttlMinutes: 10 });
  store.close();
  const run = (...args) => spawnSync("node", [cli, ...args], { env, encoding: "utf8", timeout: 30_000 });

  assert.match(run("approvals").stdout, new RegExp(a));
  const ok = run("approve", a);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Approved/);
  assert.equal(run("deny", b).status, 0);
  assert.notEqual(run("approve", a).status, 0, "cannot decide twice");
  assert.notEqual(run("approve", "apr_nothing").status, 0);

  const check = openStore(dbPath);
  assert.equal(check.getApproval(a).status, "approved");
  assert.equal(check.getApproval(b).status, "denied");
  check.close();
  assert.match(run("log", "--limit", "5").stdout, /status/);
});
