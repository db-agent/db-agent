import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { parsePricing, parseBudgets, estimateCosts, periodStart } from "../gateway/costs.js";
import { parseGatewayConfig } from "../gateway/config.js";
import { openStore } from "../gateway/store.js";
import { createGateway } from "../gateway/core.js";
import { validateSql } from "../sqlSafety.js";
import { buildReport, renderMarkdown, renderCsv, renderHtml } from "../gateway/report.js";

const KEY_A = "key-alice-claude-0123456789";
const KEY_B = "key-carol-copilot-0123456789";
const pricing = parsePricing({ models: { "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 } }, engines: { postgres: { perGbScanned: 0.5 } } });

test("token cost uses the price table; an unpriced model gives null, not zero", () => {
  const usage = { model: "GPT-4o-mini", calls: 1, inputTokens: 2_000_000, outputTokens: 1_000_000, missing: 0 };
  assert.equal(estimateCosts({ usage, engineType: "sqlite", pricing }).llmUsd, 0.9);
  assert.equal(estimateCosts({ usage: { ...usage, model: "mystery" }, engineType: "sqlite", pricing }).llmUsd, null);
  assert.equal(estimateCosts({ usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, engineType: "sqlite", pricing }).llmUsd, 0, "no LLM call, no cost");
});

test("warehouse cost: engine estimate first, then a per-GB rate, zero for free engines, unknown for databricks without data", () => {
  assert.equal(estimateCosts({ analysis: { sizeInBytes: 1e9, cost: { usd: 1.25 } }, engineType: "databricks-sql", pricing }).warehouseUsd, 1.25);
  assert.equal(estimateCosts({ analysis: { sizeInBytes: 4e9 }, engineType: "postgres", pricing }).warehouseUsd, 2);
  assert.equal(estimateCosts({ analysis: { sizeInBytes: 4e9 }, engineType: "sqlite", pricing }).warehouseUsd, 0);
  assert.equal(estimateCosts({ analysis: null, engineType: "databricks-sql", pricing }).warehouseUsd, null);
});

test("budget and price config are validated", () => {
  assert.throws(() => parseBudgets([{ scope: "planet", metric: "tokens", period: "day", limit: 1, action: "warn" }]), /scope/);
  assert.throws(() => parseBudgets([{ scope: "team", metric: "tokens", period: "day", limit: 0, action: "warn" }]), /limit/);
  assert.throws(() => parseBudgets([{ scope: "team", metric: "tokens", period: "day", limit: 5, action: "shout" }]), /action/);
  assert.throws(() => parsePricing({ models: { x: { inputPer1M: -1 } } }), /0 or more/);
  assert.equal(parseBudgets([{ scope: "team", metric: "tokens", period: "day", limit: 5, action: "warn" }])[0].name, "*");
});

test("periods start at UTC midnight or the first of the month", () => {
  const now = new Date("2026-03-15T17:30:00Z");
  assert.equal(periodStart("day", now), "2026-03-15T00:00:00.000Z");
  assert.equal(periodStart("month", now), "2026-03-01T00:00:00.000Z");
});

// A pipeline stand-in that reports token usage like the real one.
function fakePipeline() {
  return {
    getSchema: async () => ({ orders: [{ name: "id", type: "INTEGER" }] }),
    getKnowledge: () => null,
    describeEngine: () => ({ type: "postgres" }),
    approvalReason: () => null,
    analyzeQuery: async () => null,
    runPipeline: async (question, { rawSql }) => rawSql && !validateSql(rawSql).isSafe ? { question, sql: rawSql, validation: validateSql(rawSql), rows: null, usage: { calls: 0, inputTokens: 0, outputTokens: 0 } } : ({
      question, sql: rawSql || "SELECT id FROM orders", explanation: null, validation: { isSafe: true }, columns: ["id"], rows: [{ id: 1 }],
      error: null, status: "complete", analysis: { sizeInBytes: 2e9, rowCount: 1 },
      usage: rawSql ? { model: "gpt-4o-mini", calls: 0, inputTokens: 0, outputTokens: 0, missing: 0 } : { model: "gpt-4o-mini", calls: 1, inputTokens: 1000, outputTokens: 500, missing: 0 },
    }),
    executeApprovedSql: async (sql) => ({ sql, columns: ["id"], rows: [{ id: 1 }], error: null }),
  };
}

function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-cost-"));
  const store = openStore(path.join(dir, "g.db"));
  const config = parseGatewayConfig({
    callers: [
      { key: KEY_A, user: "alice", team: "analytics", tool: "claude-desktop" },
      { key: KEY_B, user: "carol", team: "finance", tool: "vscode" },
    ],
    pricing: { models: { "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 } }, engines: { postgres: { perGbScanned: 0.5 } } },
    ...extra,
  });
  const gateway = createGateway({ config, store, pipeline: fakePipeline() });
  return { gateway, store, a: gateway.authenticate(KEY_A), c: gateway.authenticate(KEY_B) };
}
const body = (r) => JSON.parse(r.text.slice(r.text.indexOf("{")));

test("each answer reports tokens and estimated costs, and the request log stores them", async () => {
  const { gateway, store, a } = setup();
  const r = await gateway.call(a, "ask", { question: "orders?" });
  const usage = body(r).usage;
  assert.equal(usage.tokens, 1500);
  assert.equal(usage.llmUsdEstimate, 0.00045);
  assert.equal(usage.warehouseUsdEstimate, 1);
  assert.match(usage.note, /estimates/);
  const row = store.listRequests()[0];
  assert.equal(row.input_tokens, 1000);
  assert.equal(row.output_tokens, 500);
  assert.equal(row.llm_usd, 0.00045);
  assert.equal(row.warehouse_usd, 1);
  assert.equal(row.model, "gpt-4o-mini");
});

const tokenBudget = (action, extra = {}) => ({ budgets: [{ scope: "team", name: "analytics", metric: "tokens", period: "day", limit: 2000, action, ...extra }] });

test("a token budget: the request that crosses the limit completes, the next one is blocked, other teams are unaffected", async () => {
  const { gateway, a, c } = setup(tokenBudget("block"));
  const first = await gateway.call(a, "ask", { question: "q1" });
  assert.equal(first.isError, false);
  assert.equal(body(first).usage.budgets[0].remaining, 500);
  await gateway.call(a, "ask", { question: "q2" });
  const third = await gateway.call(a, "ask", { question: "q3" });
  assert.equal(third.isError, true);
  assert.match(third.text, /^Blocked: budget reached\. team "analytics" has used 3000 of 2000 tokens this day/);
  assert.equal((await gateway.call(c, "ask", { question: "q" })).isError, false, "other team");
  assert.equal((await gateway.call(a, "run_sql", { sql: "SELECT 1" })).isError, false, "token budget does not stop run_sql");
});

test("action warn lets the request run and adds a warning", async () => {
  const { gateway, a } = setup(tokenBudget("warn", { limit: 1000 }));
  await gateway.call(a, "ask", { question: "q1" });
  const r = await gateway.call(a, "ask", { question: "q2" });
  assert.equal(r.isError, false);
  assert.match(r.text, /^Budget warning: team "analytics"/);
});

test("action approval holds the question; after approval it runs once and then the budget applies again", async () => {
  const { gateway, store, a } = setup(tokenBudget("approval", { limit: 1000 }));
  await gateway.call(a, "ask", { question: "q1" });
  const held = await gateway.call(a, "ask", { question: "q2" });
  assert.match(held.text, /^Needs approval: budget reached\./);
  const id = held.text.match(/apr_[0-9a-f]+/)[0];
  store.decideApproval(id, "approved", "boss");
  const ran = await gateway.call(a, "ask", { approval_id: id });
  assert.equal(ran.isError, false, ran.text);
  assert.match(ran.text, /Query returned 1 row/);
  assert.match((await gateway.call(a, "ask", { approval_id: id })).text, /already used/);
  assert.match((await gateway.call(a, "ask", { question: "q3" })).text, /^Needs approval: budget reached/);
});

test("a per-entity budget (name *) is counted for each user separately; warehouse budgets also cover run_sql", async () => {
  const { gateway, a, c } = setup({ budgets: [{ scope: "user", metric: "warehouse_usd", period: "day", limit: 1, action: "block" }] });
  assert.equal((await gateway.call(a, "run_sql", { sql: "SELECT 1" })).isError, false);
  assert.match((await gateway.call(a, "run_sql", { sql: "SELECT 2" })).text, /^Blocked: budget reached.*warehouse cost \(estimate\)/);
  assert.equal((await gateway.call(c, "run_sql", { sql: "SELECT 1" })).isError, false, "carol has her own allowance");
});

test("report totals equal the sum of the logged requests, and every breakdown adds up to the total", async () => {
  const { gateway, store, a, c } = setup();
  for (let i = 0; i < 3; i++) await gateway.call(a, "ask", { question: `a${i}` });
  await gateway.call(c, "run_sql", { sql: "SELECT 1" });
  await gateway.call(c, "run_sql", { sql: "DELETE FROM orders" });
  gateway.authenticate("nope-nope-nope-nope-nope");

  const rows = store.listRequests({ limit: 100 });
  const report = buildReport(store, { period: "week" });
  const sum = (key) => rows.reduce((t, r) => t + (r[key] || 0), 0);
  assert.equal(report.totals.requests, rows.length);
  assert.equal(report.totals.tokens, sum("input_tokens") + sum("output_tokens"));
  assert.ok(Math.abs(report.totals.llmUsd - sum("llm_usd")) < 1e-9);
  assert.ok(Math.abs(report.totals.warehouseUsd - sum("warehouse_usd")) < 1e-9);
  for (const dim of ["byTeam", "byTool", "byUser"]) {
    assert.equal(report[dim].reduce((t, b) => t + b.requests, 0), report.totals.requests, dim);
    assert.ok(Math.abs(report[dim].reduce((t, b) => t + b.totalUsd, 0) - report.totals.totalUsd) < 1e-9, dim);
  }
  assert.equal(report.totals.blocked, 1);
  assert.equal(report.totals.rejected, 1);
  assert.equal(report.estimate, true);
  assert.ok(report.topQuestions.length <= 10 && report.topQuestions[0].totalUsd >= report.topQuestions.at(-1).totalUsd);
});

test("report rendering says 'est.' on every cost, flags unpriced models, and escapes HTML and CSV formulas", () => {
  const now = new Date("2026-03-15T12:00:00Z");
  const mk = (over) => ({ ts: "2026-03-14T10:00:00.000Z", status: "ok", user: "u", team: "t", tool: "x", model: "m1", input_tokens: 10, output_tokens: 5, llm_usd: 0.5, warehouse_usd: 0.25, question: "q", sql: null, ...over });
  const rows = [mk({}), mk({ model: "unpriced", llm_usd: null }), mk({ team: "=HYPERLINK(\"x\")", question: "<script>alert(1)</script>" }), mk({ ts: "2026-01-01T00:00:00.000Z" })];
  const report = buildReport(rows, { period: "week", now });
  assert.equal(report.totals.requests, 3, "rolling window drops old rows");
  assert.deepEqual(report.unpricedModels, ["unpriced"]);
  const md = renderMarkdown(report);
  assert.match(md, /All costs are estimates/);
  assert.match(md, /No price is configured for: unpriced/);
  const csv = renderCsv(report);
  assert.match(csv, /'=HYPERLINK/);
  assert.ok(!/[^']=HYPERLINK/.test(csv.replace(/'=HYPERLINK/g, "")));
  const html = renderHtml(report);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("old stores gain the cost columns on open", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-mig-"));
  const file = path.join(dir, "old.db");
  const s1 = openStore(file);
  s1.logRequest({ status: "ok", user: "u" });
  s1.close();
  const s2 = openStore(file);
  s2.logRequest({ status: "ok", user: "u", inputTokens: 5, llmUsd: 0.1 });
  assert.equal(s2.spent({ scope: "user", value: "u", metric: "tokens", since: "2000-01-01" }), 5);
  s2.close();
});
