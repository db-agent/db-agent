// The ontology routes against a real server.js on the bundled SQLite demo. No LLM is called.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let child, base, dir, kbPath;
const api = async (p, opts = {}) => {
  const res = await fetch(base + p, { ...opts, headers: { "content-type": "application/json" } });
  return { status: res.status, text: await res.text() };
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "onto-"));
  kbPath = path.join(dir, "knowledge.json");
  fs.writeFileSync(path.join(dir, "none.json"), "[]");
  const port = 3500 + Math.floor(Math.random() * 400);
  base = `http://127.0.0.1:${port}`;
  child = spawn("node", ["server.js"], {
    cwd: appDir, stdio: "ignore",
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), SQL_ENGINE: "sqlite", MEMORY_ENABLED: "false", MEMORY_BACKEND: "local",
      KNOWLEDGE_FILE: kbPath, BENCHMARKS_FILE: path.join(dir, "none.json"), BENCHMARK_CASES_STORE_PATH: path.join(dir, "cases.json"), GATEWAY_DB: path.join(dir, "g.db"),
    },
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/api/config")).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});
after(() => child?.kill());

test("no file yet: empty knowledge", async () => {
  const r = JSON.parse((await api("/api/ontology")).text);
  assert.equal(r.exists, false);
  assert.deepEqual(r.knowledge, { descriptions: {}, expressions: {}, examples: [], instructions: [] });
});

test("scan reads metadata, returns a draft merged under what is saved, and saves nothing", async () => {
  const { status, text } = await api("/api/ontology/scan", { method: "POST" });
  assert.equal(status, 200, text);
  const r = JSON.parse(text);
  assert.ok(r.scan.summary.tables >= 2);
  assert.ok(r.scan.todo.length > 0);
  assert.ok(r.merged.descriptions && Array.isArray(r.merged.examples));
  assert.equal(fs.existsSync(kbPath), false, "scan must not write the knowledge file");
});

test("save validates, writes the file the pipeline reads, and keeps a backup of the previous one", async () => {
  const bad = await api("/api/ontology", { method: "PUT", body: JSON.stringify({ descriptions: { a: 5 } }) });
  assert.equal(bad.status, 400);
  const first = await api("/api/ontology", { method: "PUT", body: JSON.stringify({ descriptions: { "orders.status": "5 = shipped" }, instructions: ["Be careful."] }) });
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.text).backup, null);
  const second = await api("/api/ontology", { method: "PUT", body: JSON.stringify({ descriptions: { "orders.status": "5 = shipped, 6 = cancelled" }, expressions: { revenue: "SUM(x)" } }) });
  assert.ok(JSON.parse(second.text).backup);
  assert.equal(JSON.parse(fs.readFileSync(kbPath, "utf8")).expressions.revenue, "SUM(x)");
  const read = JSON.parse((await api("/api/ontology")).text);
  assert.equal(read.exists, true);
  assert.equal(read.knowledge.descriptions["orders.status"], "5 = shipped, 6 = cancelled");
});

test("export: skill file and json", async () => {
  const skill = await api("/api/ontology/export?format=skill");
  assert.match(skill.text, /^---\nname: sqlite-data-guide/);
  assert.match(skill.text, /\*\*revenue\*\*: `SUM\(x\)`/);
  assert.equal(JSON.parse((await api("/api/ontology/export")).text).expressions.revenue, "SUM(x)");
});

test("accuracy test: idle before a run, and a clear error with no benchmark questions that fit", async () => {
  assert.equal(JSON.parse((await api("/api/ab/status")).text).status, "idle");
  await api("/api/benchmarks", { method: "POST", body: JSON.stringify({ question: "q", groundTruthSql: "SELECT 1 FROM nowhere_table" }) });
  const cases = JSON.parse((await api("/api/ab/cases")).text);
  assert.equal(cases.eligible.length, 0, "a question about a table this database lacks is not offered");
  const start = await api("/api/ab/start", { method: "POST", body: "{}" });
  assert.equal(start.status, 409);
  assert.match(start.text, /No benchmark question fits/);
});
