// gateway/store.js: the one request log and the approval queue, in a SQLite file shared by every
// process (the stdio MCP server Claude Desktop launches, the HTTP server, `db-agent approve`).
// Never stores API keys.

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function openStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      channel TEXT NOT NULL,
      user TEXT, team TEXT, tool TEXT,
      mcp_tool TEXT,
      question TEXT, sql TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      approval_id TEXT,
      est_bytes REAL, est_rows REAL,
      rows_returned INTEGER,
      duration_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL,
      user TEXT, team TEXT, tool TEXT,
      mcp_tool TEXT,
      question TEXT,
      sql TEXT NOT NULL,
      reason TEXT,
      decided_by TEXT, decided_at TEXT,
      consumed_at TEXT
    );
  `);

  // Older stores lack the cost columns: add them in place.
  const addColumn = (table, name, type) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  addColumn("requests", "model", "TEXT");
  addColumn("requests", "input_tokens", "INTEGER");
  addColumn("requests", "output_tokens", "INTEGER");
  addColumn("requests", "llm_usd", "REAL");        // NULL: tokens were used but no price is configured
  addColumn("requests", "warehouse_usd", "REAL");  // estimate; counted only when the query ran
  addColumn("approvals", "warehouse_usd", "REAL");
  addColumn("approvals", "kind", "TEXT"); // "budget" when held for a budget; otherwise a cost hold

  const SPENT_COLUMN = { tokens: "COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)", llm_usd: "COALESCE(llm_usd, 0)", warehouse_usd: "COALESCE(warehouse_usd, 0)" };
  const SCOPE_COLUMN = { user: "user", team: "team", tool: "tool" };

  const insertRequest = db.prepare(`
    INSERT INTO requests (ts, channel, user, team, tool, mcp_tool, question, sql, status, reason, approval_id,
                          est_bytes, est_rows, rows_returned, duration_ms,
                          model, input_tokens, output_tokens, llm_usd, warehouse_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertApproval = db.prepare(`
    INSERT INTO approvals (id, created_at, expires_at, status, user, team, tool, mcp_tool, question, sql, reason, warehouse_usd, kind)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  return {
    logRequest(r) {
      insertRequest.run(
        new Date().toISOString(), r.channel || "mcp", r.user ?? null, r.team ?? null, r.tool ?? null,
        r.mcpTool ?? null, r.question ?? null, r.sql ?? null, r.status, r.reason ?? null, r.approvalId ?? null,
        r.estBytes ?? null, r.estRows ?? null, r.rowsReturned ?? null, r.durationMs ?? null,
        r.model ?? null, r.inputTokens ?? null, r.outputTokens ?? null, r.llmUsd ?? null, r.warehouseUsd ?? null
      );
    },
    requestsSince(sinceIso) {
      return db.prepare("SELECT * FROM requests WHERE ts >= ? ORDER BY id").all(sinceIso);
    },
    // Sum of one metric for one user, team or tool since a time (what the budgets compare against).
    spent({ scope, value, metric, since }) {
      const row = db.prepare(`SELECT COALESCE(SUM(${SPENT_COLUMN[metric]}), 0) AS total FROM requests WHERE ${SCOPE_COLUMN[scope]} = ? AND ts >= ?`).get(value, since);
      return Number(row.total);
    },
    // Audit rows: each request with the approval it used or created (who decided, and when).
    auditRows({ from = null, to = null, user = null, team = null, tool = null, status = null } = {}) {
      const where = [], params = [];
      if (from) { where.push("r.ts >= ?"); params.push(from); }
      if (to) { where.push("r.ts < ?"); params.push(to); }
      for (const [col, v] of [["user", user], ["team", team], ["tool", tool], ["status", status]]) {
        if (v) { where.push(`r.${col} = ?`); params.push(v); }
      }
      return db.prepare(`
        SELECT r.*, a.status AS approval_status, a.created_at AS approval_created_at,
               a.decided_by AS approved_by, a.decided_at AS approved_at
        FROM requests r LEFT JOIN approvals a ON a.id = r.approval_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.id`).all(...params);
    },
    // Delete requests and finished approvals older than a time. A pending approval that has not
    // expired yet is kept. Returns what was removed.
    purgeBefore(iso) {
      db.exec("BEGIN");
      try {
        const requests = db.prepare("DELETE FROM requests WHERE ts < ?").run(iso).changes;
        const approvals = db.prepare("DELETE FROM approvals WHERE created_at < ? AND (status != 'pending' OR expires_at < ?)").run(iso, iso).changes;
        db.exec("COMMIT");
        return { requests: Number(requests), approvals: Number(approvals) };
      } catch (exc) {
        db.exec("ROLLBACK");
        throw exc;
      }
    },
    listRequests({ limit = 50 } = {}) {
      return db.prepare("SELECT * FROM requests ORDER BY id DESC LIMIT ?").all(limit);
    },

    createApproval({ caller, mcpTool, question, sql, reason, ttlMinutes, warehouseUsd = null, kind = null }) {
      const id = "apr_" + crypto.randomBytes(5).toString("hex");
      const now = Date.now();
      insertApproval.run(
        id, new Date(now).toISOString(), new Date(now + ttlMinutes * 60_000).toISOString(),
        caller.user, caller.team ?? null, caller.tool, mcpTool, question ?? null, sql, reason ?? null, warehouseUsd, kind
      );
      return id;
    },
    getApproval(id) {
      return db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) || null;
    },
    listApprovals({ all = false } = {}) {
      if (all) return db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100").all();
      return db.prepare(
        "SELECT * FROM approvals WHERE status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 100"
      ).all(new Date().toISOString());
    },
    // Only a pending, unexpired request can be decided; returns false otherwise.
    decideApproval(id, status, decidedBy) {
      const now = new Date().toISOString();
      const res = db.prepare(
        "UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?"
      ).run(status, decidedBy, now, id, now);
      return res.changes === 1;
    },
    // One use only: the first caller to consume an approved id wins.
    consumeApproval(id) {
      const now = new Date().toISOString();
      const res = db.prepare(
        "UPDATE approvals SET consumed_at = ? WHERE id = ? AND status = 'approved' AND consumed_at IS NULL AND expires_at > ?"
      ).run(now, id, now);
      return res.changes === 1;
    },
    close() { db.close(); },
  };
}
