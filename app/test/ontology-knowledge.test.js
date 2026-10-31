import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { validateKnowledge, saveKnowledge, mergeDraft, renderSkill } from "../ontology/knowledgeFile.js";
import { loadKnowledge } from "../knowledge.js";

test("validate keeps the four sections, trims, drops blanks, rejects bad shapes", () => {
  const r = validateKnowledge({ descriptions: { " a.b ": " text ", c: "  " }, expressions: { revenue: "SUM(x)" }, examples: [{ question: "q", sql: "SELECT 1" }, { question: "", sql: "" }], instructions: [" rule ", ""], extra: 1 });
  assert.deepEqual(r.value, { descriptions: { "a.b": "text" }, expressions: { revenue: "SUM(x)" }, examples: [{ question: "q", sql: "SELECT 1" }], instructions: ["rule"] });
  assert.equal(validateKnowledge([]).ok, false);
  assert.equal(validateKnowledge({ descriptions: { a: 5 } }).ok, false);
  assert.equal(validateKnowledge({ examples: [{ question: "q" }] }).ok, false);
  assert.equal(validateKnowledge({ instructions: "no" }).ok, false);
  assert.equal(validateKnowledge({ descriptions: { a: "x".repeat(2001) } }).ok, false);
});

test("save writes a file the loader reads, and backs up the previous one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
  const f = path.join(dir, "knowledge.json");
  assert.equal(saveKnowledge(f, { descriptions: { a: "one" }, expressions: {}, examples: [], instructions: [] }).backup, null);
  const { backup } = saveKnowledge(f, { descriptions: { a: "two" }, expressions: {}, examples: [], instructions: ["r"] });
  assert.ok(backup && fs.existsSync(backup));
  assert.equal(JSON.parse(fs.readFileSync(backup, "utf8")).descriptions.a, "one");
  assert.equal(loadKnowledge(f).descriptions.a, "two");
  assert.deepEqual(loadKnowledge(f).instructions, ["r"]);
});

test("mergeDraft: what a person wrote wins over the scan", () => {
  const m = mergeDraft(
    { descriptions: { "o.status": "mine" }, expressions: {}, examples: [{ question: "q", sql: "S" }], instructions: ["r"] },
    { descriptions: { "o.status": "scan", "o.id": "scan id" }, expressions: {}, examples: [{ question: "q", sql: "OTHER" }], instructions: ["r", "s"] }
  );
  assert.equal(m.descriptions["o.status"], "mine");
  assert.equal(m.descriptions["o.id"], "scan id");
  assert.equal(m.examples.length, 1);
  assert.deepEqual(m.instructions, ["r", "s"]);
});

test("skill export has frontmatter, rules, definitions, tables and examples", () => {
  const md = renderSkill({ descriptions: { orders: "One row per order.", "orders.status": "5 = shipped" }, expressions: { revenue: "SUM(q*p)" }, examples: [{ question: "How many?", sql: "SELECT 1" }], instructions: ["Use schema names."] }, { name: "Adventure Works!", engine: "Postgres" });
  assert.match(md, /^---\nname: adventure-works\ndescription: .*Postgres/);
  for (const part of ["## Rules", "- Use schema names.", "**revenue**: `SUM(q*p)`", "### orders", "One row per order.", "- `status`: 5 = shipped", "```sql\nSELECT 1\n```"]) assert.ok(md.includes(part), part);
});
