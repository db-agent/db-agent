#!/usr/bin/env node
// Run this a few minutes before the bakehouse demo. It checks every piece the demo needs and warms the model.
//   node scripts/bakehouse/preflight.js [plainUrl] [curatedUrl]
// Defaults: http://localhost:3001 and http://localhost:3002. Env: OLLAMA_URL, DEMO_LLM_MODEL.
const plain = (process.argv[2] || "http://localhost:3001").replace(/\/$/, "");
const curated = (process.argv[3] || "http://localhost:3002").replace(/\/$/, "");
const ollama = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const model = process.env.DEMO_LLM_MODEL || "qwen2.5-coder:7b";

let failed = 0, warned = 0;
const line = (level, label, detail = "") => {
  if (level === "FAIL") failed++;
  if (level === "WARN") warned++;
  console.log(`${level.padEnd(4)}  ${label}${detail ? `: ${detail}` : ""}`);
};
const get = async (url, ms = 20000) => (await fetch(url, { signal: AbortSignal.timeout(ms) })).json();
const post = async (url, body, ms = 240000) =>
  (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })).json();

async function check(label, fn) {
  try { await fn(); } catch (exc) { line("FAIL", label, String(exc.message || exc).slice(0, 160)); }
}

await check("Ollama", async () => {
  const tags = await get(`${ollama}/api/tags`, 5000);
  const have = (tags.models || []).some((m) => m.name === model);
  line(have ? "OK" : "FAIL", `Ollama has ${model}`, have ? "" : `run: ollama pull ${model}`);
});

for (const [name, url, expectOntology] of [["without ontology", plain, false], ["with ontology", curated, true]]) {
  await check(`${name} (${url})`, async () => {
    const cfg = await get(`${url}/api/config`);
    line(cfg.sqlEngineInfo?.type === "databricks-sql" ? "OK" : "FAIL", `${name}: engine`, cfg.sqlEngineInfo?.type || "unknown");
    line(cfg.llmModel === model ? "OK" : "WARN", `${name}: model`, cfg.llmModel);
    const schema = await get(`${url}/api/schema`, 120000);
    const tables = Object.keys(schema);
    line(tables.length >= 5 ? "OK" : "FAIL", `${name}: Databricks schema reachable`, `${tables.length} tables`);
    const onto = await get(`${url}/api/ontology`);
    const notes = Object.keys(onto.knowledge.descriptions).length;
    if (expectOntology) line(notes >= 30 ? "OK" : "FAIL", `${name}: prepared ontology loaded`, `${notes} notes, ${Object.keys(onto.knowledge.expressions).length} definitions, ${onto.knowledge.instructions.length} rules`);
    else line(notes === 0 ? "OK" : "WARN", `${name}: starts empty`, notes === 0 ? "" : `${notes} notes already saved: recreate the instance to reset`);
    const cases = await get(`${url}/api/ab/cases`);
    line(cases.eligible.length >= 15 ? "OK" : "FAIL", `${name}: benchmark questions loaded`, `${cases.eligible.length}`);
    const t0 = Date.now();
    const out = await post(`${url}/api/ask`, { question: "How many customers are there?" });
    const n = out.rows && Object.values(out.rows[0] || {})[0];
    line(Number(n) === 300 ? "OK" : "FAIL", `${name}: warm-up question answered`, `${n} customers in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  });
}

await check("accuracy test result", async () => {
  const s = await get(`${curated}/api/ab/status`);
  if (s.status === "done") line("OK", "accuracy test already run on the instance with the ontology", `without ${s.summary.off.pass}/${s.summary.off.total}, with ${s.summary.on.pass}/${s.summary.on.total}`);
  else line("WARN", "accuracy test not run yet on the instance with the ontology", "open Ontology > Accuracy test and run it now (about 5 minutes) so the result is on screen during the demo");
});

console.log(failed ? `\n${failed} check(s) failed. Fix them before the demo.` : `\nReady.${warned ? ` ${warned} warning(s) above.` : ""}`);
process.exit(failed ? 1 : 0);
