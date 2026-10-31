#!/usr/bin/env node
// Text-to-SQL accuracy on the seeded Olist Postgres dataset, per model.
//
// For each model (and each condition) this boots a real server.js (so the actual prompt,
// SQL repair loop, safety validator and cost guard are in play), asks every question in
// olist-eval-cases.json through POST /api/ask, and scores the RESULT SET of the final SQL
// against the ground-truth SQL (row and column order ignored, numbers compared to 2 decimals).
// Generated SQL is never scored by string match.
//
//   DB_URL=postgresql://dbagent_ro:dbagent_ro@localhost:5433/olist PG_SSL=false \
//   MODELS=qwen2.5-coder:0.5b,qwen2.5-coder:1.5b node scripts/eval-olist-text2sql.js
//
// Env:
//   DB_URL / PG_SSL    the seeded database (a read-only role is enough)
//   MODELS             comma-separated model names (default qwen2.5-coder:0.5b)
//   CONDITIONS         comma-separated: "shipped" (default config, includes the seed examples from
//                      benchmarks.json) and/or "clean" (no benchmark examples in the prompt)
//   LLM_BASE_URL       OpenAI-compatible endpoint (default http://localhost:11434/v1, Ollama)
//   LLM_API_KEY        default "ollama"
//   OUT                path for the JSON results (default ./eval-results.json)
//   ONLY               only run questions containing this text
//   CASES              path to a cases file (default olist-eval-cases.json), e.g. adventureworks/cases.json
//   PG_SCHEMA          schema or comma list for the Postgres engine (default public)
//   Conditions can also be "kb=<path>": no benchmark examples, and that knowledge file in the prompt.
//
// Queries the cost guard would hold for approval are still scored: the harness runs them itself
// with a statement timeout, and counts them separately as "held by cost guard".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const ONLY = process.env.ONLY; // substring filter on the question, for re-running a few cases
const cases = JSON.parse(fs.readFileSync(path.resolve(process.env.CASES || path.join(here, "olist-eval-cases.json")), "utf8"))
  .filter((c) => !ONLY || c.question.includes(ONLY));

if (!process.env.DB_URL) {
  console.error("DB_URL is required (process environment only; .env is not read).");
  process.exit(2);
}
const MODELS = (process.env.MODELS || "qwen2.5-coder:0.5b").split(",").map((s) => s.trim()).filter(Boolean);
const CONDITIONS = (process.env.CONDITIONS || "shipped,clean").split(",").map((s) => s.trim());
const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434/v1";
const LLM_API_KEY = process.env.LLM_API_KEY || "ollama";
const OUT = process.env.OUT || "eval-results.json";
const ASK_TIMEOUT_MS = 240_000;
const SQL_TIMEOUT_MS = 90_000;

const pool = new pg.Pool({
  connectionString: process.env.DB_URL,
  ssl: process.env.PG_SSL === "false" ? false : undefined,
  statement_timeout: SQL_TIMEOUT_MS,
  max: 2,
});

async function runSql(sql) {
  const { rows, fields } = await pool.query({ text: sql, rowMode: "array" });
  return { columns: fields.map((f) => f.name), rows };
}

// ── result-set comparison ───────────────────────────────────────────────────
function norm(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))) {
    return String(Math.round(Number(v) * 100) / 100);
  }
  return String(v).trim();
}
const signature = (rows) => rows.map((r) => r.map(norm).sort().join("\u0001")).sort();
function sameResult(a, b) {
  const x = signature(a), y = signature(b);
  return x.length === y.length && x.every((s, i) => s === y[i]);
}
// Lenient: the answer may carry extra columns (e.g. the count next to a "which category" answer).
// True if some choice of columns, in any order, reproduces the ground-truth result set.
function sameResultLenient(got, want) {
  if (sameResult(got, want)) return true;
  const w = want[0]?.length ?? 0, g = got[0]?.length ?? 0;
  if (!w || g <= w || g > 8) return false;
  const pick = (start, chosen) => {
    if (chosen.length === w) return sameResult(got.map((r) => chosen.map((c) => r[c])), want);
    for (let c = start; c < g; c++) if (pick(c + 1, [...chosen, c])) return true;
    return false;
  };
  return pick(0, []);
}

// ── server lifecycle ────────────────────────────────────────────────────────
async function startServer({ model, condition, port }) {
  const emptyBench = path.join(os.tmpdir(), "db-agent-empty-benchmarks.json");
  fs.writeFileSync(emptyBench, "[]");
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    PORT: String(port), SQL_ENGINE: "postgres", DB_URL: process.env.DB_URL,
    PG_SSL: process.env.PG_SSL || "default", PG_SCHEMA: process.env.PG_SCHEMA || "public", ...(process.env.LLM_OUTPUT ? { LLM_OUTPUT: process.env.LLM_OUTPUT } : {}),
    LLM_BASE_URL, LLM_API_KEY, LLM_MODEL: model,
    MEMORY_ENABLED: "false", MEMORY_BACKEND: "local",
    ...(condition === "clean" || condition.startsWith("kb=") ? { BENCHMARKS_FILE: emptyBench, BENCHMARK_CASES_STORE_PATH: emptyBench } : {}),
    ...(condition.startsWith("kb=") ? { KNOWLEDGE_FILE: path.resolve(condition.slice(3)) } : {}),
  };
  const child = spawn("node", ["server.js"], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) return { child, port, log: () => log }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`server did not start:\n${log.slice(-800)}`);
}

async function ask(port, question) {
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/api/ask`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }), signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  const out = await res.json();
  return { out, ms: Date.now() - t0 };
}

const label = (c) => (c.startsWith("kb=") ? path.basename(c.slice(3), ".json") : c);

// ── main ────────────────────────────────────────────────────────────────────
console.log(`Computing ground truth for ${cases.length} questions...`);
const truth = [];
for (const c of cases) {
  const t0 = Date.now();
  const r = await runSql(c.groundTruthSql);
  truth.push(r.rows);
  console.log(`  ${(Date.now() - t0 + "ms").padStart(7)}  ${c.question.slice(0, 70)} -> ${JSON.stringify(r.rows.slice(0, 2))}`);
}

const results = [];
let port = 3150;
for (const model of MODELS) {
  for (const condition of CONDITIONS) {
    console.log(`\n=== ${model} / ${label(condition)} ===`);
    const srv = await startServer({ model, condition, port: port++ });
    const rowsOut = [];
    try {
      for (const [i, c] of cases.entries()) {
        let status, sql = null, ms = 0, repairs = 0, held = false, detail = "", lenient = false;
        try {
          const { out, ms: took } = await ask(srv.port, c.question);
          ms = took; sql = out.sql; repairs = out.repairAttempts || 0;
          held = out.status === "awaiting_approval";
          if (out.validation && out.validation.isSafe === false) { status = "rejected"; detail = out.validation.reason; }
          else if (out.error) { status = "sql_error"; detail = String(out.error).slice(0, 160); }
          else if (!sql) status = "no_sql";
          else {
            let got;
            if (held) {
              try { got = (await runSql(sql)).rows; } catch (e) { status = e.message.includes("timeout") ? "timeout" : "sql_error"; detail = e.message.slice(0, 160); }
            } else got = out.rows.map((r) => Object.values(r));
            if (!status) {
              status = sameResult(got, truth[i]) ? "pass" : "wrong_result";
              lenient = status === "pass" || sameResultLenient(got, truth[i]);
            }
            if (status === "wrong_result") detail = `got ${JSON.stringify(got.slice(0, 2))} want ${JSON.stringify(truth[i].slice(0, 2))}`.slice(0, 200);
          }
        } catch (e) { status = "request_failed"; detail = String(e.message).slice(0, 160); }
        rowsOut.push({ model, condition, difficulty: c.difficulty, question: c.question, status, lenient, held, repairs, ms, sql, detail });
        console.log(`  ${String(i + 1).padStart(2)} ${status.padEnd(12)} ${(ms / 1000).toFixed(1).padStart(5)}s${repairs ? ` r${repairs}` : "   "}${held ? " held" : "     "}  ${c.question.slice(0, 58)}`);
      }
    } finally {
      srv.child.kill();
    }
    results.push(...rowsOut);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  }
}
await pool.end();

// ── summary ─────────────────────────────────────────────────────────────────
console.log("\n=== Summary (pass / total) ===");
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
console.log("model".padEnd(22) + "condition".padEnd(14) + "strict".padEnd(14) + "lenient".padEnd(9) + "easy".padEnd(8) + "medium".padEnd(8) + "hard".padEnd(8) + "held".padEnd(6) + "avg s");
for (const model of MODELS) {
  for (const condition of CONDITIONS) {
    const rs = results.filter((r) => r.model === model && r.condition === condition);
    const by = (d) => rs.filter((r) => r.difficulty === d);
    const p = (xs) => xs.filter((r) => r.status === "pass").length;
    console.log(
      model.padEnd(22) + label(condition).padEnd(14) + `${p(rs)}/${rs.length} ${pct(p(rs), rs.length)}`.padEnd(14) +
        String(rs.filter((r) => r.lenient).length).padEnd(9) +
        `${p(by("easy"))}/${by("easy").length}`.padEnd(8) + `${p(by("medium"))}/${by("medium").length}`.padEnd(8) +
        `${p(by("hard"))}/${by("hard").length}`.padEnd(8) + String(rs.filter((r) => r.held).length).padEnd(6) +
        (rs.reduce((s, r) => s + r.ms, 0) / rs.length / 1000).toFixed(1)
    );
  }
}
console.log(`\nDetails: ${OUT}`);
