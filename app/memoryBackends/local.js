// memoryBackends/local.js — JSONL + cosine similarity, no cloud/server setup.
// Mirrors ../../core/memory.py's LocalJsonBackend — the default, and what
// makes cross-platform memory demoable via run_local.sh with zero config.

import fs from "node:fs";
import path from "node:path";
import { cosineSimilarity, normalizeQuestion } from "../memory.js";

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
