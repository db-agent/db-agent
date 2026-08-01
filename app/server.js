// server.js — Node.js/Express port of the same text-to-SQL agent as the
// Streamlit app (../app.py, ../pipeline.py, ../core/*), built to compare how
// the UI feels on a real frontend stack vs. Streamlit. Scope is intentionally
// narrower than the Python app: SQLite only, single LLM (no failover chain,
// no Databricks backend) — same prompt → SQL → safety-check → execute →
// results loop, plus the SQL repair loop and cross-platform memory feature
// ported from core/pipeline.py and core/memory.py.

import "dotenv/config";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRelevantMemories, invalidateFollowup, writeMemory } from "./memory.js";
import { createMemoryBackend, listMemoryBackends } from "./memoryBackends/index.js";
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

const db = new DatabaseSync(DB_PATH, { readOnly: false });
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

// The LLM guesses literal column values ("status = 'Pending'" when the data
// stores 'pending'), returning zero rows with no error — one of the most
// common real-world text-to-SQL failures. Sampling distinct values for
// low-cardinality TEXT columns and showing them in the schema fixes this
// automatically, no config needed.
const MAX_DISTINCT_VALUES = 10;
// Skip columns whose name suggests personal data even if low-cardinality —
// sampling exists to disambiguate enum-like columns, not to leak literal
// customer data into every prompt. These patterns are unambiguous on their
// own regardless of table.
const PII_ALWAYS_PATTERNS = [
  "email", "phone", "address", "ssn", "password", "secret", "token", "dob", "birth",
];
// "name" alone is ambiguous — customers.name is a person's name (PII),
// products.name is not. Only treat *_name columns as PII when the table
// itself looks like it holds people.
const PERSON_TABLE_PATTERNS = [
  "customer", "user", "person", "employee", "contact", "client", "patient", "student", "member",
];

function looksLikePII(table, columnName) {
  const lowerCol = columnName.toLowerCase();
  if (PII_ALWAYS_PATTERNS.some((p) => lowerCol.includes(p))) return true;
  if (lowerCol.includes("name")) {
    const lowerTable = table.toLowerCase();
    return PERSON_TABLE_PATTERNS.some((p) => lowerTable.includes(p));
  }
  return false;
}

// Cached for the process lifetime rather than re-sampled every request —
// the schema itself is read fresh each time (cheap PRAGMA calls), but
// sampling adds a real query per eligible column, and the underlying data
// doesn't change from a user's perspective the way a knowledge.json edit
// would. A server restart clears it.
const columnValueCache = new Map();

function sampleColumnValues(table, column) {
  const cacheKey = `${table}.${column}`;
  if (columnValueCache.has(cacheKey)) return columnValueCache.get(cacheKey);

  let values = null;
  try {
    const safeTable = `"${table.replaceAll('"', '""')}"`;
    const safeColumn = `"${column.replaceAll('"', '""')}"`;
    const rows = db
      .prepare(
        `SELECT DISTINCT ${safeColumn} AS v FROM ${safeTable} WHERE ${safeColumn} IS NOT NULL LIMIT ${MAX_DISTINCT_VALUES + 1}`
      )
      .all();
    // Hitting the +1 limit means the column is higher-cardinality than
    // "enum-like" — skip it rather than show a truncated, misleading list.
    if (rows.length > 0 && rows.length <= MAX_DISTINCT_VALUES) {
      values = rows.map((r) => String(r.v));
    }
  } catch {
    values = null;
  }

  columnValueCache.set(cacheKey, values);
  return values;
}

function getSchema() {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();

  const schema = {};
  for (const { name: table } of tables) {
    const safeTable = `"${String(table).replaceAll('"', '""')}"`;
    const columns = db.prepare(`PRAGMA table_info(${safeTable})`).all();
    schema[table] = columns.map((c) => {
      const col = { name: c.name, type: c.type };
      if (String(c.type).toUpperCase().includes("TEXT") && !looksLikePII(table, c.name)) {
        const values = sampleColumnValues(table, c.name);
        if (values) col.sampleValues = values;
      }
      return col;
    });
  }
  return schema;
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

function runQuery(sql) {
  const stmt = db.prepare(sql);
  const rows = stmt.all();
  const columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
  return { columns, rows };
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
  const schema = getSchema();
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
        const { columns, rows } = runQuery(currentSql);
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

app.get("/api/schema", (req, res) => {
  try {
    res.json(getSchema());
  } catch (exc) {
    res.status(500).json({ error: String(exc.message || exc) });
  }
});

app.get("/api/example-questions", async (req, res) => {
  try {
    const questions = await generateExampleQuestions(getSchema());
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
  console.log(`DB Agent (Node) running at http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`LLM: ${LLM_BASE_URL} (${LLM_MODEL})`);
});
