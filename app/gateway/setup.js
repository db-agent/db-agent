// gateway/setup.js: `db-agent mcp setup`. One command that makes a key per AI tool, registers the
// key's hash in gateway.json, writes each tool's MCP config, and checks the connection.
//
// Safe to re-run: existing config is merged (never replaced), edited files are backed up first, and
// re-running rotates the key for the tools you set up again. Keys go only into the client configs
// (the clients need them) and are never printed; gateway.json keeps hashes.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseGatewayConfig, sha256 } from "./config.js";

export const CLIENTS = ["claude-desktop", "vscode", "claude-code"];
const SERVER_NAME = "db-agent";

export function clientConfigPath(client, { home, platform, cwd, workspace }) {
  if (client === "claude-desktop") {
    if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    if (platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    return null; // no Claude Desktop on Linux
  }
  if (client === "vscode") {
    if (workspace) return path.join(cwd, ".vscode", "mcp.json");
    if (platform === "darwin") return path.join(home, "Library", "Application Support", "Code", "User", "mcp.json");
    if (platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User", "mcp.json");
    return path.join(home, ".config", "Code", "User", "mcp.json");
  }
  return null;
}

// Strict JSON only: a file with comments (VS Code allows them) is left alone and reported.
function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
    return data;
  } catch (exc) {
    throw new Error(`${file} is not plain JSON (${exc.message}); add the db-agent entry by hand (see docs/mcp-gateway.md)`);
  }
}

function writeJson(file, data, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", mode ? { mode } : undefined);
}

// Pure: returns the gateway config with one caller per tool, replacing any earlier entry for that tool.
export function mergeGatewayCallers(existing, entries) {
  const tools = new Set(entries.map((e) => e.tool));
  const kept = (existing.callers || []).filter((c) => !(tools.has(c.tool) && c.user === entries[0].user));
  return { ...existing, callers: [...kept, ...entries] };
}

export function serverEntry({ binPath, key, vscode = false }) {
  return {
    ...(vscode ? { type: "stdio" } : {}),
    command: process.execPath,
    args: [binPath, "mcp", "serve", "--stdio"],
    env: { DB_AGENT_API_KEY: key },
  };
}

export async function runSetup({
  appDir, home = os.homedir(), platform = process.platform, cwd = process.cwd(),
  clients = CLIENTS, workspace = false, dryRun = false, check = true,
  gatewayPath, user = os.userInfo().username, team = null,
  claudeCli = (args) => spawnSync("claude", args, { encoding: "utf8" }),
  verify = null, out = (m) => console.log(m),
}) {
  const binPath = path.join(appDir, "bin", "db-agent.js");
  const results = [];
  const keys = {};
  for (const c of clients) keys[c] = crypto.randomBytes(24).toString("hex");

  // 1. Work out every change before writing any, so a bad file stops the run before anything changed.
  const plans = [];
  for (const client of clients) {
    if (client === "claude-code") {
      const probe = claudeCli(["--version"]);
      if (probe.error || probe.status !== 0) {
        results.push({ client, status: "skipped", detail: "the `claude` command was not found on PATH" });
        continue;
      }
      plans.push({ client });
      continue;
    }
    const file = clientConfigPath(client, { home, platform, cwd, workspace });
    if (!file) {
      results.push({ client, status: "skipped", detail: `not supported on ${platform}` });
      continue;
    }
    if (client === "claude-desktop" && !fs.existsSync(path.dirname(file))) {
      results.push({ client, status: "skipped", detail: "Claude Desktop does not look installed (no config folder)" });
      continue;
    }
    let data;
    try { data = readJson(file); } catch (exc) { results.push({ client, status: "failed", detail: exc.message }); continue; }
    plans.push({ client, file, data });
  }

  const active = plans.map((p) => p.client);
  if (active.length === 0) return { results, ok: false };

  const gwFile = gatewayPath || path.join(appDir, "gateway.json");
  let gateway;
  try { gateway = readJson(gwFile); } catch (exc) { return { results: [...results, { client: "gateway.json", status: "failed", detail: exc.message }], ok: false }; }
  try {
    parseGatewayConfig(gateway, { warn() {} }); // is the file we are about to extend already valid?
  } catch (exc) {
    if (!/no caller|needs a non-empty/.test(exc.message)) {
      return { results: [...results, { client: "gateway.json", status: "failed", detail: `${exc.message}. Fix or remove that entry in ${gwFile}, then run setup again (nothing was changed).` }], ok: false };
    }
  }
  gateway = mergeGatewayCallers(gateway, active.map((client) => ({ keySha256: sha256(keys[client]), user, ...(team ? { team } : {}), tool: client })));

  if (dryRun) {
    out(`Would write ${gwFile} (callers: ${active.join(", ")})`);
    for (const p of plans) out(`Would configure ${p.client}${p.file ? ` at ${p.file}` : ""}`);
    return { results, ok: true, dryRun: true };
  }

  // 2. Apply.
  writeJson(gwFile, gateway, { mode: 0o600 });
  results.push({ client: "gateway.json", status: "ok", detail: gwFile });
  for (const p of plans) {
    if (p.client === "claude-code") {
      claudeCli(["mcp", "remove", SERVER_NAME, "--scope", "user"]); // fine if absent
      const r = claudeCli(["mcp", "add", SERVER_NAME, "--scope", "user", "--env", `DB_AGENT_API_KEY=${keys[p.client]}`,
        "--", process.execPath, binPath, "mcp", "serve", "--stdio"]);
      results.push(r.status === 0
        ? { client: p.client, status: "ok", detail: "added with `claude mcp add` (user scope)" }
        : { client: p.client, status: "failed", detail: (r.stderr || r.stdout || "claude mcp add failed").trim().split("\n")[0] });
      continue;
    }
    const isVscode = p.client === "vscode";
    const root = isVscode ? "servers" : "mcpServers";
    p.data[root] = { ...(p.data[root] || {}), [SERVER_NAME]: serverEntry({ binPath, key: keys[p.client], vscode: isVscode }) };
    try {
      writeJson(p.file, p.data);
      results.push({ client: p.client, status: "ok", detail: p.file });
    } catch (exc) {
      results.push({ client: p.client, status: "failed", detail: exc.message });
    }
  }

  // 3. Prove it works: connect as each configured client and list tables.
  if (check && verify) {
    for (const p of plans) {
      const r = results.find((x) => x.client === p.client);
      if (r?.status !== "ok") continue;
      const v = await verify(keys[p.client]);
      r.check = v;
    }
  }
  return { results, ok: results.every((r) => r.status !== "failed") };
}

// Connects over stdio exactly as an AI tool would, with the new key, and calls list_tables.
export async function verifyConnection({ binPath, key, env = process.env }) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath, args: [binPath, "mcp", "serve", "--stdio"],
    env: { ...Object.fromEntries(Object.entries(env).filter(([, v]) => v != null)), DB_AGENT_API_KEY: key }, stderr: "pipe",
  });
  const client = new Client({ name: "db-agent-setup", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", (d) => { stderr += d; });
  const work = (async () => {
    await client.connect(transport);
    const r = await client.callTool({ name: "list_tables", arguments: {} });
    const text = r.content?.[0]?.text || "";
    if (r.isError) return { ok: false, detail: text };
    return { ok: true, detail: `${JSON.parse(text).tables.length} table(s) visible` };
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, detail: "timed out after 30s" }), 30_000));
  try {
    return await Promise.race([work, timeout]);
  } catch (exc) {
    const why = stderr.split("\n").filter((l) => l && !/ExperimentalWarning|--trace-warnings/.test(l)).pop();
    return { ok: false, detail: why ? `${why} (${exc.message})` : exc.message };
  } finally {
    await client.close().catch(() => {});
  }
}
