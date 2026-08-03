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
// This file is backend-agnostic: summarization, embedding, and the public
// write/fetch/invalidate API. The actual storage implementations (local
// JSONL, AWS S3 Vectors, Milvus, ...) live in memoryBackends/ — see
// memoryBackends/index.js for the pluggable registry. Every backend
// implements the same put()/query()/invalidateFollowup() interface.

import crypto from "node:crypto";
import { describeError, warn } from "./logger.js";

// Shared by invalidateFollowup on every backend — case/whitespace/trailing-
// punctuation-insensitive so "Show me X?" matches a stored "show me x".
// This only catches literal repeats of a follow-up string, not semantically
// similar rephrasings; that's the realistic case here since
// suggestedFollowups are literal question strings surfaced verbatim in the
// UI (see Suggestions.tsx), not paraphrased on display.
export function normalizeQuestion(text) {
  return String(text).trim().toLowerCase().replace(/[?.!]+$/, "");
}

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

export async function embed(llm, text, embeddingModel) {
  // The OpenAI SDK defaults to encoding_format: "base64" for embeddings.
  // At least one OpenAI-compatible endpoint we've tested (Databricks AI
  // Gateway) mishandles that and silently returns a truncated vector
  // (1024 floats -> 256) with no error — forcing "float" avoids it and
  // matches what a bare curl request gets by default.
  const response = await llm.embeddings.create({
    model: embeddingModel,
    input: text,
    encoding_format: "float",
  });
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
    warn(`[memory] summarization skipped: ${describeError(exc)}`);
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
    entities: data.entities || [],
    insightSummary: data.insight_summary || "",
    suggestedFollowups: data.suggested_followups || [],
  };
}

// Generic vector math, shared by any backend that scores similarity
// client-side (LocalJsonBackend) — see memoryBackends/.
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / ((Math.sqrt(normA) || 1) * (Math.sqrt(normB) || 1));
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
    // Embeddings go through cfg.embeddingClient, not the chat `llm` — they
    // don't have to be the same endpoint. What matters is that every agent
    // sharing this store uses the same embedding model, so the config
    // (embeddingClient's base URL/key + embeddingModel) is what needs to
    // match across agents, independent of each agent's own chat model.
    const vector = await embed(cfg.embeddingClient, record.insightSummary, cfg.embeddingModel);
    await cfg.backend.put(record, vector);
  } catch (exc) {
    warn(`[memory] write skipped: ${describeError(exc)}`);
  }
}

export async function fetchRelevantMemories(queryText, cfg, topK = 3) {
  if (!cfg.memoryEnabled) return [];
  try {
    const vector = await embed(cfg.embeddingClient, queryText, cfg.embeddingModel);
    return await cfg.backend.query(vector, { excludeAgent: cfg.dbagentId, topK });
  } catch (exc) {
    warn(`[memory] fetch skipped: ${describeError(exc)}`);
    return [];
  }
}

// Removes a specific question from every agent's suggested follow-ups
// across the shared store. Called when a question turns out to perform
// poorly — either a user thumbs-downs it (server.js's /api/feedback) or a
// benchmark run catches it producing wrong results (benchmark.js) — so
// other agents stop surfacing it as a suggestion in Suggestions.tsx.
export async function invalidateFollowup(questionText, cfg) {
  if (!cfg.memoryEnabled) return { removed: 0 };
  try {
    const vector = await embed(cfg.embeddingClient, questionText, cfg.embeddingModel);
    return await cfg.backend.invalidateFollowup(questionText, vector);
  } catch (exc) {
    warn(`[memory] invalidate skipped: ${describeError(exc)}`);
    return { removed: 0 };
  }
}
