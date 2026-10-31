// gateway/core.js: the five MCP tools, independent of transport.
//
// Every call goes through the same steps as the web UI (it calls the same pipeline): identify the
// caller, apply the table policy, SELECT-only safety, cost estimate, approval, execute, and every
// outcome is written to the request log. Transports (stdio, HTTP) only decide who the caller is.

import os from "node:os";
import { allowedTables, authenticate } from "./config.js";
import { makeGuard } from "./tablePolicy.js";
import { validateSql } from "../sqlSafety.js";
import { estimateCosts, evaluateBudgets } from "./costs.js";

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

const METRIC_LABEL = { tokens: "tokens", llm_usd: "USD of LLM cost (estimate)", warehouse_usd: "USD of warehouse cost (estimate)" };
const fmtAmount = (metric, n) => (metric === "tokens" ? String(Math.round(n)) : n.toFixed(4));
const ACTION_RANK = { warn: 1, approval: 2, block: 3 };

export function createGateway({ config, store, pipeline, approvalTtlMinutes = 60 }) {
  const result = (isError, text, log = {}) => ({ isError, text, log });
  const engineType = () => pipeline.describeEngine?.().type;

  // Budgets are checked against what was already logged: the request that crosses a limit completes,
  // the next one gets the configured action. Day and month are UTC.
  function checkBudgets(caller, mcpTool) {
    const rows = evaluateBudgets({
      budgets: config.budgets || [], caller, mcpTool,
      spentFor: (q) => store.spent(q),
    });
    const hit = rows.filter((b) => b.exceeded).sort((a, b) => ACTION_RANK[b.action] - ACTION_RANK[a.action]);
    const describe = (b) =>
      `${b.scope} "${b.value}" has used ${fmtAmount(b.metric, b.spent)} of ${fmtAmount(b.metric, b.limit)} ${METRIC_LABEL[b.metric]} this ${b.period} (UTC).`;
    return { rows, action: hit[0]?.action || null, message: hit[0] ? describe(hit[0]) : null, warnings: hit.filter((b) => b.action === "warn").map(describe) };
  }

  // What this answer cost (estimates) and what is left of each budget after it.
  function usageBlock(out, costs, budgetRows) {
    const tokens = (out.usage?.inputTokens || 0) + (out.usage?.outputTokens || 0);
    const spentNow = { tokens, llm_usd: costs.llmUsd || 0, warehouse_usd: costs.warehouseUsd || 0 };
    return {
      note: "All costs are estimates, not billed amounts.",
      tokens,
      model: out.usage?.calls ? out.usage.model : undefined,
      tokensReported: out.usage?.missing ? false : undefined,
      llmUsdEstimate: costs.llmUsd,
      warehouseUsdEstimate: costs.warehouseUsd,
      budgets: budgetRows.length
        ? budgetRows.map((b) => ({
            budget: `${b.scope}:${b.value} ${b.metric}/${b.period}`,
            limit: b.limit,
            remaining: Math.max(0, Math.round((b.limit - b.spent - spentNow[b.metric]) * 1e6) / 1e6),
            action: b.action,
          }))
        : undefined,
    };
  }

  async function visibleTables(caller) {
    const schema = await pipeline.getSchema();
    const all = Object.keys(schema);
    const allowed = new Set(allowedTables(config, caller, all).map((t) => t.toLowerCase()));
    return { schema, all, allowed: (t) => allowed.has(String(t).toLowerCase()) };
  }

  function formatRows(out, extra = {}, usage = null) {
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
      usage: usage || undefined,
      ...extra,
    };
    return `Query returned ${rows.length} row(s).\n` + JSON.stringify(body, bigintSafe, 2);
  }

  // Runs one SQL string or one question through the pipeline and turns the outcome into a tool result.
  // skipBudget: this request was already approved past a budget, so only the budget check is skipped.
  async function runGuarded(caller, mcpTool, { question, sql, skipBudget = false, approvalId = null }) {
    const budget = skipBudget ? { rows: [], action: null, warnings: [] } : checkBudgets(caller, mcpTool);
    if (budget.action === "block") {
      return result(true, `Blocked: budget reached. ${budget.message}`, { status: "blocked", reason: budget.message, sql });
    }
    if (budget.action === "approval") {
      const id = store.createApproval({ caller, mcpTool, question, sql: sql || "", reason: budget.message, ttlMinutes: approvalTtlMinutes, kind: "budget" });
      return result(
        false,
        `Needs approval: budget reached. ${budget.message} Approval id: ${id}. An approver runs "db-agent approve ${id}", ` +
          `then call ${mcpTool} again with approval_id "${id}".`,
        { status: "needs_approval", reason: budget.message, sql, approvalId: id }
      );
    }

    const { all, allowed } = await visibleTables(caller);
    const guardSql = makeGuard(all.filter((t) => !allowed(t)));
    const out = await pipeline.runPipeline(question || `! ${sql}`, {
      rawSql: sql || null,
      allowTable: allowed,
      guardSql,
    });
    const est = { estBytes: out.analysis?.sizeInBytes, estRows: out.analysis?.rowCount };
    const costs = estimateCosts({ usage: out.usage, analysis: out.analysis, engineType: engineType(), pricing: config.pricing });
    // Tokens are spent whatever happens next; warehouse cost only counts once the query has run.
    const spend = (ran) => ({
      model: out.usage?.calls ? out.usage.model : undefined,
      inputTokens: out.usage?.inputTokens, outputTokens: out.usage?.outputTokens,
      llmUsd: costs.llmUsd, warehouseUsd: ran ? costs.warehouseUsd : 0,
      approvalId: approvalId || undefined,
    });
    const warn = budget.warnings.length ? `Budget warning: ${budget.warnings.join(" ")}\n` : "";

    if (out.validation && out.validation.isSafe === false) {
      const reason = plainReason(out.validation.reason);
      return result(true, `Blocked: ${reason}`, { status: "blocked", reason, sql: out.sql, ...spend(false) });
    }
    if (out.error) return result(true, `Error: ${out.error}`, { status: "error", reason: out.error, sql: out.sql, ...spend(false) });
    if (out.status === "awaiting_approval") {
      const id = store.createApproval({
        caller, mcpTool, question, sql: out.sql, reason: out.approvalReason, ttlMinutes: approvalTtlMinutes,
        warehouseUsd: costs.warehouseUsd,
      });
      return result(
        false,
        `${warn}Needs approval: ${out.approvalReason} Approval id: ${id}. An approver runs "db-agent approve ${id}", ` +
          `then call ${mcpTool} again with approval_id "${id}". SQL held: ${out.sql}`,
        { status: "needs_approval", reason: out.approvalReason, sql: out.sql, ...est, ...spend(false), approvalId: id }
      );
    }
    if (!out.rows) return result(true, "Error: the query returned no result.", { status: "error", sql: out.sql, ...spend(false) });
    return result(false, warn + formatRows(out, {}, usageBlock(out, costs, budget.rows)), {
      status: "ok", sql: out.sql, rowsReturned: out.rows.length, ...est, ...spend(true),
    });
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

    // Approved past a budget: run it through the normal pipeline (safety, table policy and cost guard
    // still apply) with only the budget check skipped. An ask holds the question, not SQL.
    if (a.kind === "budget") {
      if (!store.consumeApproval(approvalId)) return deny("this approval was just used by another request.");
      const r = await runGuarded(caller, mcpTool, { question: a.question || undefined, sql: a.sql || undefined, skipBudget: true, approvalId });
      if (a.question) r.log.question = a.question;
      return r;
    }

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
    const costs = { llmUsd: 0, warehouseUsd: a.warehouse_usd };
    return result(false, formatRows(out, { approvedBy: a.decided_by }, usageBlock(out, costs, [])), {
      status: "ok", sql: a.sql, approvalId, rowsReturned: out.rows.length, warehouseUsd: a.warehouse_usd,
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
