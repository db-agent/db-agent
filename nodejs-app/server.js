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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalJsonBackend, fetchRelevantMemories, writeMemory } from "./memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Databricks Apps injects DATABRICKS_APP_PORT and expects the app to bind to
// it; PORT is the local-dev fallback.
const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 3001;
// Self-contained default (data/demo.db bundled alongside this file) so the
// app has no path dependency outside its own deployed source tree — required
// since Databricks Apps deploys nodejs-app/ as its own isolated source root,
// not the whole repo. DB_PATH can still override to ../data/demo.db for
// local dev that shares the root Python app's seeded DB.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "demo.db");
const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
const LLM_API_KEY = process.env.LLM_API_KEY || "no-key";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const MAX_REPAIR_ATTEMPTS = 2;

// ── Cross-platform contextual memory config ─────────────────────────────────
const MEMORY = {
  memoryEnabled: (process.env.MEMORY_ENABLED ?? "true").toLowerCase() !== "false",
  dbagentId: process.env.DBAGENT_ID || "local",
  memoryDbKind: process.env.MEMORY_DB_KIND || "sqlite",
  memoryTtlSeconds: Number(process.env.MEMORY_TTL_SECONDS || 7 * 24 * 3600),
  embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  llmModel: LLM_MODEL,
  backend: new LocalJsonBackend(
    process.env.MEMORY_STORE_PATH || path.join(__dirname, "data", "memory_store.jsonl")
  ),
};

const db = new DatabaseSync(DB_PATH, { readOnly: false });
const llm = new OpenAI({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY });

// ── Schema introspection ─────────────────────────────────────────────────────

function getSchema() {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();

  const schema = {};
  for (const { name: table } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    schema[table] = columns.map((c) => ({ name: c.name, type: c.type }));
  }
  return schema;
}

function formatSchema(schema) {
  return Object.entries(schema)
    .map(([table, cols]) => `  ${table}: ${cols.map((c) => `${c.name} (${c.type})`).join(", ")}`)
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
- If the question cannot be answered from the schema, say so in the explanation
  and set sql to an empty string.

Always respond with valid JSON in this exact format:
{
  "sql": "<your SELECT statement or empty string>",
  "explanation": "<one sentence explaining what the query does>"
}

Do not include any text outside the JSON object.`;

function buildUserPrompt(question, schema) {
  return `Database schema:
${formatSchema(schema)}

User question: ${question}

Return only the JSON object described above.`;
}

function buildRepairPrompt(question, schema, failedSql, error) {
  return `Database schema:
${formatSchema(schema)}

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

// ── SQL safety layer (mirrors ../core/sql_safety.py) ─────────────────────────

const FORBIDDEN = [
  "DROP", "DELETE", "UPDATE", "INSERT", "ALTER",
  "TRUNCATE", "CREATE", "REPLACE", "MERGE", "EXEC",
  "EXECUTE", "GRANT", "REVOKE", "ATTACH", "DETACH",
];

function validateSql(sql) {
  const stripped = sql.trim();
  if (!stripped) return { isSafe: false, reason: "SQL is empty." };

  const cleaned = stripped.replace(/;$/, "");
  if (cleaned.includes(";")) {
    return { isSafe: false, reason: "Multiple SQL statements detected. Only a single SELECT is allowed." };
  }

  const firstWord = cleaned.trim().split(/\s+/)[0].toUpperCase();
  if (!["SELECT", "WITH"].includes(firstWord)) {
    return { isSafe: false, reason: `Query must start with SELECT or WITH, got '${firstWord}'.` };
  }

  const upperSql = cleaned.toUpperCase();
  for (const keyword of FORBIDDEN) {
    if (new RegExp(`\\b${keyword}\\b`).test(upperSql)) {
      return { isSafe: false, reason: `Forbidden keyword detected: ${keyword}.` };
    }
  }

  return { isSafe: true, reason: "SQL passed all safety checks." };
}

// ── Query execution ───────────────────────────────────────────────────────────

function runQuery(sql) {
  const stmt = db.prepare(sql);
  const rows = stmt.all();
  const columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
  return { columns, rows };
}

// ── Pipeline (mirrors ../core/pipeline.py, including the SQL repair loop) ───

async function runPipeline(question) {
  const schema = getSchema();
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
    const raw = await callLlm(SYSTEM_PROMPT, buildUserPrompt(question, schema));
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
          buildRepairPrompt(question, schema, currentSql, String(dbErr.message || dbErr))
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
// in web/ first — see nodejs-app/README.md.
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

app.get("/api/config", (req, res) => {
  res.json({
    llmBaseUrl: LLM_BASE_URL,
    llmModel: LLM_MODEL,
    dbPath: path.basename(DB_PATH),
    memoryEnabled: MEMORY.memoryEnabled,
    dbagentId: MEMORY.dbagentId,
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
    writeMemory(llm, output, MEMORY);
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
    const memories = await fetchRelevantMemories(llm, queryText, MEMORY, 3);
    res.json(memories);
  } catch (exc) {
    res.status(500).json({ error: String(exc.message || exc) });
  }
});

app.listen(PORT, () => {
  console.log(`DB Agent (Node) running at http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`LLM: ${LLM_BASE_URL} (${LLM_MODEL})`);
});
