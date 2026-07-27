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
  return "\n\n" + sections.join("\n\n");
}
