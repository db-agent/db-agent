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
import { fileURLToPath } from "node:url";
import { fetchRelevantMemories, invalidateFollowup, writeMemory } from "./memory.js";
import { createMemoryBackend, listMemoryBackends } from "./memoryBackends/index.js";
import { createSqlEngine, listSqlEngines } from "./sqlEngines/index.js";
import { formatKnowledge, loadKnowledge, selectRelevantKnowledge } from "./knowledge.js";
import { validateSql } from "./sqlSafety.js";
import { benchmarkStore } from "./benchmarks.js";
import { describeError, log, warn } from "./logger.js";

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

async function callLlm(systemPrompt, userPrompt) {
  const response = await llm.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
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
function buildMergedKnowledge() {
  const rawKnowledge = loadKnowledge(KNOWLEDGE_PATH);
  const benchmarkExamples = benchmarkStore
    .listCases()
    .filter((c) => c.source === "seed" || c.lastRun?.status === "pass")
    .map((c) => ({ question: c.question, sql: c.groundTruthSql }));

  if (!rawKnowledge && benchmarkExamples.length === 0) return null;
  return {
    descriptions: rawKnowledge?.descriptions || {},
    expressions: rawKnowledge?.expressions || {},
    examples: [...(rawKnowledge?.examples || []), ...benchmarkExamples],
    instructions: rawKnowledge?.instructions || [],
  };
}

async function runPipeline(question) {
  // Every line here is timestamped (see logger.js) specifically so
  // end-to-end text-to-SQL latency — and where it's actually going, LLM
  // call vs. query execution vs. repair loop — can be read straight off
  // the log by diffing timestamps, with no timing/duration math done by
  // the app itself.
  const engineInfo = sqlEngine.describe();
  log(`[ask] start "${question}" -> ${engineInfo.type} (${engineInfo.location})`);

  let schema, knowledgeText;
  try {
    schema = await getSchema();
    const knowledge = buildMergedKnowledge();
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
  };

  try {
    const systemPrompt = getSystemPrompt();
    const raw = await callLlm(systemPrompt, buildUserPrompt(question, schema, knowledgeText));
    const parsed = parseSqlResponse(raw);
    output.sql = parsed.sql;
    output.explanation = parsed.explanation;
    log(`[ask] sql generated: ${parsed.sql || "(empty)"}`);

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

    // Analyze only — do not execute until the user accepts via POST /api/execute.
    if (typeof sqlEngine.analyzeQuery === "function") {
      try {
        output.analysis = await sqlEngine.analyzeQuery(parsed.sql);
        log(
          `[ask] EXPLAIN COST: size=${output.analysis.sizeLabel ?? "n/a"} ` +
            `rows=${output.analysis.rowCount ?? "n/a"}`
        );
      } catch (analyzeErr) {
        output.analysis = { error: describeError(analyzeErr), rawPlan: null };
        warn(`[ask] EXPLAIN COST failed (non-fatal): ${output.analysis.error}`);
      }
    }

    output.status = "awaiting_approval";
    log(`[ask] done (awaiting approval) — SQL not executed yet`);
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
  if (!question) return res.status(400).json({ error: "question is required" });

  try {
    const output = await runPipeline(question);
    // Memory is written after the user accepts and /api/execute succeeds —
    // storing pre-approval SQL would record queries that were never run.
    res.json(output);
  } catch (exc) {
    res.status(500).json({ error: describeError(exc) });
  }
});

app.post("/api/execute", async (req, res) => {
  const sql = (req.body?.sql || "").trim();
  const question = (req.body?.question || "").trim();
  if (!sql) return res.status(400).json({ error: "sql is required" });

  try {
    const result = await executeApprovedSql(sql);
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

app.listen(PORT, () => {
  const engineInfo = sqlEngine.describe();
  log(`DB Agent (Node) running at http://localhost:${PORT}`);
  log(
    `SQL engine: ${engineInfo.type} -> ${engineInfo.location}` +
      (engineInfo.endpoint ? ` (endpoint: ${engineInfo.endpoint})` : "")
  );
  log(`LLM: ${LLM_BASE_URL} (${LLM_MODEL})`);
});
