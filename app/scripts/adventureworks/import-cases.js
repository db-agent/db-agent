#!/usr/bin/env node
// Adds the AdventureWorks questions (cases.json) to a running db-agent's benchmark list, so the Accuracy test can use them.
//   node scripts/adventureworks/import-cases.js [http://localhost:3001]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] || "http://localhost:3001").replace(/\/$/, "");
const cases = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "cases.json"), "utf8"));
const existing = await (await fetch(`${base}/api/benchmarks`)).json();
const have = new Set(existing.map((c) => c.question.toLowerCase()));
let added = 0;
for (const c of cases) {
  if (have.has(c.question.toLowerCase())) continue;
  const res = await fetch(`${base}/api/benchmarks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: c.question, groundTruthSql: c.groundTruthSql }) });
  if (!res.ok) console.error(`skipped "${c.question}": ${(await res.json()).error}`);
  else added++;
}
console.log(`Added ${added} of ${cases.length} questions (${cases.length - added} already there or refused).`);
