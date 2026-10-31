import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { openStore } from "../gateway/store.js";
import { tablesTouched, redactSql, exportAudit, renderAuditCsv, renderJsonl, parseWhen, purgeOlderThan, retentionDays, AUDIT_FIELDS } from "../gateway/audit.js";

function seed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
  const store = openStore(path.join(dir, "g.db"));
  const alice = { user: "alice", team: "analytics", tool: "claude-desktop" };
  const bob = { user: "bob", team: "finance", tool: "vscode" };
  store.logRequest({ ...alice, mcpTool: "run_sql", sql: "SELECT * FROM public.orders o JOIN customers c ON c.id = o.cid WHERE c.email = 'a@b.com'", status: "ok", rowsReturned: 3 });
  store.logRequest({ ...bob, mcpTool: "run_sql", sql: "DELETE FROM orders", status: "blocked", reason: "Only SELECT" });
  const id = store.createApproval({ caller: bob, mcpTool: "run_sql", sql: "SELECT * FROM big", reason: "too big", ttlMinutes: 60 });
  store.logRequest({ ...bob, mcpTool: "run_sql", sql: "SELECT * FROM big", status: "needs_approval", approvalId: id });
  store.decideApproval(id, "approved", "boss");
  store.logRequest({ ...bob, mcpTool: "run_sql", sql: "SELECT * FROM big", status: "ok", approvalId: id, rowsReturned: 9 });
  return { store, id };
}

test("tablesTouched reads FROM and JOIN names, ignores strings and comments", () => {
  assert.deepEqual(tablesTouched("SELECT * FROM public.orders o JOIN \"x\".customers c ON 1=1"), ["orders", "customers"]);
  assert.deepEqual(tablesTouched("SELECT 'from secrets' AS a /* join hidden */ FROM t -- from nope\n"), ["t"]);
  assert.deepEqual(tablesTouched("DELETE FROM orders; DROP TABLE order_items; UPDATE x SET a = 1"), ["orders", "order_items", "x"]);
  assert.deepEqual(tablesTouched(null), []);
});

test("redactSql removes literal values", () => {
  assert.equal(redactSql("SELECT * FROM t WHERE email = 'a@b.com' AND n > 42"), "SELECT * FROM t WHERE email = '?' AND n > ?");
});

test("export matches the stored records and carries the approver", () => {
  const { store, id } = seed();
  const all = exportAudit(store);
  assert.equal(all.length, store.listRequests({ limit: 100 }).length);
  const ran = all.find((r) => r.approval_id === id && r.decision === "ok");
  assert.equal(ran.approved_by, "boss");
  assert.ok(ran.approved_at);
  assert.deepEqual(all[0].tables, ["orders", "customers"]);
  assert.equal(all[0].rows_returned, 3);
  store.close();
});

test("filters: user, team, tool, decision, table, dates", () => {
  const { store } = seed();
  assert.equal(exportAudit(store, { user: "alice" }).length, 1);
  assert.equal(exportAudit(store, { team: "finance" }).length, 3);
  assert.equal(exportAudit(store, { tool: "vscode", decision: "blocked" }).length, 1);
  assert.equal(exportAudit(store, { table: "CUSTOMERS" }).length, 1);
  assert.equal(exportAudit(store, { table: "orders" }).length, 2);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(exportAudit(store, { from: today, to: today }).length, 4, "date-only --to covers the whole day");
  assert.equal(exportAudit(store, { to: "2000-01-01" }).length, 0);
  assert.throws(() => parseWhen("yesterday"), /not a date/);
  store.close();
});

test("csv escapes formulas and quotes; jsonl is one object per line; redact hides values and question", () => {
  const { store } = seed();
  store.logRequest({ user: "=cmd", tool: "t", question: "who, \"me\"?", sql: "SELECT 1", status: "ok" });
  const records = exportAudit(store);
  const csv = renderAuditCsv(records);
  assert.equal(csv.split("\n")[0], AUDIT_FIELDS.join(","));
  assert.match(csv, /'=cmd/);
  assert.match(csv, /"who, ""me""\?"/);
  const lines = renderJsonl(records).trim().split("\n");
  assert.equal(lines.length, records.length);
  assert.equal(JSON.parse(lines[0]).user, "alice");
  const red = exportAudit(store, { redact: true });
  assert.ok(red.every((r) => r.question === null));
  assert.ok(!JSON.stringify(red).includes("a@b.com"));
  store.close();
});

test("purge removes old records, keeps recent ones and pending approvals", () => {
  const { store } = seed();
  const pending = store.createApproval({ caller: { user: "x", tool: "t" }, mcpTool: "run_sql", sql: "SELECT 2", ttlMinutes: 60 * 24 * 30 });
  const future = Date.now() + 10 * 86_400_000;
  const r = purgeOlderThan(store, 7, future); // 10 days from now: everything is 10 days old
  assert.equal(r.requests, 4);
  assert.equal(r.approvals, 1, "the decided approval goes; the pending one that has not expired stays");
  assert.equal(exportAudit(store).length, 0);
  assert.equal(store.getApproval(pending).status, "pending");
  const fresh = seed();
  assert.deepEqual(purgeOlderThan(fresh.store, 7), { requests: 0, approvals: 0 });
  assert.equal(exportAudit(fresh.store).length, 4);
  store.close(); fresh.store.close();
});

test("retentionDays: env wins, then config, default keeps everything", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ret-"));
  const f = path.join(dir, "gateway.json");
  fs.writeFileSync(f, JSON.stringify({ retention: { days: 90 } }));
  assert.equal(retentionDays(f, {}), 90);
  assert.equal(retentionDays(f, { AUDIT_RETENTION_DAYS: "30" }), 30);
  assert.equal(retentionDays(f, { AUDIT_RETENTION_DAYS: "0" }), 0);
  assert.equal(retentionDays(path.join(dir, "missing.json"), {}), 0);
});
