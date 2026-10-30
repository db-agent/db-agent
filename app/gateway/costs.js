// gateway/costs.js: price table, cost estimates and budgets. Everything here is an ESTIMATE:
// token prices come from the user's own config, warehouse cost comes from a planner estimate
// (bytes the optimizer expects to scan, or Databricks' compute-cost estimate), never from a bill.

import fs from "node:fs";

export const BUDGET_SCOPES = ["user", "team", "tool"];
export const BUDGET_METRICS = ["tokens", "llm_usd", "warehouse_usd"];
export const BUDGET_PERIODS = ["day", "month"];
export const BUDGET_ACTIONS = ["warn", "approval", "block"];

const num = (v, what) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${what} must be a number of 0 or more`);
  return n;
};

// pricing: { models: { "<model>": { inputPer1M, outputPer1M } }, engines: { "<engine>": { perGbScanned } } }
export function parsePricing(raw) {
  const pricing = { models: {}, engines: {} };
  for (const [model, p] of Object.entries(raw?.models || {})) {
    pricing.models[model.toLowerCase()] = {
      inputPer1M: num(p.inputPer1M ?? 0, `pricing.models.${model}.inputPer1M`),
      outputPer1M: num(p.outputPer1M ?? 0, `pricing.models.${model}.outputPer1M`),
    };
  }
  for (const [engine, p] of Object.entries(raw?.engines || {})) {
    pricing.engines[engine.toLowerCase()] = { perGbScanned: num(p.perGbScanned ?? 0, `pricing.engines.${engine}.perGbScanned`) };
  }
  return pricing;
}

export function parseBudgets(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('"budgets" must be an array');
  return raw.map((b, i) => {
    const where = `budgets[${i}]`;
    if (!BUDGET_SCOPES.includes(b.scope)) throw new Error(`${where}.scope must be one of ${BUDGET_SCOPES.join(", ")}`);
    if (!BUDGET_METRICS.includes(b.metric)) throw new Error(`${where}.metric must be one of ${BUDGET_METRICS.join(", ")}`);
    if (!BUDGET_PERIODS.includes(b.period)) throw new Error(`${where}.period must be one of ${BUDGET_PERIODS.join(", ")}`);
    if (!BUDGET_ACTIONS.includes(b.action)) throw new Error(`${where}.action must be one of ${BUDGET_ACTIONS.join(", ")}`);
    const limit = Number(b.limit);
    if (!(limit > 0)) throw new Error(`${where}.limit must be greater than 0`);
    return { scope: b.scope, name: String(b.name ?? "*"), metric: b.metric, period: b.period, limit, action: b.action };
  });
}

// Lenient read for callers that only need the price table (the web server): a missing or
// unreadable file means "no prices", not an error.
export function loadPricing(filePath) {
  try {
    return parsePricing(JSON.parse(fs.readFileSync(filePath, "utf8")).pricing);
  } catch {
    return parsePricing(null);
  }
}

const round = (n, places = 6) => (n == null ? null : Math.round(n * 10 ** places) / 10 ** places);

// usage: { model, calls, inputTokens, outputTokens, missing } from the pipeline.
// Returns null for a cost that cannot be estimated (no price configured), so reports can say so.
export function estimateCosts({ usage, analysis, engineType, pricing }) {
  let llmUsd = 0;
  if (usage && usage.calls > 0) {
    const p = pricing.models[String(usage.model || "").toLowerCase()];
    llmUsd = p ? round((usage.inputTokens / 1e6) * p.inputPer1M + (usage.outputTokens / 1e6) * p.outputPer1M) : null;
  }

  let warehouseUsd = null;
  const rate = pricing.engines[String(engineType || "").toLowerCase()]?.perGbScanned;
  const fromEngine = analysis && !analysis.error && analysis.cost && !analysis.cost.error ? (analysis.cost.usd ?? null) : null;
  if (fromEngine != null) warehouseUsd = round(fromEngine);
  else if (rate != null && analysis?.sizeInBytes != null) warehouseUsd = round((analysis.sizeInBytes / 1e9) * rate);
  else if (engineType !== "databricks-sql") warehouseUsd = 0; // postgres, sqlite, duckdb: free unless a rate is set
  return { llmUsd, warehouseUsd };
}

// Start of the current UTC day or month.
export function periodStart(period, now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  if (period === "month") d.setUTCDate(1);
  return d.toISOString();
}

const callerValue = (caller, scope) => (scope === "team" ? caller.team : scope === "user" ? caller.user : caller.tool);

// Which budgets apply to this caller and tool, how much each has spent, and what each would do.
// Spent counts what was already logged, so the request that crosses a limit completes and the
// next one is acted on.
export function evaluateBudgets({ budgets, caller, mcpTool, spentFor, now = new Date() }) {
  const relevantMetric = (metric) => (metric === "warehouse_usd" ? mcpTool === "ask" || mcpTool === "run_sql" : mcpTool === "ask");
  const rows = [];
  for (const b of budgets) {
    if (!relevantMetric(b.metric)) continue;
    const value = callerValue(caller, b.scope);
    if (value == null || (b.name !== "*" && b.name !== value)) continue;
    const spent = spentFor({ scope: b.scope, value, metric: b.metric, since: periodStart(b.period, now) });
    rows.push({ ...b, value, spent, remaining: Math.max(0, b.limit - spent), exceeded: spent >= b.limit });
  }
  return rows;
}
