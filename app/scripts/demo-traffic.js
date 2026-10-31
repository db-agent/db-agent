#!/usr/bin/env node
// Generates real traffic for the spend report: several callers (each with its own key, team, tool
// and model) ask the Olist demo questions through the MCP gateway, plus web UI requests, blocked
// writes and bad keys. Every answer is a real model call, so tokens, latency and costs are real
// (prices come from the pricing table, which for local models is illustrative).
//
// It writes to its OWN request log and config, never your real ones:
//   DB_URL=postgresql://postgres:pw@localhost:5456/olist PG_SSL=false node scripts/demo-traffic.js
// then look at it:
//   GATEWAY_DB=data/gateway-demo.db GATEWAY_CONFIG=data/gateway-demo.json node server.js   (web: /api/report)
//   GATEWAY_DB=data/gateway-demo.db node bin/db-agent.js report --period day
//
// Env:
//   DB_URL / PG_SSL     the seeded Olist database (scripts/seed-olist-postgres.js)
//   LLM_BASE_URL        OpenAI-compatible endpoint (default http://localhost:11434/v1, Ollama)
//   ROUNDS              how many times each caller repeats its questions (default 2)
//   GATEWAY_DB          output log (default data/gateway-demo.db, replaced on each run)
//   PRICING_FILE        JSON with a "pricing" key (default gateway.example.json)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openStore } from "../gateway/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
if (!process.env.DB_URL) { console.error("DB_URL is required (the seeded Olist database)."); process.exit(2); }

const ROUNDS = Number(process.env.ROUNDS) || 2;
const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434/v1";
const GATEWAY_DB = path.resolve(appDir, process.env.GATEWAY_DB || "data/gateway-demo.db");
const CONFIG_PATH = path.join(path.dirname(GATEWAY_DB), "gateway-demo.json");
const cases = JSON.parse(fs.readFileSync(path.join(here, "olist-eval-cases.json"), "utf8"));
const pricing = JSON.parse(fs.readFileSync(path.resolve(appDir, process.env.PRICING_FILE || "gateway.example.json"), "utf8")).pricing;

const key = () => crypto.randomBytes(18).toString("hex");
const sha = (k) => crypto.createHash("sha256").update(k).digest("hex");
const callers = [
  { user: "alice", team: "analytics", tool: "claude-desktop", model: "qwen2.5-coder:1.5b", mode: "ask", questions: cases },
  { user: "bob", team: "analytics", tool: "vscode", model: "qwen2.5-coder:0.5b", mode: "ask", questions: cases },
  { user: "carol", team: "finance", tool: "claude-code", model: "qwen2.5-coder:7b", mode: "ask", questions: cases.filter((c) => c.difficulty !== "hard") },
  { user: "dave", team: "finance", tool: "ci-bot", model: "qwen2.5-coder:1.5b", mode: "sql", questions: cases },
].map((c) => ({ ...c, key: key() }));

fs.mkdirSync(path.dirname(GATEWAY_DB), { recursive: true });
for (const f of [GATEWAY_DB, `${GATEWAY_DB}-wal`, `${GATEWAY_DB}-shm`]) fs.rmSync(f, { force: true });
fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  callers: callers.map((c) => ({ keySha256: sha(c.key), user: c.user, team: c.team, tool: c.tool })),
  pricing,
}, null, 2), { mode: 0o600 });

const baseEnv = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  SQL_ENGINE: "postgres", DB_URL: process.env.DB_URL, PG_SSL: process.env.PG_SSL || "default",
  LLM_BASE_URL, LLM_API_KEY: process.env.LLM_API_KEY || "ollama",
  MEMORY_ENABLED: "false", MEMORY_BACKEND: "local",
  GATEWAY_CONFIG: CONFIG_PATH, GATEWAY_DB,
};
const SLOW = { timeout: 300_000 };
const store = openStore(GATEWAY_DB);
let asked = 0, held = 0;

async function mcpCaller(c) {
  const client = new Client({ name: c.tool, version: "1" });
  await client.connect(new StdioClientTransport({
    command: "node", args: [path.join(appDir, "bin", "db-agent.js"), "mcp", "serve", "--stdio"],
    env: { ...baseEnv, LLM_MODEL: c.model, DB_AGENT_API_KEY: c.key }, stderr: "pipe",
  }));
  const call = async (name, args) => (await client.callTool({ name, arguments: args }, undefined, SLOW)).content[0].text;

  for (let round = 0; round < ROUNDS; round++) {
    for (const q of c.questions) {
      const args = c.mode === "ask" ? { question: q.question } : { sql: q.groundTruthSql };
      const text = await call(c.mode === "ask" ? "ask" : "run_sql", args);
      asked++;
      const id = text.match(/^Needs approval:.*?(apr_[0-9a-f]+)/s)?.[1];
      if (id) {
        // An approver says yes to most held queries, so the report shows approved work and not only holds.
        held++;
        if (held % 3 !== 0) {
          store.decideApproval(id, "approved", "demo-approver");
          await call(c.mode === "ask" ? "ask" : "run_sql", { approval_id: id });
        }
      }
    }
  }
  if (c.mode === "sql") {
    for (const sql of ["DELETE FROM orders", "DROP TABLE order_items", "SELECT 1; DELETE FROM customers", "UPDATE orders SET order_status = 'x'"]) {
      await call("run_sql", { sql });
    }
  }
  await client.close();
  console.log(`  ${c.user.padEnd(6)} ${c.team.padEnd(10)} ${c.tool.padEnd(15)} ${c.model}`);
}

async function webTraffic() {
  const port = 3990;
  const child = spawn("node", ["server.js"], { cwd: appDir, env: { ...baseEnv, PORT: String(port), LLM_MODEL: "qwen2.5-coder:1.5b" }, stdio: "ignore" });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    for (const q of cases.filter((c) => c.difficulty !== "hard").slice(0, 10)) {
      const res = await fetch(`http://127.0.0.1:${port}/api/ask`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q.question }),
      });
      await res.json();
      asked++;
    }
    console.log("  (web)  -          web-ui          qwen2.5-coder:1.5b");
  } finally {
    child.kill();
  }
}

console.log(`Generating traffic (${ROUNDS} round(s)) into ${GATEWAY_DB}`);
const t0 = Date.now();
for (const c of callers) await mcpCaller(c);
await webTraffic();
// A few calls with a key nobody issued.
for (let i = 0; i < 3; i++) store.logRequest({ channel: "mcp-http", status: "rejected_auth", reason: "unknown or missing API key" });
store.close();
console.log(`Done: ${asked} questions, ${held} held for approval, ${Math.round((Date.now() - t0) / 1000)}s.`);
