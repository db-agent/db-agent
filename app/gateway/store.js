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

  const insertRequest = db.prepare(`
    INSERT INTO requests (ts, channel, user, team, tool, mcp_tool, question, sql, status, reason, approval_id,
                          est_bytes, est_rows, rows_returned, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertApproval = db.prepare(`
    INSERT INTO approvals (id, created_at, expires_at, status, user, team, tool, mcp_tool, question, sql, reason)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`);

  return {
    logRequest(r) {
      insertRequest.run(
        new Date().toISOString(), r.channel || "mcp", r.user ?? null, r.team ?? null, r.tool ?? null,
        r.mcpTool ?? null, r.question ?? null, r.sql ?? null, r.status, r.reason ?? null, r.approvalId ?? null,
        r.estBytes ?? null, r.estRows ?? null, r.rowsReturned ?? null, r.durationMs ?? null
      );
    },
    listRequests({ limit = 50 } = {}) {
      return db.prepare("SELECT * FROM requests ORDER BY id DESC LIMIT ?").all(limit);
    },

    createApproval({ caller, mcpTool, question, sql, reason, ttlMinutes }) {
      const id = "apr_" + crypto.randomBytes(5).toString("hex");
      const now = Date.now();
      insertApproval.run(
        id, new Date(now).toISOString(), new Date(now + ttlMinutes * 60_000).toISOString(),
        caller.user, caller.team ?? null, caller.tool, mcpTool, question ?? null, sql, reason ?? null
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
