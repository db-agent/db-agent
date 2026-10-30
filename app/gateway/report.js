// gateway/report.js: spend and activity report built from the request log. Every cost here is an
// estimate (see costs.js). Totals are plain sums over the logged rows in the window.

export const REPORT_PERIODS = { day: 1, week: 7, month: 30 }; // rolling windows, in days

const money = (n) => Math.round(n * 1e6) / 1e6;
const cost = (r) => (r.llm_usd || 0) + (r.warehouse_usd || 0);

function emptyBucket(key) {
  return { key, requests: 0, ok: 0, blocked: 0, needsApproval: 0, rejected: 0, errors: 0, tokens: 0, llmUsd: 0, warehouseUsd: 0, totalUsd: 0 };
}

function add(bucket, r) {
  bucket.requests += 1;
  if (r.status === "ok") bucket.ok += 1;
  else if (r.status === "blocked") bucket.blocked += 1;
  else if (r.status === "needs_approval") bucket.needsApproval += 1;
  else if (r.status === "rejected_auth") bucket.rejected += 1;
  else if (r.status === "error") bucket.errors += 1;
  bucket.tokens += (r.input_tokens || 0) + (r.output_tokens || 0);
  bucket.llmUsd += r.llm_usd || 0;
  bucket.warehouseUsd += r.warehouse_usd || 0;
  bucket.totalUsd += cost(r);
}

function finish(bucket) {
  return { ...bucket, llmUsd: money(bucket.llmUsd), warehouseUsd: money(bucket.warehouseUsd), totalUsd: money(bucket.totalUsd) };
}

function group(rows, keyOf) {
  const map = new Map();
  for (const r of rows) {
    const key = keyOf(r) ?? "(none)";
    if (!map.has(key)) map.set(key, emptyBucket(key));
    add(map.get(key), r);
  }
  return [...map.values()].map(finish).sort((a, b) => b.totalUsd - a.totalUsd || b.requests - a.requests);
}

// store: anything with requestsSince(iso). Pure over the rows, so tests can pass plain arrays.
export function buildReport(store, { period = "week", now = new Date() } = {}) {
  const days = REPORT_PERIODS[period];
  if (!days) throw new Error(`period must be one of ${Object.keys(REPORT_PERIODS).join(", ")}`);
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = (typeof store.requestsSince === "function" ? store.requestsSince(since) : store).filter((r) => r.ts >= since);

  const total = emptyBucket("total");
  for (const r of rows) add(total, r);

  const top = rows
    .filter((r) => cost(r) > 0)
    .sort((a, b) => cost(b) - cost(a))
    .slice(0, 10)
    .map((r) => ({
      ts: r.ts, user: r.user, team: r.team, tool: r.tool, question: r.question, sql: r.sql,
      llmUsd: money(r.llm_usd || 0), warehouseUsd: money(r.warehouse_usd || 0), totalUsd: money(cost(r)),
    }));

  // Rows that used tokens but have no price: their cost is missing from the totals, not zero.
  const unpricedModels = [...new Set(rows.filter((r) => (r.input_tokens || r.output_tokens) && r.llm_usd == null && r.model).map((r) => r.model))];

  return {
    period, since, until: now.toISOString(), estimate: true,
    totals: finish(total),
    byTeam: group(rows, (r) => r.team),
    byTool: group(rows, (r) => r.tool),
    byUser: group(rows, (r) => r.user),
    byModel: group(rows.filter((r) => r.model), (r) => r.model),
    topQuestions: top,
    unpricedModels,
    cacheSavings: null, // arrives with the result cache (#73)
  };
}

const usd = (n) => `$${n.toFixed(4)}`;
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");

function mdTable(title, buckets, label) {
  if (buckets.length === 0) return `## ${title}\n\n(no data)\n`;
  const head = `| ${label} | Requests | OK | Blocked | Needs approval | Tokens | LLM (est.) | Warehouse (est.) | Total (est.) |`;
  const rule = "|---|--:|--:|--:|--:|--:|--:|--:|--:|";
  const lines = buckets.map((b) => `| ${cell(b.key)} | ${b.requests} | ${b.ok} | ${b.blocked} | ${b.needsApproval} | ${b.tokens} | ${usd(b.llmUsd)} | ${usd(b.warehouseUsd)} | ${usd(b.totalUsd)} |`);
  return `## ${title}\n\n${[head, rule, ...lines].join("\n")}\n`;
}

export function renderMarkdown(r) {
  const t = r.totals;
  const parts = [
    `# db-agent spend report, last ${r.period}`,
    `${r.since} to ${r.until}. **All costs are estimates**, not billed amounts: LLM cost uses the price table in gateway.json, warehouse cost uses the optimizer's estimate.`,
    `**Total:** ${t.requests} requests, ${t.tokens} tokens, LLM ${usd(t.llmUsd)} (est.), warehouse ${usd(t.warehouseUsd)} (est.), total ${usd(t.totalUsd)} (est.). ` +
      `${t.ok} ok, ${t.blocked} blocked, ${t.needsApproval} held for approval, ${t.rejected} rejected keys, ${t.errors} errors.`,
  ];
  if (r.unpricedModels.length) {
    parts.push(`> No price is configured for: ${r.unpricedModels.join(", ")}. Their token cost is missing from the totals. Add it under \`pricing.models\`.`);
  }
  parts.push(mdTable("By team", r.byTeam, "Team"), mdTable("By tool", r.byTool, "Tool"), mdTable("By user", r.byUser, "User"), mdTable("By model", r.byModel, "Model"));
  parts.push(
    "## Most expensive questions (estimates)\n\n" +
      (r.topQuestions.length
        ? ["| When | Who | Tool | Question or SQL | Total (est.) |", "|---|---|---|---|--:|",
            ...r.topQuestions.map((q) => `| ${q.ts} | ${cell(q.user)} | ${cell(q.tool)} | ${cell((q.question || q.sql || "").slice(0, 100))} | ${usd(q.totalUsd)} |`)].join("\n")
        : "(none with a cost above zero)") + "\n",
    "## Cache savings\n\nNot available yet (the result cache is feature 3).\n"
  );
  return parts.join("\n\n");
}

// Spreadsheets run text starting with = + - @ as a formula: neutralize keys that come from config or users.
const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function renderCsv(r) {
  const header = ["dimension", "key", "requests", "ok", "blocked", "needs_approval", "rejected_auth", "errors", "tokens", "llm_usd_estimate", "warehouse_usd_estimate", "total_usd_estimate"];
  const lines = [header.join(",")];
  const emit = (dimension, b) =>
    lines.push([dimension, b.key, b.requests, b.ok, b.blocked, b.needsApproval, b.rejected, b.errors, b.tokens, b.llmUsd, b.warehouseUsd, b.totalUsd].map(csvCell).join(","));
  emit("total", r.totals);
  for (const [dim, list] of [["team", r.byTeam], ["tool", r.byTool], ["user", r.byUser], ["model", r.byModel]]) for (const b of list) emit(dim, b);
  return lines.join("\r\n") + "\r\n";
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function htmlTable(title, buckets, label) {
  const rows = buckets.map((b) => `<tr><td>${esc(b.key)}</td><td>${b.requests}</td><td>${b.ok}</td><td>${b.blocked}</td><td>${b.needsApproval}</td><td>${b.tokens}</td><td>${usd(b.llmUsd)}</td><td>${usd(b.warehouseUsd)}</td><td>${usd(b.totalUsd)}</td></tr>`).join("");
  return `<h2>${esc(title)}</h2>${buckets.length ? `<table><thead><tr><th>${esc(label)}</th><th>Requests</th><th>OK</th><th>Blocked</th><th>Needs approval</th><th>Tokens</th><th>LLM (est.)</th><th>Warehouse (est.)</th><th>Total (est.)</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No data.</p>"}`;
}

export function renderHtml(r) {
  const t = r.totals;
  const top = r.topQuestions.map((q) => `<tr><td>${esc(q.ts)}</td><td>${esc(q.user)}</td><td>${esc(q.tool)}</td><td>${esc((q.question || q.sql || "").slice(0, 120))}</td><td>${usd(q.totalUsd)}</td></tr>`).join("");
  const tabs = Object.keys(REPORT_PERIODS).map((p) => (p === r.period ? `<b>${p}</b>` : `<a href="?format=html&amp;period=${p}">${p}</a>`)).join(" | ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>db-agent spend report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{border:1px solid #ccc;padding:.35rem .6rem;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#f3f3f3}.note{background:#fff7e0;padding:.6rem .8rem;border-radius:4px}@media (prefers-color-scheme:dark){body{background:#161616;color:#e6e6e6}th{background:#262626}td,th{border-color:#444}.note{background:#3a3220}}</style></head><body>
<h1>db-agent spend report, last ${esc(r.period)}</h1><p>${tabs}</p>
<p class="note">All costs are <b>estimates</b>, not billed amounts. LLM cost uses the price table in gateway.json; warehouse cost uses the optimizer's estimate.</p>
<p><b>Total:</b> ${t.requests} requests, ${t.tokens} tokens, LLM ${usd(t.llmUsd)}, warehouse ${usd(t.warehouseUsd)}, total ${usd(t.totalUsd)} (all est.). ${t.ok} ok, ${t.blocked} blocked, ${t.needsApproval} held, ${t.rejected} rejected keys, ${t.errors} errors.</p>
${r.unpricedModels.length ? `<p class="note">No price is configured for: ${esc(r.unpricedModels.join(", "))}. Their token cost is missing from the totals.</p>` : ""}
${htmlTable("By team", r.byTeam, "Team")}${htmlTable("By tool", r.byTool, "Tool")}${htmlTable("By user", r.byUser, "User")}${htmlTable("By model", r.byModel, "Model")}
<h2>Most expensive questions (estimates)</h2>${top ? `<table><thead><tr><th>When</th><th>Who</th><th>Tool</th><th>Question or SQL</th><th>Total (est.)</th></tr></thead><tbody>${top}</tbody></table>` : "<p>None with a cost above zero.</p>"}
<h2>Cache savings</h2><p>Not available yet (the result cache is feature 3).</p></body></html>`;
}
