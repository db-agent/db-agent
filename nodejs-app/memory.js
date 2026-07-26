// memory.js — Cross-platform contextual memory, ported from ../core/memory.py.
//
// Lets separate DB Agent instances running in different security/subnet
// islands (e.g. an OLTP agent on SQL Server, an OLAP agent on Snowflake or
// Databricks SQL) share redacted, LLM-summarized context through a shared
// store instead of a live connection between them.
//
// A memory record is a redacted summary of one question/answer turn — never
// the raw SQL or rows — produced by a second, small LLM call. That's what
// makes it safe to write into a shared, cross-boundary store.
//
// Only the local JSONL backend is ported here (matches ../core/memory.py's
// LocalJsonBackend — the one actually verified end-to-end). The S3 Vectors
// backend is intentionally not ported: it's still unverified against real
// AWS even on the Python side (see repo issues #26-#30), so porting it here
// would just be untested code duplicated twice over.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SUMMARY_SYSTEM_PROMPT = `You turn one question-and-answer turn from a database analyst into a short,
REDACTED memory record for a different analyst working on a different
database platform, who cannot see this data directly.

Rules:
- Never include literal row values, names, emails, amounts, or any other
  literal data from the result set.
- Reference entities only by identifier/type, e.g. "account_id:4471",
  "table:transactions". Do not include the values *inside* those rows.
- If the question was trivial (e.g. browsing schema, a failed query, a
  request with no analytical content), set "memory_worthy" to false.
- suggested_followups are natural-language questions a *different* analyst,
  on a *different* database, might reasonably ask next, given the entities
  involved. Do not assume that database's schema — keep them generic enough
  to make sense cross-platform.

Respond with ONLY a JSON object:
{
  "memory_worthy": true|false,
  "insight_summary": "one or two sentences, no literal data",
  "entities": ["account_id:4471", "table:transactions"],
  "suggested_followups": ["...", "..."]
}`;

function parseSummaryJson(raw) {
  const text = raw.replace(/```(?:json)?\s*/g, "").trim().replace(/`+$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON object found in summary response:\n${raw}`);
    return JSON.parse(match[0]);
  }
}

async function embed(llm, text, embeddingModel) {
  const response = await llm.embeddings.create({ model: embeddingModel, input: text });
  return response.data[0].embedding;
}

// ── Summarization ────────────────────────────────────────────────────────────

export async function summarizeForMemory(llm, output, { agentId, dbKind, ttlSeconds, model }) {
  if (output.error || !output.sql) return null;
  if (output.validation && !output.validation.isSafe) return null;

  const rowCount = output.rows ? output.rows.length : 0;
  const userPrompt = `Question: ${output.question}
SQL: ${output.sql}
Explanation: ${output.explanation}
Row count returned: ${rowCount}
`;

  let data;
  try {
    const response = await llm.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
    data = parseSummaryJson(response.choices[0].message.content || "");
  } catch (exc) {
    console.warn(`[memory] summarization skipped: ${exc.message || exc}`);
    return null;
  }

  if (!data.memory_worthy) return null;

  const now = Date.now() / 1000;
  return {
    recordId: crypto.randomUUID(),
    sourceAgent: agentId,
    sourceDbKind: dbKind,
    createdAt: new Date().toISOString(),
    ttlEpoch: Math.floor(now + ttlSeconds),
    question: output.question,
    entities: data.entities || [],
    insightSummary: data.insight_summary || "",
    suggestedFollowups: data.suggested_followups || [],
  };
}

// ── Local backend (JSONL + cosine similarity) ───────────────────────────────
// Mirrors ../core/memory.py's LocalJsonBackend — no cloud setup required,
// so this is the default and what makes the feature demoable via run_local.sh.

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / ((Math.sqrt(normA) || 1) * (Math.sqrt(normB) || 1));
}

export class LocalJsonBackend {
  constructor(filePath) {
    this.path = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  put(record, vector) {
    const row = JSON.stringify({ record, vector }) + "\n";
    fs.appendFileSync(this.path, row);
  }

  query(vector, { excludeAgent, topK }) {
    if (!fs.existsSync(this.path)) return [];

    const now = Date.now() / 1000;
    const lines = fs.readFileSync(this.path, "utf-8").split("\n").filter(Boolean);

    const scored = [];
    for (const line of lines) {
      const row = JSON.parse(line);
      if (row.record.sourceAgent === excludeAgent) continue;
      if (row.record.ttlEpoch < now) continue;
      scored.push([cosineSimilarity(vector, row.vector), row.record]);
    }

    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, topK).map(([, record]) => record);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function writeMemory(llm, output, cfg) {
  if (!cfg.memoryEnabled) return;
  try {
    const record = await summarizeForMemory(llm, output, {
      agentId: cfg.dbagentId,
      dbKind: cfg.memoryDbKind,
      ttlSeconds: cfg.memoryTtlSeconds,
      model: cfg.llmModel,
    });
    if (!record) return;
    const vector = await embed(llm, record.insightSummary, cfg.embeddingModel);
    cfg.backend.put(record, vector);
  } catch (exc) {
    console.warn(`[memory] write skipped: ${exc.message || exc}`);
  }
}

export async function fetchRelevantMemories(llm, queryText, cfg, topK = 3) {
  if (!cfg.memoryEnabled) return [];
  try {
    const vector = await embed(llm, queryText, cfg.embeddingModel);
    return cfg.backend.query(vector, { excludeAgent: cfg.dbagentId, topK });
  } catch (exc) {
    console.warn(`[memory] fetch skipped: ${exc.message || exc}`);
    return [];
  }
}
