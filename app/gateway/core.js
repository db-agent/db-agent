// gateway/core.js: the five MCP tools, independent of transport.
//
// Every call goes through the same steps as the web UI (it calls the same pipeline): identify the
// caller, apply the table policy, SELECT-only safety, cost estimate, approval, execute, and every
// outcome is written to the request log. Transports (stdio, HTTP) only decide who the caller is.

import os from "node:os";
import { allowedTables, authenticate } from "./config.js";
import { makeGuard } from "./tablePolicy.js";
import { validateSql } from "../sqlSafety.js";

const bigintSafe = (_k, v) => (typeof v === "bigint" ? v.toString() : v);

// The reason strings from the web pipeline and from policy checks: drop a leading "Blocked: " so
// the message below does not say it twice.
const plainReason = (r) => String(r || "").replace(/^Blocked:\s*/i, "");

function costSummary(analysis) {
  if (!analysis || analysis.error) return analysis?.error ? { unavailable: analysis.error } : null;
  return {
    estimatedBytes: analysis.sizeInBytes ?? null,
    estimatedSize: analysis.sizeLabel ?? null,
    estimatedRows: analysis.rowCount ?? null,
    estimatedUsd: analysis.cost && !analysis.cost.error ? (analysis.cost.usdHigh ?? analysis.cost.usd ?? null) : null,
    warnings: (analysis.warnings || []).map((w) => w.code),
  };
}

export function createGateway({ config, store, pipeline, approvalTtlMinutes = 60 }) {
  const result = (isError, text, log = {}) => ({ isError, text, log });

  async function visibleTables(caller) {
    const schema = await pipeline.getSchema();
    const all = Object.keys(schema);
    const allowed = new Set(allowedTables(config, caller, all).map((t) => t.toLowerCase()));
    return { schema, all, allowed: (t) => allowed.has(String(t).toLowerCase()) };
  }

  function formatRows(out, extra = {}) {
    const rows = out.rows || [];
    const shown = rows.slice(0, config.maxRows);
    const body = {
      sql: out.sql,
      explanation: out.explanation || undefined,
      rowCount: rows.length,
      truncated: rows.length > shown.length ? `showing first ${shown.length}` : undefined,
      columns: out.columns,
      rows: shown,
      cost: costSummary(out.analysis),
      ...extra,
    };
    return `Query returned ${rows.length} row(s).\n` + JSON.stringify(body, bigintSafe, 2);
  }

  // Runs one SQL string or one question through the pipeline and turns the outcome into a tool result.
  async function runGuarded(caller, mcpTool, { question, sql }) {
    const { all, allowed } = await visibleTables(caller);
    const guardSql = makeGuard(all.filter((t) => !allowed(t)));
    const out = await pipeline.runPipeline(question || `! ${sql}`, {
      rawSql: sql || null,
      allowTable: allowed,
      guardSql,
    });
    const est = { estBytes: out.analysis?.sizeInBytes, estRows: out.analysis?.rowCount };

    if (out.validation && out.validation.isSafe === false) {
      const reason = plainReason(out.validation.reason);
      return result(true, `Blocked: ${reason}`, { status: "blocked", reason, sql: out.sql });
    }
    if (out.error) return result(true, `Error: ${out.error}`, { status: "error", reason: out.error, sql: out.sql });
    if (out.status === "awaiting_approval") {
      const approvalId = store.createApproval({
        caller, mcpTool, question, sql: out.sql, reason: out.approvalReason, ttlMinutes: approvalTtlMinutes,
      });
      return result(
        false,
        `Needs approval: ${out.approvalReason} Approval id: ${approvalId}. An approver runs "db-agent approve ${approvalId}", ` +
          `then call ${mcpTool} again with approval_id "${approvalId}". SQL held: ${out.sql}`,
        { status: "needs_approval", reason: out.approvalReason, sql: out.sql, approvalId, ...est }
      );
    }
    if (!out.rows) return result(true, "Error: the query returned no result.", { status: "error", sql: out.sql });
    return result(false, formatRows(out), { status: "ok", sql: out.sql, rowsReturned: out.rows.length, ...est });
  }

  // Retry with an approval id: run the SQL that was held, exactly as stored.
  async function runApproved(caller, mcpTool, { approvalId, sql }) {
    const a = store.getApproval(approvalId);
    const deny = (reason) => result(true, `Not approved: ${reason}`, { status: "blocked", reason, approvalId });
    if (!a) return deny("unknown approval id.");
    if (a.user !== caller.user || a.tool !== caller.tool) return deny("this approval was issued to a different caller.");
    if (a.mcp_tool !== mcpTool) return deny(`this approval was issued for ${a.mcp_tool}, not ${mcpTool}.`);
    if (sql && sql.trim().replace(/;+\s*$/, "") !== a.sql.trim()) return deny("the SQL differs from the SQL that was held.");
    const expired = a.expires_at <= new Date().toISOString();
    if (expired && !a.consumed_at) return deny("this approval expired. Ask again for a new one.");
    if (a.status === "pending") {
      return result(false, `Still waiting for approval ${approvalId}. An approver runs "db-agent approve ${approvalId}".`, {
        status: "needs_approval", reason: "still pending", sql: a.sql, approvalId,
      });
    }
    if (a.status === "denied") return deny(`denied by ${a.decided_by}.`);
    if (a.consumed_at) return deny("this approval was already used. Ask again for a new one.");

    // Policy may have changed since the SQL was held, and the safety check is cheap: run both again.
    const safety = validateSql(a.sql);
    if (!safety.isSafe) return result(true, `Blocked: ${plainReason(safety.reason)}`, { status: "blocked", reason: safety.reason, sql: a.sql, approvalId });
    const { all, allowed } = await visibleTables(caller);
    const blocked = makeGuard(all.filter((t) => !allowed(t)))(a.sql);
    if (blocked) return result(true, blocked, { status: "blocked", reason: plainReason(blocked), sql: a.sql, approvalId });

    if (!store.consumeApproval(approvalId)) return deny("this approval was just used by another request.");
    const out = await pipeline.executeApprovedSql(a.sql);
    if (out.error || !out.rows) {
      return result(true, `Error: ${out.error || "no result"}`, { status: "error", reason: out.error, sql: a.sql, approvalId });
    }
    return result(false, formatRows(out, { approvedBy: a.decided_by }), {
      status: "ok", sql: a.sql, approvalId, rowsReturned: out.rows.length,
    });
  }

  const tools = {
    async list_tables(caller) {
      const { all, allowed } = await visibleTables(caller);
      const tables = all.filter(allowed);
      return result(false, JSON.stringify({ tables }, null, 2), { status: "ok", rowsReturned: tables.length });
    },

    async describe_table(caller, { table }) {
      const { schema, all, allowed } = await visibleTables(caller);
      const name = all.find((t) => t.toLowerCase() === String(table || "").toLowerCase());
      // Same message for "missing" and "hidden", so a hidden table's existence is not confirmed.
      if (!name || !allowed(name)) {
        return result(true, `Unknown table "${table}". Use list_tables to see what is available.`, { status: "blocked", reason: "unknown or hidden table" });
      }
      const knowledge = pipeline.getKnowledge();
      const descriptions = knowledge?.descriptions || {};
      const prefix = `${name.toLowerCase()}.`;
      const described = (col) => {
        for (const [k, v] of Object.entries(descriptions)) if (k.toLowerCase() === prefix + col.toLowerCase()) return v;
        return undefined;
      };
      const tableNote = Object.entries(descriptions).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
      const columns = schema[name].map((c) => ({ ...c, description: described(c.name) }));
      return result(false, JSON.stringify({ table: name, description: tableNote, columns }, bigintSafe, 2), {
        status: "ok", rowsReturned: columns.length,
      });
    },

    async ask(caller, { question, approval_id }) {
      if (approval_id) return runApproved(caller, "ask", { approvalId: approval_id });
      if (!question || !String(question).trim()) return result(true, "Error: question is required.", { status: "error", reason: "question is required" });
      const r = await runGuarded(caller, "ask", { question: String(question).trim() });
      r.log.question = String(question).trim();
      return r;
    },

    async run_sql(caller, { sql, approval_id }) {
      if (approval_id) return runApproved(caller, "run_sql", { approvalId: approval_id, sql });
      if (!sql || !String(sql).trim()) return result(true, "Error: sql is required.", { status: "error", reason: "sql is required" });
      return runGuarded(caller, "run_sql", { sql: String(sql).trim() });
    },

    async explain_cost(caller, { sql }) {
      const text = String(sql || "").trim();
      const safety = validateSql(text);
      if (!safety.isSafe) return result(true, `Blocked: ${plainReason(safety.reason)}`, { status: "blocked", reason: safety.reason, sql: text });
      const { all, allowed } = await visibleTables(caller);
      const blocked = makeGuard(all.filter((t) => !allowed(t)))(text);
      if (blocked) return result(true, blocked, { status: "blocked", reason: plainReason(blocked), sql: text });
      let analysis;
      try {
        analysis = await pipeline.analyzeQuery(text.replace(/;+\s*$/, ""));
      } catch (exc) {
        return result(true, `Error: could not estimate this query: ${exc.message}`, { status: "error", reason: exc.message, sql: text });
      }
      if (!analysis) {
        return result(false, "This database engine cannot estimate cost before running. No estimate available.", { status: "ok", sql: text });
      }
      const reason = pipeline.approvalReason(analysis);
      const body = { sql: text, cost: costSummary(analysis), wouldNeedApproval: Boolean(reason), reason: reason || undefined };
      return result(false, JSON.stringify(body, bigintSafe, 2), {
        status: "ok", sql: text, estBytes: analysis.sizeInBytes, estRows: analysis.rowCount,
      });
    },
  };

  return {
    config,
    // Returns the caller, or null after logging the rejection (the key itself is never logged).
    authenticate(presentedKey, channel = "mcp") {
      const caller = authenticate(config, presentedKey);
      if (!caller) store.logRequest({ channel, status: "rejected_auth", reason: "unknown or missing API key" });
      return caller;
    },
    async call(caller, name, args = {}) {
      const handler = tools[name];
      if (!handler) return result(true, `Unknown tool ${name}.`, { status: "error", reason: "unknown tool" });
      const started = Date.now();
      let out;
      try {
        out = await handler(caller, args);
      } catch (exc) {
        out = result(true, `Error: ${exc.message}`, { status: "error", reason: exc.message });
      }
      store.logRequest({
        channel: "mcp", user: caller.user, team: caller.team, tool: caller.tool, mcpTool: name,
        durationMs: Date.now() - started, ...out.log,
      });
      return { isError: out.isError, text: out.text };
    },
    approverName: () => os.userInfo().username,
  };
}
