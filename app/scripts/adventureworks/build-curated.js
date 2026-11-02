#!/usr/bin/env node
// Builds the "fully curated" knowledge file: the database's own comments (ontology-from-comments.js output)
// with the hand-written curated-knowledge.json on top (curated wins on the same key).
//   node scripts/adventureworks/build-curated.js comments.json out.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [commentsFile, out] = process.argv.slice(2);
if (!commentsFile || !out) { console.error("usage: build-curated.js comments.json out.json"); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const comments = JSON.parse(fs.readFileSync(commentsFile, "utf8"));
const curated = JSON.parse(fs.readFileSync(path.join(here, "curated-knowledge.json"), "utf8"));
const merged = {
  descriptions: { ...comments.descriptions, ...curated.descriptions },
  expressions: curated.expressions || {},
  examples: curated.examples || [],
  instructions: curated.instructions || [],
};
fs.writeFileSync(out, JSON.stringify(merged, null, 2) + "\n");
console.log(`${Object.keys(merged.descriptions).length} descriptions, ${Object.keys(merged.expressions).length} definitions, ${merged.examples.length} examples, ${merged.instructions.length} rules -> ${out}`);
