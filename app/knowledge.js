// knowledge.js — optional per-deployment context injected into the prompt
// alongside the raw schema. Fixes the class of errors that come from the
// LLM not knowing business terminology, ambiguous columns, or house rules —
// the schema alone (table/column names + types) doesn't carry any of that.
//
// Strictly optional: missing/absent knowledge.json means zero change to
// existing behavior. Read fresh on every request (like getSchema()) rather
// than cached at startup, so editing the file takes effect immediately —
// this is meant to be iterated on while curating, not configured once.
//
// Expected shape (all fields optional):
// {
//   "descriptions": {
//     "orders.ordered_at": "date the order was placed; synonyms: purchase date, order date"
//   },
//   "expressions": {
//     "revenue": "SUM(quantity * price)"
//   },
//   "examples": [
//     { "question": "Who are our best customers?", "sql": "SELECT ..." }
//   ],
//   "instructions": [
//     "Exclude cancelled orders unless the question explicitly asks for them."
//   ]
// }

import fs from "node:fs";
import { cosineSimilarity, embed } from "./memory.js";

const DEFAULT_MAX_EXAMPLES = 3;
// Rough estimate (chars/4), not a real tokenizer — good enough to flag
// "this knowledge block is getting large" without adding a tokenizer
// dependency for what's currently a diagnostic warning, not a hard limit.
const TOKEN_WARN_THRESHOLD = 800;

// Keyed by exact example question text. Both hand-curated knowledge.json
// examples and benchmark-derived examples (see benchmarks.js) flow through
// here, and neither changes example question text without also changing
// the underlying object's identity, so no separate cache invalidation is
// needed at this scale.
const exampleEmbeddingCache = new Map();

export function loadKnowledge(filePath) {
  if (!fs.existsSync(filePath)) return null;

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (exc) {
    console.warn(`[knowledge] could not read ${filePath}: ${exc.message || exc}`);
    return null;
  }

  try {
    const data = JSON.parse(raw);
    return {
      descriptions: data.descriptions && typeof data.descriptions === "object" ? data.descriptions : {},
      expressions: data.expressions && typeof data.expressions === "object" ? data.expressions : {},
      examples: Array.isArray(data.examples) ? data.examples : [],
      instructions: Array.isArray(data.instructions) ? data.instructions : [],
    };
  } catch (exc) {
    console.warn(`[knowledge] ${filePath} is not valid JSON, ignoring: ${exc.message || exc}`);
    return null;
  }
}

function mentionsWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

// Descriptions/expressions are cheap to filter with keyword matching — no
// embeddings needed. A description for "customers.email" only earns its
// place in the prompt if the question actually mentions "customers" (or
// "email"); same idea for expression names like "revenue".
function filterByKeywordMatch(entries, question) {
  return Object.fromEntries(
    Object.entries(entries).filter(([key]) => {
      const table = key.split(".")[0];
      return mentionsWord(question, table) || mentionsWord(question, key);
    })
  );
}

async function selectRelevantExamples(examples, question, embeddingClient, embeddingModel, maxExamples) {
  if (examples.length <= maxExamples) return examples;

  // Only worth the embedding calls once there are more examples than the
  // cap — small files (the common case) skip this entirely.
  try {
    const questionVector = await embed(embeddingClient, question, embeddingModel);

    const scored = await Promise.all(
      examples.map(async (ex) => {
        let vector = exampleEmbeddingCache.get(ex.question);
        if (!vector) {
          vector = await embed(embeddingClient, ex.question, embeddingModel);
          exampleEmbeddingCache.set(ex.question, vector);
        }
        return { ex, score: cosineSimilarity(questionVector, vector) };
      })
    );

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxExamples).map((s) => s.ex);
  } catch (exc) {
    // Selection is a refinement, not a correctness requirement — if
    // embedding fails for any reason, fall back to the first N examples
    // rather than failing the whole request.
    console.warn(`[knowledge] example selection skipped, using first ${maxExamples}: ${exc.message || exc}`);
    return examples.slice(0, maxExamples);
  }
}

// Filters a knowledge object down to what's relevant to this specific
// question, so the prompt isn't paying — in tokens, and in the
// small-model-bias risk of irrelevant few-shot examples — for the whole
// file (or the whole benchmark example set) on every request regardless of
// relevance. `knowledge` doesn't have to come from loadKnowledge(); the
// caller may merge in benchmark-derived examples first (see server.js).
export async function selectRelevantKnowledge(
  knowledge,
  question,
  embeddingClient,
  embeddingModel,
  { maxExamples = DEFAULT_MAX_EXAMPLES } = {}
) {
  if (!knowledge) return null;

  const descriptions = filterByKeywordMatch(knowledge.descriptions, question);
  const expressions = filterByKeywordMatch(knowledge.expressions, question);
  const examples = await selectRelevantExamples(
    knowledge.examples,
    question,
    embeddingClient,
    embeddingModel,
    maxExamples
  );

  return { descriptions, expressions, examples, instructions: knowledge.instructions };
}

export function formatKnowledge(knowledge) {
  if (!knowledge) return "";

  const sections = [];

  const descEntries = Object.entries(knowledge.descriptions);
  if (descEntries.length > 0) {
    sections.push(
      "Column/table notes:\n" +
        descEntries.map(([key, desc]) => `  ${key}: ${desc}`).join("\n")
    );
  }

  const exprEntries = Object.entries(knowledge.expressions);
  if (exprEntries.length > 0) {
    sections.push(
      "Reusable expressions (use these exact definitions when the question refers to them):\n" +
        exprEntries.map(([name, expr]) => `  ${name} = ${expr}`).join("\n")
    );
  }

  if (knowledge.examples.length > 0) {
    sections.push(
      "Example questions and their correct SQL for this schema:\n" +
        knowledge.examples
          .map((ex) => `  Q: ${ex.question}\n  SQL: ${ex.sql}`)
          .join("\n\n")
    );
  }

  if (knowledge.instructions.length > 0) {
    sections.push(
      "General instructions (apply to every query):\n" +
        knowledge.instructions.map((rule) => `  - ${rule}`).join("\n")
    );
  }

  if (sections.length === 0) return "";

  const text = "\n\n" + sections.join("\n\n");
  const estimatedTokens = Math.ceil(text.length / 4); // no tokenizer dep — rough but enough to flag growth
  if (estimatedTokens > TOKEN_WARN_THRESHOLD) {
    console.warn(
      `[knowledge] injected block is ~${estimatedTokens} tokens (over the ${TOKEN_WARN_THRESHOLD} warn threshold) — ` +
        `consider trimming knowledge.json, lowering maxExamples, or pruning stale benchmark cases`
    );
  }
  return text;
}
