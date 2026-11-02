#!/usr/bin/env node
// Adds a cases file (question + correct SQL, as in scripts/bakehouse/cases.json) to a running db-agent's benchmark
// list, so the Accuracy test can use it. A question that exists with the same SQL is not added twice.
//   node scripts/import-benchmark-cases.js scripts/bakehouse/cases.json [http://localhost:3001]
import fs from "node:fs";

const [file, url] = process.argv.slice(2);
if (!file) { console.error("usage: import-benchmark-cases.js cases.json [url]"); process.exit(2); }
const base = (url || "http://localhost:3001").replace(/\/$/, "");
const cases = JSON.parse(fs.readFileSync(file, "utf8"));
const key = (q, sql) => `${q.toLowerCase()}\u0001${sql.trim().toLowerCase()}`;
const existing = await (await fetch(`${base}/api/benchmarks`)).json();
const have = new Set(existing.map((c) => key(c.question, c.groundTruthSql)));
let added = 0;
for (const c of cases) {
  if (have.has(key(c.question, c.groundTruthSql))) continue;
  const res = await fetch(`${base}/api/benchmarks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: c.question, groundTruthSql: c.groundTruthSql }) });
  if (!res.ok) console.error(`skipped "${c.question}": ${(await res.json()).error}`);
  else added++;
}
console.log(`Added ${added} of ${cases.length} questions (${cases.length - added} already there or refused).`);
