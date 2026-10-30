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
  const rows = buckets.map((b) => `<tr><td>${esc(b.key)}</td><td>${b.requests}</td><td>${b.ok}</td><td>${b.blocked}</td><td>${b.needsApproval}</td><td>${b.tokens.toLocaleString("en-US")}</td><td>${usd(b.llmUsd)}</td><td>${usd(b.warehouseUsd)}</td><td>${usd(b.totalUsd)}</td></tr>`).join("");
  return `<h2>${esc(title)}</h2>${buckets.length ? `<div class="scroll"><table><thead><tr><th>${esc(label)}</th><th>Requests</th><th>OK</th><th>Blocked</th><th>Needs approval</th><th>Tokens</th><th>LLM (est.)</th><th>Warehouse (est.)</th><th>Total (est.)</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No data.</p>'}`;
}

// Brand colors: azure blue primary, blood orange secondary. Light and dark themes.
const REPORT_CSS = `
:root{--azure:#0078d4;--azure-dark:#005a9e;--azure-tint:#e8f3fc;--orange:#d9480f;--orange-tint:#fdeee6;--bg:#f6f9fc;--card:#fff;--text:#14212e;--muted:#5a6b7b;--line:#d6e2ee;--on-azure:#fff}
@media (prefers-color-scheme:dark){:root{--azure:#4aa8f0;--azure-dark:#0b3a5e;--azure-tint:#10283d;--orange:#ff7a45;--orange-tint:#3a2216;--bg:#0e151c;--card:#16212c;--text:#e4edf5;--muted:#93a5b6;--line:#2a3a4a;--on-azure:#06243d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:linear-gradient(135deg,#005a9e,#0078d4 60%,#2b95e6);color:#fff;padding:1.6rem 1rem 1.3rem;border-bottom:4px solid var(--orange)}
header .in,main{max-width:1040px;margin:0 auto;padding:0 1rem}
header h1{margin:0 0 .25rem;font-size:1.5rem}header p{margin:0;opacity:.9}
.tabs{margin-top:.9rem;display:flex;gap:.4rem}
.tabs a,.tabs b{padding:.25rem .8rem;border-radius:999px;font-size:.85rem;text-decoration:none;border:1px solid rgba(255,255,255,.5);color:#fff}
.tabs b{background:var(--orange);border-color:var(--orange)}
.tabs a:hover{background:rgba(255,255,255,.18)}
main{padding-top:1.2rem;padding-bottom:3rem}
.note{background:var(--orange-tint);border-left:4px solid var(--orange);padding:.6rem .9rem;border-radius:4px;margin:.8rem 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.7rem;margin:1rem 0}
.card{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--azure);border-radius:6px;padding:.7rem .9rem}
.card.total{border-top-color:var(--orange)}
.card .v{font-size:1.35rem;font-weight:650}.card.total .v{color:var(--orange)}
.card .l{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
h2{margin:1.8rem 0 .5rem;font-size:1.1rem;color:var(--azure);padding-bottom:.25rem;border-bottom:2px solid var(--line)}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:6px;overflow:hidden}
th,td{padding:.4rem .7rem;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
thead th{background:var(--azure);color:var(--on-azure);border-bottom:2px solid var(--orange);font-weight:600;font-size:.82rem}
tbody tr:nth-child(even){background:var(--azure-tint)}
td:last-child{font-weight:650;color:var(--orange)}
th.q,td.q{text-align:left;white-space:normal;max-width:420px}
.muted{color:var(--muted)}
`;

function card(label, value, extra = "") {
  return `<div class="card ${extra}"><div class="v">${value}</div><div class="l">${esc(label)}</div></div>`;
}

export function renderHtml(r) {
  const t = r.totals;
  const top = r.topQuestions.map((q) => `<tr><td>${esc(q.ts)}</td><td>${esc(q.user)}</td><td>${esc(q.tool)}</td><td class="q">${esc((q.question || q.sql || "").slice(0, 120))}</td><td>${usd(q.totalUsd)}</td></tr>`).join("");
  const tabs = Object.keys(REPORT_PERIODS).map((p) => (p === r.period ? `<b>${p}</b>` : `<a href="?format=html&amp;period=${p}">${p}</a>`)).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>db-agent spend report</title><style>${REPORT_CSS}</style></head><body>
<header><div class="in"><h1>db-agent spend report</h1><p>Last ${esc(r.period)}: ${esc(r.since)} to ${esc(r.until)}</p><div class="tabs">${tabs}</div></div></header>
<main>
<p class="note">All costs are <b>estimates</b>, not billed amounts. LLM cost uses the price table in gateway.json; warehouse cost uses the optimizer's estimate.</p>
<div class="cards">${card("Requests", t.requests)}${card("Tokens", t.tokens.toLocaleString("en-US"))}${card("LLM (est.)", usd(t.llmUsd))}${card("Warehouse (est.)", usd(t.warehouseUsd))}${card("Total (est.)", usd(t.totalUsd), "total")}${card("Blocked / held", `${t.blocked} / ${t.needsApproval}`)}</div>
<p class="muted">${t.ok} ok, ${t.blocked} blocked, ${t.needsApproval} held for approval, ${t.rejected} rejected keys, ${t.errors} errors.</p>
${r.unpricedModels.length ? `<p class="note">No price is configured for: ${esc(r.unpricedModels.join(", "))}. Their token cost is missing from the totals.</p>` : ""}
${htmlTable("By team", r.byTeam, "Team")}${htmlTable("By tool", r.byTool, "Tool")}${htmlTable("By user", r.byUser, "User")}${htmlTable("By model", r.byModel, "Model")}
<h2>Most expensive questions (estimates)</h2>${top ? `<div class="scroll"><table><thead><tr><th>When</th><th>Who</th><th>Tool</th><th class="q">Question or SQL</th><th>Total (est.)</th></tr></thead><tbody>${top}</tbody></table></div>` : '<p class="muted">None with a cost above zero.</p>'}
<h2>Cache savings</h2><p class="muted">Not available yet (the result cache is feature 3).</p>
</main></body></html>`;
}
