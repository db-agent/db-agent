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
// Two backends, both behind the same put()/query() interface:
//   LocalJsonBackend  — JSONL + cosine similarity, no cloud setup, the
//                       default (matches ../core/memory.py's LocalJsonBackend).
//   S3VectorsBackend  — @aws-sdk/client-s3vectors (AWS S3 Vectors, preview).
//                       Bucket + index are expected to already exist — this
//                       class only puts/queries, to keep IAM scoped tight.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3VectorsClient,
  PutVectorsCommand,
  QueryVectorsCommand,
  GetVectorsCommand,
} from "@aws-sdk/client-s3vectors";

// Shared by invalidateFollowup on both backends — case/whitespace/trailing-
// punctuation-insensitive so "Show me X?" matches a stored "show me x".
// This only catches literal repeats of a follow-up string, not semantically
// similar rephrasings; that's the realistic case here since
// suggestedFollowups are literal question strings surfaced verbatim in the
// UI (see Suggestions.tsx), not paraphrased on display.
function normalizeQuestion(text) {
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
    entities: data.entities || [],
    insightSummary: data.insight_summary || "",
    suggestedFollowups: data.suggested_followups || [],
  };
}

// ── Local backend (JSONL + cosine similarity) ───────────────────────────────
// Mirrors ../core/memory.py's LocalJsonBackend — no cloud setup required,
// so this is the default and what makes the feature demoable via run_local.sh.

export function cosineSimilarity(a, b) {
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
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!row?.record || !row?.vector) continue;
      if (row.record.sourceAgent === excludeAgent) continue;
      if (row.record.ttlEpoch < now) continue;
      scored.push([cosineSimilarity(vector, row.vector), row.record]);
    }

    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, topK).map(([, record]) => record);
  }

  // Strips a specific follow-up question out of every record that suggests
  // it, rather than deleting the whole record — the record's insightSummary
  // may still be a valid cross-agent insight even if one of its suggested
  // follow-ups turned out to be a bad prompt (e.g. flagged by a benchmark
  // failure or a thumbs-down). Rewrites the file in place; JSONL has no
  // in-place update primitive.
  invalidateFollowup(questionText) {
    if (!fs.existsSync(this.path)) return { removed: 0 };
    const target = normalizeQuestion(questionText);
    const lines = fs.readFileSync(this.path, "utf-8").split("\n").filter(Boolean);

    let removed = 0;
    const rewritten = lines.map((line) => {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        return line;
      }
      const followups = row?.record?.suggestedFollowups;
      if (!Array.isArray(followups)) return line;
      const filtered = followups.filter((f) => normalizeQuestion(f) !== target);
      if (filtered.length === followups.length) return line;
      removed += followups.length - filtered.length;
      row.record.suggestedFollowups = filtered;
      return JSON.stringify(row);
    });

    fs.writeFileSync(this.path, rewritten.length ? rewritten.join("\n") + "\n" : "");
    return { removed };
  }
}

// ── S3 Vectors backend ───────────────────────────────────────────────────────
// Mirrors ../core/memory.py's S3VectorsBackend. Over-fetches (topK * 4) and
// filters ttlEpoch/excludeAgent client-side rather than relying on exact
// metadata-filter operator support — S3 Vectors is a preview service and
// filter semantics could shift; this stays correct across API changes at
// the cost of a slightly larger response.

export class S3VectorsBackend {
  constructor({ bucket, index, region }) {
    this.bucket = bucket;
    this.index = index;
    this.client = new S3VectorsClient({ region });
  }

  async put(record, vector) {
    await this.client.send(
      new PutVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.index,
        vectors: [
          {
            key: record.recordId,
            data: { float32: vector },
            metadata: {
              sourceAgent: record.sourceAgent,
              sourceDbKind: record.sourceDbKind,
              createdAt: record.createdAt,
              ttlEpoch: record.ttlEpoch,
              entities: record.entities,
              insightSummary: record.insightSummary,
              suggestedFollowups: record.suggestedFollowups,
            },
          },
        ],
      })
    );
  }

  async query(vector, { excludeAgent, topK }) {
    const response = await this.client.send(
      new QueryVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.index,
        topK: Math.max(topK * 4, 10),
        queryVector: { float32: vector },
        returnMetadata: true,
        returnDistance: true,
      })
    );

    const now = Date.now() / 1000;
    const records = [];
    for (const item of response.vectors || []) {
      const meta = item.metadata || {};
      if (meta.sourceAgent === excludeAgent) continue;
      if (Number(meta.ttlEpoch || 0) < now) continue;
      records.push({
        recordId: item.key,
        sourceAgent: meta.sourceAgent || "",
        sourceDbKind: meta.sourceDbKind || "",
        createdAt: meta.createdAt || "",
        ttlEpoch: Number(meta.ttlEpoch || 0),
        entities: meta.entities || [],
        insightSummary: meta.insightSummary || "",
        suggestedFollowups: meta.suggestedFollowups || [],
      });
      if (records.length >= topK) break;
    }
    return records;
  }

  // Same intent as LocalJsonBackend.invalidateFollowup, but S3 Vectors has
  // no "list all" or text-search primitive — only vector similarity search.
  // So this is a best-effort semantic lookup: it queries near the question's
  // own embedding (a follow-up question is usually reasonably close to the
  // insightSummary it was suggested alongside), then does an exact,
  // normalized string match against the candidates' metadata before
  // touching anything, so a low-recall miss just means "nothing found",
  // never a wrong edit. Vector data for a match is re-fetched via
  // GetVectorsCommand and re-written unchanged — reusing the *query*
  // vector for the PutVectors overwrite would recenter that memory record
  // on the invalidated question's embedding instead of its original
  // insight, corrupting future similarity search for it.
  async invalidateFollowup(questionText, queryVector) {
    const target = normalizeQuestion(questionText);
    const queryResponse = await this.client.send(
      new QueryVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.index,
        topK: 20,
        queryVector: { float32: queryVector },
        returnMetadata: true,
      })
    );

    const candidateKeys = (queryResponse.vectors || [])
      .filter((item) => (item.metadata?.suggestedFollowups || []).some((f) => normalizeQuestion(f) === target))
      .map((item) => item.key);
    if (candidateKeys.length === 0) return { removed: 0 };

    const getResponse = await this.client.send(
      new GetVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.index,
        keys: candidateKeys,
        returnData: true,
        returnMetadata: true,
      })
    );

    let removed = 0;
    const updates = [];
    for (const item of getResponse.vectors || []) {
      const followups = item.metadata?.suggestedFollowups || [];
      const filtered = followups.filter((f) => normalizeQuestion(f) !== target);
      if (filtered.length === followups.length) continue;
      removed += followups.length - filtered.length;
      updates.push({
        key: item.key,
        data: item.data,
        metadata: { ...item.metadata, suggestedFollowups: filtered },
      });
    }

    if (updates.length > 0) {
      await this.client.send(
        new PutVectorsCommand({ vectorBucketName: this.bucket, indexName: this.index, vectors: updates })
      );
    }
    return { removed };
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
    // Embeddings go through cfg.embeddingClient, not the chat `llm` — they
    // don't have to be the same endpoint. What matters is that every agent
    // sharing this store uses the same embedding model, so the config
    // (embeddingClient's base URL/key + embeddingModel) is what needs to
    // match across agents, independent of each agent's own chat model.
    const vector = await embed(cfg.embeddingClient, record.insightSummary, cfg.embeddingModel);
    await cfg.backend.put(record, vector);
  } catch (exc) {
    console.warn(`[memory] write skipped: ${exc.message || exc}`);
  }
}

export async function fetchRelevantMemories(queryText, cfg, topK = 3) {
  if (!cfg.memoryEnabled) return [];
  try {
    const vector = await embed(cfg.embeddingClient, queryText, cfg.embeddingModel);
    return await cfg.backend.query(vector, { excludeAgent: cfg.dbagentId, topK });
  } catch (exc) {
    console.warn(`[memory] fetch skipped: ${exc.message || exc}`);
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
    console.warn(`[memory] invalidate skipped: ${exc.message || exc}`);
    return { removed: 0 };
  }
}
