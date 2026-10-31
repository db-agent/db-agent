// gateway/audit.js: audit trail export and retention.
//
// The audit trail is the request log (gateway/store.js) joined to the approvals queue, so each row
// says who asked what, which tables the SQL touched, the decision, and who approved it and when.
// Tables are read from the SQL text (names after FROM, JOIN, UPDATE, INTO and TABLE), so they are a good guide and not a
// parse; CTE names can show up as tables.

import fs from "node:fs";
import { csvCell } from "./report.js";

export const AUDIT_FIELDS = [
  "id", "ts", "channel", "user", "team", "tool", "mcp_tool", "decision", "reason", "question", "sql", "tables",
  "rows_returned", "duration_ms", "model", "input_tokens", "output_tokens", "llm_usd", "warehouse_usd",
  "approval_id", "approval_status", "approved_by", "approved_at",
];

const PART = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)';
const TABLE_REF = new RegExp(`\\b(?:from|join|update|into|table)\\s+(${PART}(?:\\s*\\.\\s*${PART}){0,2})`, "gi");

// Table names the SQL refers to (last part of a qualified name), lower case, in order of first use.
export function tablesTouched(sql) {
  if (!sql) return [];
  // Strings and comments are removed first so text inside them cannot pass as a table.
  const clean = stripLiteralsAndComments(sql);
  const found = [];
  for (const m of clean.matchAll(TABLE_REF)) {
    const name = m[1].split(".").pop().trim().replace(/^["`\[]|["`\]]$/g, "").toLowerCase();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

function stripLiteralsAndComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''"); // double quotes are identifiers in SQL, so they stay
}

// Values in SQL text can be personal data. Redaction replaces string and number literals.
export function redactSql(sql) {
  if (!sql) return sql;
  return stripLiteralsAndComments(sql).replace(/'(?:[^']|'')*'/g, "'?'").replace(/\b\d+(?:\.\d+)?\b/g, "?");
}

export function toRecord(row, { redact = false } = {}) {
  return {
    id: row.id, ts: row.ts, channel: row.channel, user: row.user, team: row.team, tool: row.tool, mcp_tool: row.mcp_tool,
    decision: row.status, reason: row.reason,
    question: redact ? null : row.question,
    sql: redact ? redactSql(row.sql) : row.sql,
    tables: tablesTouched(row.sql),
    rows_returned: row.rows_returned, duration_ms: row.duration_ms, model: row.model,
    input_tokens: row.input_tokens, output_tokens: row.output_tokens, llm_usd: row.llm_usd, warehouse_usd: row.warehouse_usd,
    approval_id: row.approval_id, approval_status: row.approval_status, approved_by: row.approved_by, approved_at: row.approved_at,
  };
}

// Accepts 2025-01-31 or a full ISO time; returns an ISO string or throws. A date-only --to includes that whole day.
export function parseWhen(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(d.getTime())) throw new Error(`"${value}" is not a date (use 2025-01-31 or 2025-01-31T09:00:00Z)`);
  if (dateOnly && endOfDay) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function exportAudit(store, { from, to, user, team, tool, decision, table, redact = false } = {}) {
  const rows = store.auditRows({ from: parseWhen(from), to: parseWhen(to, { endOfDay: true }), user, team, tool, status: decision });
  let records = rows.map((r) => toRecord(r, { redact }));
  if (table) {
    const want = String(table).toLowerCase();
    records = records.filter((r) => r.tables.includes(want));
  }
  return records;
}

export function renderJsonl(records) {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
}

export function renderAuditCsv(records) {
  const lines = [AUDIT_FIELDS.join(",")];
  for (const r of records) lines.push(AUDIT_FIELDS.map((f) => csvCell(Array.isArray(r[f]) ? r[f].join(";") : r[f])).join(","));
  return lines.join("\n") + "\n";
}

// Days to keep, from AUDIT_RETENTION_DAYS or "retention": {"days": N} in the gateway config. 0 or unset keeps everything.
export function retentionDays(configPath, env = process.env) {
  const fromEnv = Number(env.AUDIT_RETENTION_DAYS);
  if (env.AUDIT_RETENTION_DAYS !== undefined && env.AUDIT_RETENTION_DAYS !== "") return fromEnv > 0 ? fromEnv : 0;
  try {
    const n = Number(JSON.parse(fs.readFileSync(configPath, "utf8")).retention?.days);
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function purgeOlderThan(store, days, now = Date.now()) {
  return store.purgeBefore(new Date(now - days * 86_400_000).toISOString());
}

// Purge now and then every 6 hours for as long as the process runs.
export function startRetention(store, days, log = () => {}) {
  if (!(days > 0)) return null;
  const run = () => {
    try {
      const r = purgeOlderThan(store, days);
      if (r.requests || r.approvals) log(`[audit] retention ${days}d: removed ${r.requests} request(s), ${r.approvals} approval(s)`);
    } catch (exc) {
      log(`[audit] retention purge failed: ${exc.message}`);
    }
  };
  run();
  return setInterval(run, 6 * 3600_000).unref();
}
