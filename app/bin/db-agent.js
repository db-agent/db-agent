#!/usr/bin/env node
// db-agent CLI.
//
//   db-agent mcp serve [--stdio | --http] [--port 3002] [--host 127.0.0.1]
//   db-agent mcp setup [--client claude-desktop,vscode,claude-code] [--workspace] [--dry-run] [--no-check]
//   db-agent report [--period day|week|month] [--out DIR] [--no-write]
//   db-agent scan [--out DIR] [--no-write]        readiness score and a draft knowledge file (metadata only)
//   db-agent knowledge export [--format skill|json] [--out FILE]   the shared knowledge file as a SKILL.md or JSON
//   db-agent approvals [--all]       list held queries waiting for a decision
//   db-agent approve <id>            let the caller run the held query once
//   db-agent deny <id>
//   db-agent log [--limit 50]        recent gateway requests, newest first
//   db-agent audit export [--from D] [--to D] [--format csv|jsonl] [--user U] [--team T] [--tool X]
//                         [--table NAME] [--decision ok|blocked|needs_approval|error|rejected_auth]
//                         [--redact] [--out FILE]
//   db-agent audit purge [--days N] [--dry-run]    delete records older than N days (default: retention setting)
//
// Config: GATEWAY_CONFIG (default app/gateway.json). Shared store: GATEWAY_DB (default app/data/gateway.db).
// For stdio the caller's key is DB_AGENT_API_KEY; for HTTP it is the Authorization: Bearer header.

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(appDir, ".env") });

const configPath = process.env.GATEWAY_CONFIG || path.join(appDir, "gateway.json");
const dbPath = process.env.GATEWAY_DB || path.join(appDir, "data", "gateway.db");
const approvalTtlMinutes = Number(process.env.APPROVAL_TTL_MINUTES) || 60;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

function usage() {
  console.error(
    "Usage:\n" +
      "  db-agent mcp serve [--stdio | --http] [--port 3002] [--host 127.0.0.1]\n" +
      "  db-agent mcp setup [--client claude-desktop,vscode,claude-code] [--workspace] [--dry-run] [--no-check]\n" +
      "  db-agent report [--period day|week|month] [--out DIR] [--no-write]\n" +
      "  db-agent scan [--out DIR] [--no-write]\n" +
      "  db-agent knowledge export [--format skill|json] [--out FILE]\n" +
      "  db-agent approvals [--all]\n" +
      "  db-agent approve <id>\n" +
      "  db-agent deny <id>\n" +
      "  db-agent log [--limit 50]\n" +
      "  db-agent audit export [--from D] [--to D] [--format csv|jsonl] [--user U] [--team T] [--tool X] [--table NAME] [--decision S] [--redact] [--out FILE]\n" +
      "  db-agent audit purge [--days N] [--dry-run]"
  );
  process.exit(2);
}

function table(rows, columns) {
  if (rows.length === 0) return "(none)";
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (cells) => cells.map((v, i) => String(v ?? "").padEnd(widths[i])).join("  ");
  return [line(columns), ...rows.map((r) => line(columns.map((c) => r[c])))].join("\n");
}

async function main() {
  const [cmd, sub] = args;

  if (cmd === "report") {
    const { openStore } = await import("../gateway/store.js");
    const { buildReport, renderMarkdown, renderCsv, REPORT_PERIODS } = await import("../gateway/report.js");
    const period = option("period", "week");
    if (!REPORT_PERIODS[period]) fail(`--period must be one of ${Object.keys(REPORT_PERIODS).join(", ")}`);
    const store = openStore(dbPath);
    try {
      const report = buildReport(store, { period });
      const md = renderMarkdown(report);
      console.log(md);
      if (!flag("no-write")) {
        const fs = await import("node:fs");
        const dir = path.resolve(option("out", "db-agent-reports"));
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(path.join(dir, `report-${period}-${stamp}.md`), md + "\n");
        fs.writeFileSync(path.join(dir, `report-${period}-${stamp}.csv`), renderCsv(report));
        console.error(`\nWrote ${dir}/report-${period}-${stamp}.md and .csv`);
      }
    } finally {
      store.close();
    }
    return;
  }

  if (cmd === "audit") {
    if (sub !== "export" && sub !== "purge") usage();
    const { openStore } = await import("../gateway/store.js");
    const audit = await import("../gateway/audit.js");
    const store = openStore(dbPath);
    try {
      if (sub === "export") {
        const format = option("format", "csv");
        if (format !== "csv" && format !== "jsonl") fail("--format must be csv or jsonl");
        let records;
        try {
          records = audit.exportAudit(store, {
            from: option("from"), to: option("to"), user: option("user"), team: option("team"), tool: option("tool"),
            table: option("table"), decision: option("decision"), redact: flag("redact"),
          });
        } catch (exc) {
          fail(exc.message);
        }
        const text = format === "csv" ? audit.renderAuditCsv(records) : audit.renderJsonl(records);
        const outFile = option("out");
        if (outFile) {
          (await import("node:fs")).writeFileSync(outFile, text);
          console.error(`Wrote ${records.length} record(s) to ${outFile}`);
        } else {
          process.stdout.write(text);
          console.error(`${records.length} record(s)`);
        }
      } else {
        const days = option("days") !== undefined ? Number(option("days")) : audit.retentionDays(configPath);
        if (!(days > 0)) fail("No retention set. Pass --days N, set AUDIT_RETENTION_DAYS, or add {\"retention\": {\"days\": N}} to the gateway config.");
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
        if (flag("dry-run")) {
          const n = store.auditRows({ to: cutoff }).length;
          console.log(`Would remove ${n} request(s) older than ${days} day(s) (before ${cutoff}).`);
        } else {
          const r = audit.purgeOlderThan(store, days);
          console.log(`Removed ${r.requests} request(s) and ${r.approvals} approval(s) older than ${days} day(s).`);
        }
      }
    } finally {
      store.close();
    }
    return;
  }

  if (cmd === "scan") {
    const [{ scanMetadata, renderScanMarkdown }, { pipeline }] = await Promise.all([import("../ontology/scan.js"), import("../server.js")]);
    const info = pipeline.describeEngine();
    const scan = scanMetadata(await pipeline.readMetadata(), { schemaName: info.location });
    const md = renderScanMarkdown(scan);
    console.log(md);
    if (!flag("no-write")) {
      const fs = await import("node:fs");
      const dir = path.resolve(option("out", "db-agent-scan"));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "scan-report.md"), md + "\n");
      fs.writeFileSync(path.join(dir, "knowledge.draft.json"), JSON.stringify(scan.draft, null, 2) + "\n");
      console.error(`\nWrote ${dir}/scan-report.md and knowledge.draft.json`);
      console.error("Review the draft, then copy it to knowledge.json (or open Ontology in the web app and save it from there).");
    }
    return;
  }

  if (cmd === "knowledge") {
    if (sub !== "export") usage();
    const [{ renderSkill }, { pipeline }] = await Promise.all([import("../ontology/knowledgeFile.js"), import("../server.js")]);
    const knowledge = pipeline.getKnowledge() || { descriptions: {}, expressions: {}, examples: [], instructions: [] };
    const format = option("format", "skill");
    if (format !== "skill" && format !== "json") fail("--format must be skill or json");
    const engine = pipeline.describeEngine().type;
    const text = format === "skill" ? renderSkill(knowledge, { name: `${engine}-data-guide`, engine }) : JSON.stringify(knowledge, null, 2) + "\n";
    const outFile = option("out");
    if (outFile) {
      (await import("node:fs")).writeFileSync(outFile, text);
      console.error(`Wrote ${outFile}`);
    } else {
      process.stdout.write(text);
    }
    return;
  }

  if (cmd === "approvals" || cmd === "approve" || cmd === "deny" || cmd === "log") {
    const { openStore } = await import("../gateway/store.js");
    const store = openStore(dbPath);
    try {
      if (cmd === "approvals") {
        const rows = store.listApprovals({ all: flag("all") }).map((a) => ({
          id: a.id, status: a.status, user: a.user, tool: a.tool, via: a.mcp_tool, expires: a.expires_at, reason: a.reason,
          sql: a.sql.replace(/\s+/g, " ").slice(0, 60),
        }));
        console.log(table(rows, ["id", "status", "user", "tool", "via", "expires", "reason", "sql"]));
      } else if (cmd === "log") {
        const rows = store.listRequests({ limit: Number(option("limit", 50)) }).map((r) => ({
          ts: r.ts, user: r.user, tool: r.tool, via: r.mcp_tool, status: r.status, rows: r.rows_returned, ms: r.duration_ms,
          detail: (r.reason || r.sql || r.question || "").replace(/\s+/g, " ").slice(0, 70),
        }));
        console.log(table(rows, ["ts", "user", "tool", "via", "status", "rows", "ms", "detail"]));
      } else {
        const id = sub;
        if (!id) usage();
        const a = store.getApproval(id);
        if (!a) fail(`No approval ${id}.`);
        if (a.status !== "pending") fail(`Approval ${id} is already ${a.status}.`);
        console.log(`Caller:  ${a.user} via ${a.tool} (${a.mcp_tool})`);
        if (a.question) console.log(`Question: ${a.question}`);
        console.log(`Reason held: ${a.reason}`);
        console.log(`SQL: ${a.sql}`);
        const decided = store.decideApproval(id, cmd === "approve" ? "approved" : "denied", os.userInfo().username);
        if (!decided) fail(`Approval ${id} expired or was decided by someone else.`);
        console.log(cmd === "approve" ? `\nApproved ${id}. The caller can retry once.` : `\nDenied ${id}.`);
      }
    } finally {
      store.close();
    }
    return;
  }

  if (cmd === "mcp" && sub === "setup") {
    const { runSetup, verifyConnection, CLIENTS } = await import("../gateway/setup.js");
    const clients = option("client", CLIENTS.join(",")).split(",").map((c) => c.trim()).filter(Boolean);
    const unknown = clients.filter((c) => !CLIENTS.includes(c));
    if (unknown.length) fail(`Unknown client: ${unknown.join(", ")}. Choose from ${CLIENTS.join(", ")}.`);
    const binPath = path.join(appDir, "bin", "db-agent.js");
    const { results, ok, dryRun } = await runSetup({
      appDir, clients, workspace: flag("workspace"), dryRun: flag("dry-run"), check: !flag("no-check"),
      verify: (key) => verifyConnection({ binPath, key }),
    });
    for (const r of results) {
      const mark = { ok: "ok     ", skipped: "skipped", failed: "FAILED " }[r.status];
      console.log(`${mark} ${r.client.padEnd(15)} ${r.detail}`);
      if (r.check) console.log(`        ${"".padEnd(15)} connection check: ${r.check.ok ? "passed, " : "FAILED, "}${r.check.detail}`);
    }
    if (!dryRun && results.some((r) => r.status === "ok" && r.client !== "gateway.json")) {
      console.log("\nNext: restart Claude Desktop / reload VS Code (Claude Code picks it up in new sessions), then ask:");
      console.log('  "Use db-agent to list the tables"');
      console.log("Each tool has its own key, so `db-agent log` shows which tool asked.");
    }
    if (!ok) process.exit(1);
    return;
  }

  if (cmd === "mcp" && sub === "serve") {
    const stdio = !flag("http");
    // stdout is the protocol channel in stdio mode: everything else must go to stderr.
    if (stdio) console.log = console.error;

    const [{ loadGatewayConfig }, { openStore }, { createGateway }, mcp, { pipeline }] = await Promise.all([
      import("../gateway/config.js"),
      import("../gateway/store.js"),
      import("../gateway/core.js"),
      import("../gateway/mcpServer.js"),
      import("../server.js"),
    ]);
    let config;
    try {
      config = loadGatewayConfig(configPath);
    } catch (exc) {
      fail(exc.message);
    }
    const store = openStore(dbPath);
    const { retentionDays, startRetention } = await import("../gateway/audit.js");
    startRetention(store, retentionDays(configPath), console.error);
    const gateway = createGateway({ config, store, pipeline, approvalTtlMinutes });

    if (stdio) {
      const caller = await mcp.serveStdio(gateway, process.env.DB_AGENT_API_KEY);
      if (!caller) fail("db-agent: DB_AGENT_API_KEY is missing or not a known key in the gateway config.");
      console.error(`db-agent MCP (stdio): ${caller.user} via ${caller.tool}, engine ${pipeline.describeEngine().type}`);
    } else {
      const host = option("host", process.env.MCP_HOST || "127.0.0.1");
      const port = Number(option("port", process.env.MCP_PORT || 3002));
      mcp.createHttpApp(gateway).listen(port, host, () => {
        console.log(`db-agent MCP (streamable HTTP) on http://${host}:${port}/mcp, engine ${pipeline.describeEngine().type}`);
        console.log("Send the caller's key as Authorization: Bearer <key>. Plain HTTP: put TLS in front of anything non-local.");
      });
    }
    return;
  }

  usage();
}

main().catch((exc) => fail(exc?.message || String(exc)));
