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
const LLM_API_KEY = process.env.LLM_API_KEY || "no-key";
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
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || LLM_API_KEY;

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
// sqlEngines/index.js — "sqlite" (default, local file, zero config) or
// "minio-duckdb" (Parquet objects in MinIO/any S3-compatible store, queried
// via DuckDB — requires MINIO_ENDPOINT + MINIO_BUCKET, see app/README.md).
// Adding a new engine means adding one entry to that registry, not touching
// this file.
const sqlEngine = createSqlEngine(process.env.SQL_ENGINE, {
  env: process.env,
  dataDir: path.join(__dirname, "data"),
});

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

const SYSTEM_PROMPT = `You are a SQL assistant. Your only job is to generate a single, safe, read-only \
SELECT (or WITH…SELECT) query against the database below.

Rules you must follow:
- Only use tables and columns that exist in the schema provided.
- Never use DROP, DELETE, UPDATE, INSERT, ALTER, TRUNCATE, MERGE, CREATE, REPLACE,
  GRANT, REVOKE, or any other write / admin operation.
- Write exactly one statement. No semicolons in the middle.
- The database is SQLite — use SQLite date/string functions (date('now','-1 month')),
  not MySQL/Postgres equivalents.
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
    console.warn(`[examples] generation failed, using heuristic fallback: ${exc.message || exc}`);
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
  // Cheap, always-on visibility into which engine/location actually served
  // this request — added after a live real-S3 test made clear there was
  // otherwise no way to confirm from the server logs whether a request hit
  // local SQLite or a remote S3/MinIO bucket without separately hitting
  // /api/config.
  const engineInfo = sqlEngine.describe();
  console.log(`[ask] "${question}" -> ${engineInfo.type} (${engineInfo.location})`);

  const schema = await getSchema();
  const knowledge = buildMergedKnowledge();
  // Selected once per request and reused for every repair attempt — the
  // relevant subset doesn't change mid-request, so there's no reason to
  // re-embed on every repair loop iteration.
  const selectedKnowledge = await selectRelevantKnowledge(knowledge, question, embeddingClient, MEMORY.embeddingModel);
  const knowledgeText = formatKnowledge(selectedKnowledge);
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
  };

  try {
    const raw = await callLlm(SYSTEM_PROMPT, buildUserPrompt(question, schema, knowledgeText));
    const parsed = parseSqlResponse(raw);
    output.sql = parsed.sql;
    output.explanation = parsed.explanation;

    const validation = validateSql(parsed.sql);
    output.validation = validation;
    if (!validation.isSafe) return output;

    if (!parsed.sql) {
      output.validation = { isSafe: false, reason: "The LLM could not generate a query for this question." };
      return output;
    }

    let currentSql = parsed.sql;
    let attempts = 0;
    // The database itself is the syntax checker across dialects — a failed
    // execution's error is fed back to the LLM rather than re-implementing
    // a SQL parser. Every repair is re-validated through the same safety
    // layer above before it's allowed to run.
    while (true) {
      try {
        const { columns, rows } = await runQuery(currentSql);
        output.columns = columns;
        output.rows = rows;
        output.sql = currentSql;
        break;
      } catch (dbErr) {
        if (attempts >= MAX_REPAIR_ATTEMPTS) throw dbErr;
        attempts += 1;

        const repairRaw = await callLlm(
          SYSTEM_PROMPT,
          buildRepairPrompt(question, schema, currentSql, String(dbErr.message || dbErr), knowledgeText)
        );
        const repaired = parseSqlResponse(repairRaw);
        const repairValidation = validateSql(repaired.sql);
        output.sql = repaired.sql;
        output.explanation = repaired.explanation;
        output.repairAttempts = attempts;

        if (!repairValidation.isSafe) {
          output.validation = repairValidation;
          return output;
        }
        currentSql = repaired.sql;
      }
    }
  } catch (exc) {
    output.error = String(exc.message || exc);
  }

  return output;
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
    res.status(500).json({ error: String(exc.message || exc) });
  }
});

app.get("/api/example-questions", async (req, res) => {
  try {
    const schema = await getSchema();
    const questions = await generateExampleQuestions(schema);
    res.json(questions);
  } catch (exc) {
    res.status(500).json({ error: String(exc.message || exc) });
  }
});

app.get("/api/config", (req, res) => {
  res.json({
    llmBaseUrl: LLM_BASE_URL,
    llmModel: LLM_MODEL,
    dbPath: path.basename(DB_PATH),
    sqlEngine: process.env.SQL_ENGINE || "sqlite",
    sqlEngineInfo: sqlEngine.describe(),
    availableSqlEngines: listSqlEngines(),
    memoryEnabled: MEMORY.memoryEnabled,
    dbagentId: MEMORY.dbagentId,
    memoryBackend: process.env.MEMORY_BACKEND || "local",
    availableMemoryBackends: listMemoryBackends(),
    embeddingBaseUrl: EMBEDDING_BASE_URL,
    embeddingModel: MEMORY.embeddingModel,
    knowledgeLoaded: loadKnowledge(KNOWLEDGE_PATH) !== null,
    benchmarkCaseCount: benchmarkStore.listCases().length,
  });
});

app.post("/api/ask", async (req, res) => {
  const question = (req.body?.question || "").trim();
  if (!question) return res.status(400).json({ error: "question is required" });

  try {
    const output = await runPipeline(question);
    res.json(output);

    // Fire-and-forget: memory is cross-platform context, not a critical path
    // — never block the response on a second LLM call + store write.
    void writeMemory(llm, output, MEMORY).catch((err) => {
      console.warn(`[memory] write failed: ${err?.message || err}`);
    });
  } catch (exc) {
    res.status(500).json({ error: String(exc.message || exc) });
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
    res.status(500).json({ error: String(exc.message || exc) });
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
        console.warn(`[memory] invalidate failed: ${err?.message || err}`);
      });
    }
  } catch (exc) {
    res.status(500).json({ error: String(exc.message || exc) });
  }
});

// ── Benchmarks (question + ground-truth SQL, scored by benchmark.js) ────────
// See benchmarks.js for the seed/user/feedback source model.

app.get("/api/benchmarks", (req, res) => {
  try {
    res.json(benchmarkStore.listCases());
  } catch (exc) {
    res.status(500).json({ error: String(exc.message || exc) });
  }
});

app.post("/api/benchmarks", (req, res) => {
  const { question, groundTruthSql } = req.body || {};
  try {
    const entry = benchmarkStore.addCase({ question, groundTruthSql, source: "user" });
    res.status(201).json(entry);
  } catch (exc) {
    res.status(400).json({ error: String(exc.message || exc) });
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
    res.status(400).json({ error: String(exc.message || exc) });
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
    res.status(500).json({ error: String(exc.message || exc) });
  }
});

app.listen(PORT, () => {
  const engineInfo = sqlEngine.describe();
  console.log(`DB Agent (Node) running at http://localhost:${PORT}`);
  console.log(
    `SQL engine: ${engineInfo.type} -> ${engineInfo.location}` +
      (engineInfo.endpoint ? ` (endpoint: ${engineInfo.endpoint})` : "")
  );
  console.log(`LLM: ${LLM_BASE_URL} (${LLM_MODEL})`);
});
