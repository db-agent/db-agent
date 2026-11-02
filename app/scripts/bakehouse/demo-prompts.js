#!/usr/bin/env node
// Asks a list of prompts to both bakehouse instances and prints the SQL and the answer side by side.
// Judge by the answer too: two statements can differ in wording and return the same rows.
//   node scripts/bakehouse/demo-prompts.js [plainUrl] [curatedUrl]
const qs = [
 "How many suppliers are approved?",
 "How many transactions were paid with visa?",
 "What is the revenue from female customers?",
 "How many male customers are there?",
 "How many customers live in the United States?",
 "How many franchises are in the United States?",
 "How many XXL franchises are there?",
 "Which suppliers provide cacao?",
 "How many American Express payments were there?",
 "How many reviews are there?",
 "What is the average sale value?",
 "List the largest franchises",
 "How many suppliers are in North America?",
 "Show me the customers' email addresses in Japan",
 "Which product is the best seller?",
 "What is the total revenue per payment method?",
];
const plainUrl = (process.argv[2] || "http://localhost:3001").replace(/\/$/, "");
const curatedUrl = (process.argv[3] || "http://localhost:3002").replace(/\/$/, "");
const ask = async (base, q) => {
  try {
    const r = await (await fetch(base + "/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }), signal: AbortSignal.timeout(240000) })).json();
    return { sql: (r.sql || "").replace(/\s+/g, " "), val: r.rows ? JSON.stringify(r.rows.slice(0, 2).map((x) => Object.values(x))).slice(0, 80) : (r.error || r.validation?.reason || r.status || "") };
  } catch (e) { return { sql: "", val: "ERR " + e.message }; }
};
for (const q of qs) {
  const a = await ask(plainUrl, q), b = await ask(curatedUrl, q);
  const same = a.sql === b.sql;
  console.log(`\n${same ? "SAME SQL" : "DIFFERENT"} | ${q}`);
  console.log("  without:", a.sql.slice(0, 170), "=>", a.val);
  console.log("  with   :", b.sql.slice(0, 170), "=>", b.val);
}
