// server.js — Node.js/Express port of the same text-to-SQL agent as the
// Streamlit app (../app.py, ../pipeline.py, ../core/*), built to compare how
// the UI feels on a real frontend stack vs. Streamlit. Scope is intentionally
// narrower than the Python app: SQLite only, single LLM (no failover chain,
// no Databricks backend) — same prompt → SQL → safety-check → execute →
// results loop, plus the SQL repair loop and cross-platform memory feature
// ported from core/pipeline.py and core/memory.py.

import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchRelevantMemories, invalidateFollowup, writeMemory } from "./memory.js";
import { createMemoryBackend, listMemoryBackends } from "./memoryBackends/index.js";
import { createSqlEngine, listSqlEngines } from "./sqlEngines/index.js";
import { formatKnowledge, loadKnowledge, selectRelevantKnowledge } from "./knowledge.js";
import { validateSql } from "./sqlSafety.js";
import { needsCostAnalysis } from "./queryShape.js";
import { sqlFitsSchema } from "./exampleFit.js";
import { benchmarkStore } from "./benchmarks.js";
import { describeError, log, warn } from "./logger.js";
import { openStore } from "./gateway/store.js";
import { estimateCosts, loadPricing } from "./gateway/costs.js";
import { buildReport, renderHtml, REPORT_PERIODS } from "./gateway/report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Databricks Apps injects DATABRICKS_APP_PORT and expects the app to bind to
// it; PORT is the local-dev fallback.
const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 3001;
// Self-contained default (data/demo.db bundled alongside this file) so the
// app has no path dependency outside its own deployed source tree — required
// since Databricks Apps deploys app/ as its own isolated source root,
// not the whole repo. DB_PATH can still override to ../data/demo.db for
// local dev that shares the root Python app's seeded DB.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "demo.db");
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
// .trim(): a secret pushed via `echo "$TOKEN" | databricks secrets
// put-secret` bakes in a trailing newline, which later fails as "not a
// legal HTTP header value" on the Authorization header — trimming here
// makes the app resilient to that regardless of how the secret was set.
const LLM_API_KEY = (process.env.LLM_API_KEY || "no-key").trim();
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const MAX_REPAIR_ATTEMPTS = 2;
// Optional per-deployment context (descriptions, expressions, example
// queries, instructions) — see knowledge.js. Absent file = no change to
// existing behavior.
const KNOWLEDGE_PATH = process.env.KNOWLEDGE_FILE || path.join(__dirname, "knowledge.json");
// Local-only feedback log — no cross-agent sharing (unlike the memory
// store), no dashboard. Just a greppable JSONL so wrong answers can be
// triaged manually; the real payoff comes once a benchmark runner (#40)
// can turn fixed thumbs-down cases into regression tests.
const FEEDBACK_PATH = process.env.FEEDBACK_STORE_PATH || path.join(__dirname, "data", "feedback.jsonl");

// The chat model (SQL generation, repair, memory summarization) and the
// embedding model don't need to be the same endpoint. This matters for
// cross-platform memory specifically: two agents can use completely
// different LLM backends for chat, but their EMBEDDING calls must land on
// the same model, or the shared vector store's cosine similarity is
// comparing two unrelated vector spaces. Defaults to LLM_BASE_URL/KEY if
// unset, so single-endpoint setups (the common case) need no extra config.
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || LLM_BASE_URL;
const EMBEDDING_API_KEY = (process.env.EMBEDDING_API_KEY || "").trim() || LLM_API_KEY;

// ── Cross-platform contextual memory config ─────────────────────────────────
// MEMORY_BACKEND selects the storage backend from the pluggable registry in
// memoryBackends/index.js — "local" (default, no cloud setup), "s3vectors"
// (AWS S3 Vectors, requires MEMORY_S3_BUCKET + MEMORY_ORG_ID + a
// pre-provisioned vector bucket/index), or "milvus" (self-hosted or Zilliz
// Cloud, requires MILVUS_ADDRESS + MEMORY_VECTOR_DIM matching
// EMBEDDING_MODEL's output dimension) — see app/README.md. Adding a new
// backend means adding one entry to that registry, not touching this file.
const memoryBackend = createMemoryBackend(process.env.MEMORY_BACKEND, {
  env: process.env,
  dataDir: path.join(__dirname, "data"),
});

// ── SQL engine config ────────────────────────────────────────────────────────
// SQL_ENGINE selects the query engine from the pluggable registry in
// sqlEngines/index.js — default is "databricks-sql". Mutable so the sidebar
// can reconnect via POST /api/sql-connection without restarting the process.
const DATA_DIR = path.join(__dirname, "data");
let activeSqlEngineName = (process.env.SQL_ENGINE || "databricks-sql").toLowerCase();
let sqlEngine = createSqlEngine(activeSqlEngineName, {
  env: process.env,
  dataDir: DATA_DIR,
});

// In-memory Databricks connection override (session-only; does not rewrite .env).
function databricksConnectionFromEnv() {
  return {
    host: process.env.DATABRICKS_HOST || "",
    httpPath: process.env.DATABRICKS_HTTP_PATH || "",
    token: process.env.DATABRICKS_TOKEN || "",
    catalog: process.env.DATABRICKS_CATALOG || "",
    schema: process.env.DATABRICKS_SCHEMA || "",
    maxRows: process.env.DATABRICKS_MAX_ROWS || "",
  };
}
let databricksConnection = databricksConnectionFromEnv();

async function replaceSqlEngine(name, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  const next = createSqlEngine(name, { env, dataDir: DATA_DIR });
  // Verify before swapping so a bad token doesn't leave us disconnected.
  await next.getSchema();
  if (typeof sqlEngine.reset === "function") {
    await sqlEngine.reset().catch(() => {});
  }
  sqlEngine = next;
  activeSqlEngineName = name;
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v != null) process.env[k] = String(v);
  }
  process.env.SQL_ENGINE = name;
}

// ── Request log and cost estimates ───────────────────────────────────────────
// Web requests are written to the same store as MCP calls (gateway/store.js), so one report covers
// both. Failure to open the store (read-only filesystem, say) turns logging off; it never breaks answers.
const GATEWAY_DB = process.env.GATEWAY_DB || path.join(DATA_DIR, "gateway.db");
const GATEWAY_CONFIG = process.env.GATEWAY_CONFIG || path.join(__dirname, "gateway.json");
let requestStore = null;
try {
  requestStore = openStore(GATEWAY_DB);
} catch (exc) {
  warn(`[requests] request log disabled (${GATEWAY_DB}): ${describeError(exc)}`);
}
const pricing = loadPricing(GATEWAY_CONFIG);

function costsFor(out) {
  return estimateCosts({ usage: out.usage, analysis: out.analysis, engineType: sqlEngine.describe().type, pricing });
}

function logWebRequest(mcpTool, out, { question = null, durationMs = null } = {}) {
  if (!requestStore) return;
  try {
    const status = out.validation?.isSafe === false ? "blocked" : out.error ? "error" : out.status === "awaiting_approval" ? "needs_approval" : out.rows ? "ok" : "error";
    const costs = costsFor(out);
    requestStore.logRequest({
      channel: "web", tool: "web-ui", mcpTool, question, sql: out.sql, status,
      reason: out.validation?.isSafe === false ? out.validation.reason : out.error || out.approvalReason || null,
      estBytes: out.analysis?.sizeInBytes, estRows: out.analysis?.rowCount, rowsReturned: out.rows?.length, durationMs,
      model: out.usage?.calls ? out.usage.model : null, inputTokens: out.usage?.inputTokens, outputTokens: out.usage?.outputTokens,
      llmUsd: costs.llmUsd, warehouseUsd: status === "ok" ? costs.warehouseUsd : 0,
    });
  } catch (exc) {
    warn(`[requests] could not log request: ${describeError(exc)}`);
  }
}

const llm = new OpenAI({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY });
const embeddingClient = new OpenAI({ baseURL: EMBEDDING_BASE_URL, apiKey: EMBEDDING_API_KEY });

const MEMORY = {
  memoryEnabled: (process.env.MEMORY_ENABLED ?? "true").toLowerCase() !== "false",
  dbagentId: process.env.DBAGENT_ID || "local",
  memoryDbKind: process.env.MEMORY_DB_KIND || "sqlite",
  memoryTtlSeconds: Number(process.env.MEMORY_TTL_SECONDS || 7 * 24 * 3600),
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  llmModel: LLM_MODEL,
  backend: memoryBackend,
  embeddingClient,
};

// ── Schema introspection ─────────────────────────────────────────────────────
// Delegated to the active sqlEngine (see sqlEngines/index.js) — schema shape
// and PII-aware sample-value logic now live per-engine (sqlEngines/sqlite.js
// has the full PII/sampling implementation; sqlEngines/minioDuckdb.js
// doesn't sample values in this first pass). async because not every engine
// can answer synchronously (minio-duckdb awaits DuckDB's httpfs setup).

async function getSchema() {
  return await sqlEngine.getSchema();
}

function formatSchema(schema) {
  return Object.entries(schema)
    .map(([table, cols]) =>
      `  ${table}: ${cols
        .map((c) => {
          const base = `${c.name} (${c.type})`;
          return c.sampleValues
            ? `${base} [one of: ${c.sampleValues.map((v) => `'${v}'`).join(", ")}]`
            : base;
        })
        .join(", ")}`
    )
    .join("\n");
}

// ── Prompts (mirrors ../prompts.py's generic/SQLite system prompt) ──────────

// Per-engine dialect guidance. Engines that don't declare `sqlDialect` keep
// the original SQLite wording, so existing behavior is unchanged.
const DIALECT_RULES = {
  "databricks-sql":
    "- The database is Databricks SQL (Spark SQL) — use Databricks functions (date_sub(current_date(), 30),\n" +
    "  date_trunc, ilike, ||/concat), backtick-quote identifiers if needed, and reference tables by\n" +
    "  their bare name (the catalog and schema are already selected).",
};
const SQLITE_DIALECT_RULE =
  "- The database is SQLite — use SQLite date/string functions (date('now','-1 month')),\n" +
  "  not MySQL/Postgres equivalents.";

function getSystemPrompt() {
  const dialect = DIALECT_RULES[activeSqlEngineName] || SQLITE_DIALECT_RULE;
  return `You are a SQL assistant. Your only job is to generate a single, safe, read-only \
SELECT (or WITH…SELECT) query against the database below.

Rules you must follow:
- Only use tables and columns that exist in the schema provided.
- Never use DROP, DELETE, UPDATE, INSERT, ALTER, TRUNCATE, MERGE, CREATE, REPLACE,
  GRANT, REVOKE, or any other write / admin operation.
- Write exactly one statement. No semicolons in the middle.
${dialect}
- Some text columns (e.g. person names) have their real values hidden from you for
  privacy, so you cannot see exact stored strings for them. When the question
  names a person or gives a partial/likely value for such a column, match it with
  LIKE '%value%' (case-insensitive substring) instead of exact equality — an exact
  '=' will silently miss rows whenever the stored value has more to it (e.g. a last
  name) than what the question mentioned. Only use exact equality when the column's
  schema entry lists sample values and the question's value matches one of them.
- If the question cannot be answered from the schema, say so in the explanation
  and set sql to an empty string.

Always respond with valid JSON in this exact format:
{
  "sql": "<your SELECT statement or empty string>",
  "explanation": "<one sentence explaining what the query does>"
}

Do not include any text outside the JSON object.`;
}

function buildUserPrompt(question, schema, knowledgeText) {
  return `Database schema:
${formatSchema(schema)}
${knowledgeText}

User question: ${question}

Return only the JSON object described above.`;
}

function buildRepairPrompt(question, schema, failedSql, error, knowledgeText) {
  return `Database schema:
${formatSchema(schema)}
${knowledgeText}

User question: ${question}

Your previous answer produced this SQL, which failed to execute:
${failedSql}

Database error:
${error}

Fix the SQL so it runs successfully against this schema and database. Return only the JSON object described above.`;
}

// ── LLM call + JSON parsing (mirrors ../core/llm.py) ─────────────────────────

// A SQL answer plus one sentence is a few hundred tokens. Without a cap, a small model that falls
// into a repetition loop (seen with qwen2.5-coder:0.5b on repair prompts) generates until the
// context is full and the request hangs for minutes. LLM_MAX_TOKENS overrides.
const LLM_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS) || 1024;

// usage (optional): a counter the caller owns; token counts from the API response are added to it.
// Servers that do not report usage leave `missing` > 0 so the numbers are not mistaken for zero.
async function callLlm(systemPrompt, userPrompt, usage = null) {
  const response = await llm.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0,
    max_tokens: LLM_MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  if (usage) {
    usage.calls += 1;
    if (response.usage) {
      usage.inputTokens += response.usage.prompt_tokens || 0;
      usage.outputTokens += response.usage.completion_tokens || 0;
    } else {
      usage.missing += 1;
    }
  }
  return response.choices[0].message.content || "";
}

// ── Example questions ─────────────────────────────────────────────────────
// Generated from the actual schema rather than hardcoded — hardcoded
// examples only make sense for the bundled demo DB; anyone pointing this at
// a different database would see irrelevant suggestions. Cached per schema
// signature (not per request) since the schema rarely changes and this is
// a plain LLM call with no safety-critical output.

let exampleQuestionsCache = null; // { key: string, questions: string[] }

function schemaSignature(schema) {
  return Object.entries(schema)
    .map(([table, cols]) => `${table}:${cols.map((c) => c.name).join(",")}`)
    .join("|");
}

function heuristicExampleQuestions(schema) {
  const tables = Object.keys(schema);
  if (tables.length === 0) return [];
  return [`How many rows are in ${tables[0]}?`, `Show the first 5 rows of ${tables[0]}`]
    .concat(tables.slice(1, 4).map((t) => `Show all data in ${t}`))
    .slice(0, 5);
}

async function generateExampleQuestions(schema) {
  const key = schemaSignature(schema);
  if (exampleQuestionsCache && exampleQuestionsCache.key === key) {
    return exampleQuestionsCache.questions;
  }

  const prompt = `Database schema:
${formatSchema(schema)}

Suggest 5 short, natural-language questions a business analyst might ask about
this data. Ground every question strictly in the table and column names
above — never invent a table or column that isn't listed. Prefer a mix of
simple counts/lookups and at least one question that joins two tables, if
the schema supports it.

Respond with ONLY a JSON array of 5 strings, no other text.`;

  let questions;
  try {
    const raw = await callLlm(
      "You generate example questions for a natural-language-to-SQL demo, grounded strictly in the schema you're given.",
      prompt
    );
    const text = raw.replace(/```(?:json)?\s*/g, "").trim().replace(/`+$/, "").trim();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((q) => typeof q === "string")) {
      throw new Error("unexpected response shape");
    }
    questions = parsed.slice(0, 5);
  } catch (exc) {
    warn(`[examples] generation failed, using heuristic fallback: ${describeError(exc)}`);
    questions = heuristicExampleQuestions(schema);
  }

  exampleQuestionsCache = { key, questions };
  return questions;
}

function parseSqlResponse(raw) {
  const text = raw.replace(/```(?:json)?\s*/g, "").trim().replace(/`+$/, "").trim();

  try {
    const data = JSON.parse(text);
    return { sql: (data.sql || "").trim(), explanation: (data.explanation || "").trim() };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON object found in LLM response:\n${raw}`);
    const data = JSON.parse(match[0]);
    return { sql: (data.sql || "").trim(), explanation: (data.explanation || "").trim() };
  }
}

// ── Query execution ───────────────────────────────────────────────────────────
// Delegated to the active sqlEngine — same reasoning as getSchema() above.

async function runQuery(sql) {
  return await sqlEngine.runQuery(sql);
}

// ── Pipeline (mirrors ../core/pipeline.py, including the SQL repair loop) ───

// Verified benchmark cases double as few-shot examples, on top of whatever
// knowledge.json provides — a benchmark question like "which SKU is best
// performing?" only has one correct SQL interpretation of "best" (higher
// volume vs. higher price, say), and once that's been confirmed by a
// passing benchmark run, future similar questions should reuse it rather
// than the LLM re-guessing the business meaning each time.
//
// "Confirmed" is load-bearing here: seed cases are trusted by construction
// (hand-verified, repo-committed — see benchmarks.js), but user/feedback
// cases must have an actual PASSING benchmark run before they're used as
// examples. Including never-run cases would be a self-fulfilling prophecy —
// someone submits a case, asks that exact question again before any
// benchmark run has checked it, and the model just echoes their own
// (possibly wrong) SQL back as if it were verified truth. Confirmed this
// the hard way: an unverified case with deliberately-wrong ground truth got
// selected as a top-similarity example for its own question and the model
// copied it verbatim.
let lastSkippedLogKey = null;
function logSkippedExamples(schema, skipped) {
  const key = `${schemaSignature(schema || {})}:${skipped}`;
  if (skipped > 0 && key !== lastSkippedLogKey) {
    log(`[knowledge] ${skipped} benchmark example(s) left out of the prompt: they reference tables/columns missing from the connected schema`);
  }
  lastSkippedLogKey = key;
}

function buildMergedKnowledge(schema) {
  const rawKnowledge = loadKnowledge(KNOWLEDGE_PATH);
  const passing = benchmarkStore
    .listCases()
    .filter((c) => c.source === "seed" || c.lastRun?.status === "pass")
    .map((c) => ({ question: c.question, sql: c.groundTruthSql }));
  // Benchmark cases are written for one database (the bundled demo.db, or whatever a user
  // added). Against a different schema they reference tables/columns that do not exist, and
  // small models copy them. Keep only examples that fit the connected schema.
  const benchmarkExamples = schema ? passing.filter((e) => sqlFitsSchema(e.sql, schema)) : passing;
  logSkippedExamples(schema, passing.length - benchmarkExamples.length);

  if (!rawKnowledge && benchmarkExamples.length === 0) return null;
  return {
    descriptions: rawKnowledge?.descriptions || {},
    expressions: rawKnowledge?.expressions || {},
    examples: [...(rawKnowledge?.examples || []), ...benchmarkExamples],
    instructions: rawKnowledge?.instructions || [],
  };
}

// Cost guard thresholds (see runPipeline). A query auto-runs only if the
// engine's estimate is known and under ALL limits (bytes, rows, and
// APPROVAL_MAX_COST_USD, which uses the high end of the cost range); 0 disables that limit.
// APPROVAL_ALWAYS=true restores "ask for every query".
const APPROVAL_MAX_BYTES = Number(process.env.APPROVAL_MAX_BYTES ?? 100 * 1024 ** 2);
const APPROVAL_MAX_ROWS = Number(process.env.APPROVAL_MAX_ROWS ?? 100000);
const APPROVAL_MAX_COST_USD = Number(process.env.APPROVAL_MAX_COST_USD ?? 0.25);
// COST_ANALYSIS=auto (default): only analyze queries that may return a large
// result (see queryShape.js); bounded ones (small LIMIT, single-row
// aggregates) run straight away. "always" analyzes every query.
const COST_ANALYSIS = (process.env.COST_ANALYSIS || "auto").toLowerCase();
const ANALYZE_SKIP_LIMIT = Number(process.env.ANALYZE_SKIP_LIMIT ?? 1000);
const APPROVAL_ALWAYS = (process.env.APPROVAL_ALWAYS || "false").toLowerCase() === "true";

function approvalReason(analysis) {
  if (APPROVAL_ALWAYS) return "Approval required for every query (APPROVAL_ALWAYS).";
  if (!analysis || analysis.error) {
    return `Cost estimate unavailable${analysis?.error ? ` (${analysis.error})` : ""}, so the query was not run automatically.`;
  }
  if (analysis.sizeInBytes == null && analysis.rowCount == null) {
    return "Optimizer returned no size or row estimate, so the query was not run automatically.";
  }
  if (APPROVAL_MAX_BYTES > 0 && analysis.sizeInBytes != null && analysis.sizeInBytes > APPROVAL_MAX_BYTES) {
    return `Estimated data size ${analysis.sizeLabel || analysis.sizeInBytes + " B"} exceeds the ${(APPROVAL_MAX_BYTES / 1024 ** 2).toFixed(0)} MB limit.`;
  }
  if (APPROVAL_MAX_ROWS > 0 && analysis.rowCount != null && analysis.rowCount > APPROVAL_MAX_ROWS) {
    return `Estimated ${Math.round(analysis.rowCount).toLocaleString()} rows exceeds the ${APPROVAL_MAX_ROWS.toLocaleString()} row limit.`;
  }
  const c = analysis.cost;
  const worst = c && !c.error ? (c.usdHigh ?? c.usd) : null;
  if (APPROVAL_MAX_COST_USD > 0 && worst != null && worst > APPROVAL_MAX_COST_USD) {
    return `Estimated compute cost up to $${worst.toFixed(2)} exceeds the $${APPROVAL_MAX_COST_USD.toFixed(2)} limit.`;
  }
  return null;
}

// rawSql: the user typed "! <sql>" in the UI. The SQL skips the LLM (and
// the knowledge/embedding step) but goes through everything else: the
// SELECT-only validator, the cost guard, and execution. No LLM repair loop,
// since silently rewriting SQL the user wrote by hand would be surprising.
//
// Gateway hooks (used by gateway/, never by the web routes):
//   allowTable(name) -> bool   tables the caller may see; others are dropped from the prompt schema
//   guardSql(sql)    -> string | null   a reason to block this SQL before it is analyzed or run
async function runPipeline(question, { rawSql = null, allowTable = null, guardSql = null } = {}) {
  // Every line here is timestamped (see logger.js) specifically so
  // end-to-end text-to-SQL latency — and where it's actually going, LLM
  // call vs. query execution vs. repair loop — can be read straight off
  // the log by diffing timestamps, with no timing/duration math done by
  // the app itself.
  const engineInfo = sqlEngine.describe();
  log(`[ask] start "${question}" -> ${engineInfo.type} (${engineInfo.location})`);

  let schema = {}, knowledgeText = "";
  if (!rawSql) try {
    schema = await getSchema();
    if (allowTable) schema = Object.fromEntries(Object.entries(schema).filter(([t]) => allowTable(t)));
    const knowledge = buildMergedKnowledge(schema);
    // Selected once per request and reused for every repair attempt — the
    // relevant subset doesn't change mid-request, so there's no reason to
    // re-embed on every repair loop iteration.
    const selectedKnowledge = await selectRelevantKnowledge(knowledge, question, embeddingClient, MEMORY.embeddingModel);
    knowledgeText = formatKnowledge(selectedKnowledge);
  } catch (exc) {
    // Rethrown as-is (same behavior as before this log line was added) —
    // just makes sure a failure this early still gets a "done" timestamp
    // instead of silently having no closing log line for the request.
    log(`[ask] done (error before SQL generation: ${describeError(exc)})`);
    throw exc;
  }

  const output = {
    question,
    schemaContext: formatSchema(schema),
    sql: null,
    explanation: null,
    validation: null,
    columns: null,
    rows: null,
    error: null,
    repairAttempts: 0,
    analysis: null,
    status: null,
    approvalReason: null,
    // Tokens spent on this answer (SQL generation and repairs; embeddings for example selection are not counted).
    usage: { model: LLM_MODEL, calls: 0, inputTokens: 0, outputTokens: 0, missing: 0 },
  };

  try {
    const systemPrompt = getSystemPrompt();
    const parsed = rawSql
      ? { sql: rawSql.replace(/;+\s*$/, ""), explanation: "Run directly as typed (! mode); no LLM was used." }
      : parseSqlResponse(await callLlm(systemPrompt, buildUserPrompt(question, schema, knowledgeText), output.usage));
    output.sql = parsed.sql;
    output.explanation = parsed.explanation;
    log(`[ask] ${rawSql ? "raw sql" : "sql generated"}: ${parsed.sql || "(empty)"}`);

    const validation = validateSql(parsed.sql);
    output.validation = validation;
    if (!validation.isSafe) {
      log(`[ask] done (rejected by safety validation: ${validation.reason})`);
      return output;
    }

    if (!parsed.sql) {
      output.validation = { isSafe: false, reason: "The LLM could not generate a query for this question." };
      log(`[ask] done (no SQL generated)`);
      return output;
    }

    const blocked = guardSql?.(parsed.sql);
    if (blocked) {
      output.validation = { isSafe: false, reason: blocked };
      log(`[ask] done (blocked by policy: ${blocked})`);
      return output;
    }

    // Cost guard: engines that can estimate a query (analyzeQuery) are asked
    // first. Cheap queries run immediately; expensive or un-estimable ones
    // stop at status "awaiting_approval" until the user accepts via
    // POST /api/execute. Engines without analyzeQuery run directly, as before.
    // A planning error (bad table/column) is fed to the repair loop like an
    // execution error would be, since the SQL itself is wrong.
    let currentSql = parsed.sql;
    let attempts = 0;
    while (true) {
      try {
        const analyze =
          typeof sqlEngine.analyzeQuery === "function" &&
          (APPROVAL_ALWAYS ||
            COST_ANALYSIS === "always" ||
            // Engines where planning is cheap (Postgres EXPLAIN) analyze every query.
            sqlEngine.cheapAnalysis ||
            needsCostAnalysis(currentSql, { skipLimit: ANALYZE_SKIP_LIMIT }));
        if (typeof sqlEngine.analyzeQuery === "function" && !analyze) {
          output.analysis = null;
          log("[ask] cost analysis skipped (bounded result: small LIMIT or single-row aggregate)");
        }
        if (analyze) {
          try {
            output.analysis = await sqlEngine.analyzeQuery(currentSql);
          } catch (analyzeErr) {
            if (analyzeErr?.planningError) throw analyzeErr;
            output.analysis = { error: describeError(analyzeErr), rawPlan: null };
            warn(`[ask] EXPLAIN COST failed (non-fatal): ${output.analysis.error}`);
          }
          const reason = approvalReason(output.analysis);
          log(
            `[ask] EXPLAIN COST: size=${output.analysis.sizeLabel ?? "n/a"} ` +
              `rows=${output.analysis.rowCount ?? "n/a"}` +
              `${output.analysis.warnings?.length ? ` warnings=[${output.analysis.warnings.map((w) => w.code).join(",")}]` : ""} ` +
              `-> ${reason ? "needs approval" : "auto-run"}`
          );
          if (reason) {
            output.sql = currentSql;
            output.status = "awaiting_approval";
            output.approvalReason = reason;
            log(`[ask] done (awaiting approval: ${reason}) — SQL not executed yet`);
            return output;
          }
        }
        const { columns, rows } = await runQuery(currentSql);
        output.columns = columns;
        output.rows = rows;
        output.sql = currentSql;
        output.status = "complete";
        // Estimate vs actual, so users can see how far to trust the plan. Only
        // when the result was not cut off by the engine's row cap.
        if (output.analysis?.rowCount != null && rows.length < (sqlEngine.maxRows ?? Infinity)) {
          output.analysis.actualRows = rows.length;
        }
        log(`[ask] done, ${rows.length} row(s) returned (${attempts} repair attempt(s))`);
        break;
      } catch (dbErr) {
        if (attempts >= (rawSql ? 0 : MAX_REPAIR_ATTEMPTS)) throw dbErr;
        attempts += 1;
        log(`[ask] query failed, starting repair attempt ${attempts}: ${String(dbErr.message || dbErr)}`);
        const repairRaw = await callLlm(
          systemPrompt,
          buildRepairPrompt(question, schema, currentSql, String(dbErr.message || dbErr), knowledgeText),
          output.usage
        );
        const repaired = parseSqlResponse(repairRaw);
        const repairValidation = validateSql(repaired.sql);
        output.sql = repaired.sql;
        output.explanation = repaired.explanation;
        output.repairAttempts = attempts;
        log(`[ask] repair attempt ${attempts} sql: ${repaired.sql || "(empty)"}`);
        if (!repairValidation.isSafe) {
          output.validation = repairValidation;
          log(`[ask] done (repair rejected by safety validation: ${repairValidation.reason})`);
          return output;
        }
        const repairBlocked = guardSql?.(repaired.sql);
        if (repairBlocked) {
          output.validation = { isSafe: false, reason: repairBlocked };
          log(`[ask] done (repair blocked by policy: ${repairBlocked})`);
          return output;
        }
        currentSql = repaired.sql;
      }
    }
  } catch (exc) {
    output.error = describeError(exc);
    log(`[ask] done (error: ${output.error})`);
  }

  return output;
}

async function executeApprovedSql(sql) {
  const trimmed = String(sql || "").trim();
  if (!trimmed) {
    return { sql: null, columns: null, rows: null, error: "sql is required", status: null };
  }
  const validation = validateSql(trimmed);
  if (!validation.isSafe) {
    return {
      sql: trimmed,
      columns: null,
      rows: null,
      validation,
      error: validation.reason,
      status: null,
    };
  }
  try {
    const { columns, rows } = await runQuery(trimmed);
    log(`[execute] done, ${rows.length} row(s) returned`);
    return {
      sql: trimmed,
      columns,
      rows,
      validation,
      error: null,
      status: "complete",
    };
  } catch (exc) {
    const error = describeError(exc);
    log(`[execute] error: ${error}`);
    return {
      sql: trimmed,
      columns: null,
      rows: null,
      validation,
      error,
      status: null,
    };
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
// Serves the built React/Tailwind/shadcn frontend (web/). Run `npm run build`
// in web/ first — see app/README.md.
const WEB_DIST = path.join(__dirname, "web", "dist");
app.use(express.static(WEB_DIST));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(WEB_DIST, "index.html"));
});

app.get("/api/schema", async (req, res) => {
  try {
    res.json(await getSchema());
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

app.get("/api/example-questions", async (req, res) => {
  try {
    const schema = await getSchema();
    const questions = await generateExampleQuestions(schema);
    res.json(questions);
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

app.get("/api/config", (req, res) => {
  const info = sqlEngine.describe();
  res.json({
    llmBaseUrl: LLM_BASE_URL,
    llmModel: LLM_MODEL,
    dbPath: path.basename(DB_PATH),
    sqlEngine: activeSqlEngineName,
    sqlEngineInfo: info,
    availableSqlEngines: listSqlEngines(),
    memoryEnabled: MEMORY.memoryEnabled,
    dbagentId: MEMORY.dbagentId,
    memoryBackend: process.env.MEMORY_BACKEND || "local",
    availableMemoryBackends: listMemoryBackends(),
    embeddingBaseUrl: EMBEDDING_BASE_URL,
    embeddingModel: MEMORY.embeddingModel,
    knowledgeLoaded: loadKnowledge(KNOWLEDGE_PATH) !== null,
    benchmarkCaseCount: benchmarkStore.listCases().length,
    // Non-secret Databricks fields for the sidebar connection form.
    // Token is never echoed — only whether one is configured.
    databricks: {
      host: databricksConnection.host,
      httpPath: databricksConnection.httpPath,
      catalog: databricksConnection.catalog,
      schema: databricksConnection.schema,
      tokenConfigured: Boolean(databricksConnection.token),
    },
  });
});

// Session-only Databricks reconnect — does not rewrite .env.
app.post("/api/sql-connection", async (req, res) => {
  const body = req.body || {};
  const host = String(body.host || "").trim();
  const httpPath = String(body.httpPath || "").trim();
  const catalog = String(body.catalog || "").trim();
  const schema = String(body.schema || "").trim();
  let token = String(body.token || "").trim();
  if (!token && databricksConnection.token) {
    token = databricksConnection.token;
  }

  const missing = [];
  if (!host) missing.push("host");
  if (!httpPath) missing.push("httpPath");
  if (!token) missing.push("token");
  if (!catalog) missing.push("catalog");
  if (!schema) missing.push("schema");
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }

  try {
    await replaceSqlEngine("databricks-sql", {
      SQL_ENGINE: "databricks-sql",
      DATABRICKS_HOST: host,
      DATABRICKS_HTTP_PATH: httpPath,
      DATABRICKS_TOKEN: token,
      DATABRICKS_CATALOG: catalog,
      DATABRICKS_SCHEMA: schema,
    });
    databricksConnection = { host, httpPath, token, catalog, schema, maxRows: databricksConnection.maxRows };
    log(`[sql-connection] reconnected -> ${host} (${catalog}.${schema})`);
    res.json({
      ok: true,
      sqlEngine: activeSqlEngineName,
      sqlEngineInfo: sqlEngine.describe(),
      databricks: {
        host,
        httpPath,
        catalog,
        schema,
        tokenConfigured: true,
      },
    });
  } catch (exc) {
    res.status(400).json({ error: describeError(exc) });
  }
});

app.post("/api/ask", async (req, res) => {
  const question = (req.body?.question || "").trim();
  const rawSql = String(req.body?.sql || "").trim() || null;
  if (!question && !rawSql) return res.status(400).json({ error: "question is required" });

  try {
    const started = Date.now();
    const output = await runPipeline(question || `! ${rawSql}`, { rawSql });
    const costs = costsFor(output);
    output.usage = { ...output.usage, llmUsdEstimate: costs.llmUsd, warehouseUsdEstimate: costs.warehouseUsd };
    logWebRequest(rawSql ? "raw_sql" : "ask", output, { question: rawSql ? null : question, durationMs: Date.now() - started });
    // Pending-approval SQL is never written to memory (it hasn't run); that
    // happens in /api/execute. Auto-run results are written here.
    res.json(output);
    if (!rawSql && output.status !== "awaiting_approval") {
      void writeMemory(llm, output, MEMORY).catch((err) => {
        warn(`[memory] write failed: ${err?.message || err}`);
      });
    }
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

// ── CSV export ───────────────────────────────────────────────────────────────
// Streams the full result set to the browser as a file, so large results
// never need to render in the UI (or, on engines with streamRows, fit in
// memory). Same safety validation as /api/execute.
function csvCell(v) {
  if (v === null || v === undefined) return "";
  let str = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Neutralize spreadsheet formula injection in text values (not plain numbers).
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(str) && Number.isNaN(Number(str))) str = "'" + str;
  return /[",\n\r]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
}
const csvLine = (cells) => cells.map(csvCell).join(",") + "\r\n";

app.post("/api/export", async (req, res) => {
  const sql = String(req.body?.sql || "").trim();
  if (!sql) return res.status(400).json({ error: "sql is required" });
  const validation = validateSql(sql);
  if (!validation.isSafe) return res.status(400).json({ error: validation.reason, validation });

  let started = false;
  const write = (chunk) =>
    res.write(chunk) ? Promise.resolve() : new Promise((r) => res.once("drain", r));
  const begin = () => {
    started = true;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="query-${new Date().toISOString().replace(/[:.]/g, "-")}.csv"`
    );
  };
  try {
    let total = 0;
    let wroteHeader = false;
    const onBatch = async (columns, rows) => {
      if (!started) begin();
      if (!wroteHeader) {
        await write("\ufeff" + csvLine(columns));
        wroteHeader = true;
      }
      for (const row of rows) await write(csvLine(columns.map((c) => row[c])));
      total += rows.length;
    };
    if (typeof sqlEngine.streamRows === "function") {
      await sqlEngine.streamRows(sql, onBatch);
    } else {
      const { columns, rows } = await runQuery(sql);
      await onBatch(columns, rows);
    }
    log(`[export] done, ${total} row(s) streamed`);
    res.end();
  } catch (exc) {
    const error = describeError(exc);
    log(`[export] error: ${error}`);
    if (!started) return res.status(500).json({ error });
    res.destroy(); // headers already sent: abort so the browser sees a failed download, not a truncated "success"
  }
});

app.post("/api/execute", async (req, res) => {
  const sql = (req.body?.sql || "").trim();
  const question = (req.body?.question || "").trim();
  if (!sql) return res.status(400).json({ error: "sql is required" });

  try {
    const started = Date.now();
    const result = await executeApprovedSql(sql);
    logWebRequest("execute", result, { question: question || null, durationMs: Date.now() - started });
    if (result.validation && !result.validation.isSafe) {
      return res.status(400).json(result);
    }
    res.json(result);

    if (question && result.rows) {
      const memoryOutput = {
        question,
        sql: result.sql,
        rows: result.rows,
        columns: result.columns,
        error: null,
        explanation: null,
        validation: result.validation,
        schemaContext: "",
        repairAttempts: 0,
        status: "complete",
      };
      void writeMemory(llm, memoryOutput, MEMORY).catch((err) => {
        warn(`[memory] write failed: ${err?.message || err}`);
      });
    }
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

// Spend and activity report from the request log. Estimates only. JSON, or ?format=html for a page.
app.get("/api/report", (req, res) => {
  if (!requestStore) return res.status(503).json({ error: "request log is not available" });
  const period = REPORT_PERIODS[req.query.period] ? String(req.query.period) : "week";
  const report = buildReport(requestStore, { period });
  if (req.query.format === "html") return res.type("html").send(renderHtml(report));
  res.json(report);
});

app.get("/api/memories", async (req, res) => {
  try {
    const tables = (req.query.tables || "").split(",").filter(Boolean);
    const queryText = tables.length
      ? `Recent activity relevant to tables: ${tables.join(", ")}`
      : "recent activity";
    const memories = await fetchRelevantMemories(queryText, MEMORY, 3);
    res.json(memories);
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

app.post("/api/feedback", (req, res) => {
  const { question, sql, rating, comment } = req.body || {};
  if (!question || (rating !== "up" && rating !== "down")) {
    return res.status(400).json({ error: "question and rating ('up' or 'down') are required" });
  }

  try {
    fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
    const entry = {
      question,
      sql: sql || null,
      rating,
      comment: comment || null,
      dbagentId: MEMORY.dbagentId,
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(FEEDBACK_PATH, JSON.stringify(entry) + "\n");
    res.json({ ok: true });

    // A thumbs-down means this question is actively misleading — strip it
    // out of shared memory immediately rather than waiting for the next
    // benchmark run, so other agents stop suggesting it right away.
    // Fire-and-forget, same reasoning as the writeMemory call in /api/ask.
    if (rating === "down") {
      void invalidateFollowup(question, MEMORY).catch((err) => {
        warn(`[memory] invalidate failed: ${err?.message || err}`);
      });
    }
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

// ── Benchmarks (question + ground-truth SQL, scored by benchmark.js) ────────
// See benchmarks.js for the seed/user/feedback source model.

app.get("/api/benchmarks", (req, res) => {
  try {
    res.json(benchmarkStore.listCases());
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

app.post("/api/benchmarks", (req, res) => {
  const { question, groundTruthSql } = req.body || {};
  try {
    const entry = benchmarkStore.addCase({ question, groundTruthSql, source: "user" });
    res.status(201).json(entry);
  } catch (exc) {
    res.status(400).json({ error: describeError(exc) });
  }
});

app.delete("/api/benchmarks/:id", (req, res) => {
  try {
    const removed = benchmarkStore.removeCase(req.params.id);
    // Best-effort: a manually deleted case might also be a stale/bad
    // suggestion floating around shared memory.
    void invalidateFollowup(removed.question, MEMORY).catch(() => {});
    res.json({ ok: true });
  } catch (exc) {
    res.status(400).json({ error: describeError(exc) });
  }
});

// Used by benchmark.js to purge a specific question from shared memory when
// a case fails its run, and available generally for any other caller that
// wants to signal "stop suggesting this question."
app.post("/api/memories/invalidate", async (req, res) => {
  const { question } = req.body || {};
  if (!question) return res.status(400).json({ error: "question is required" });
  try {
    const result = await invalidateFollowup(question, MEMORY);
    res.json(result);
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

// Imported by the CLI (bin/db-agent.js) for the MCP gateway: only listen when run directly.
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) app.listen(PORT, () => {
  const engineInfo = sqlEngine.describe();
  log(`DB Agent (Node) running at http://localhost:${PORT}`);
  log(
    `SQL engine: ${engineInfo.type} -> ${engineInfo.location}` +
      (engineInfo.endpoint ? ` (endpoint: ${engineInfo.endpoint})` : "")
  );
  log(`LLM: ${LLM_BASE_URL} (${LLM_MODEL})`);
});

// The pipeline pieces the MCP gateway reuses, so the web UI and MCP share one code path.
export const pipeline = {
  runPipeline,
  executeApprovedSql,
  approvalReason,
  getSchema,
  getKnowledge: () => loadKnowledge(KNOWLEDGE_PATH),
  analyzeQuery: (sql) => (typeof sqlEngine.analyzeQuery === "function" ? sqlEngine.analyzeQuery(sql) : null),
  describeEngine: () => sqlEngine.describe(),
  llmModel: LLM_MODEL,
};
