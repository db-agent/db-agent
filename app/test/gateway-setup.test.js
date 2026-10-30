import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { runSetup, mergeGatewayCallers } from "../gateway/setup.js";
import { parseGatewayConfig, authenticate } from "../gateway/config.js";

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-setup-"));
  const home = path.join(root, "home");
  const appDir = path.join(root, "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.join(home, "Library", "Application Support", "Claude"), { recursive: true });
  return { root, home, appDir, cwd: root };
}
const base = (s, extra = {}) => ({ appDir: s.appDir, home: s.home, cwd: s.cwd, platform: "darwin", user: "alice", out() {}, claudeCli: () => ({ status: 1, error: new Error("nope") }), ...extra });

test("setup writes keys that authenticate, hashes only in gateway.json, and merges existing config", async () => {
  const s = sandbox();
  const desktop = path.join(s.home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  fs.writeFileSync(desktop, JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" }));
  fs.writeFileSync(path.join(s.appDir, "gateway.json"), JSON.stringify({ callers: [{ keySha256: "a".repeat(64), user: "bob", tool: "ci" }], tables: { deny: ["customers"] } }));

  const { results, ok } = await runSetup(base(s, { clients: ["claude-desktop", "vscode"] }));
  assert.ok(ok, JSON.stringify(results));

  const d = JSON.parse(fs.readFileSync(desktop, "utf8"));
  assert.equal(d.theme, "dark");
  assert.ok(d.mcpServers.other, "other servers kept");
  assert.deepEqual(d.mcpServers["db-agent"].args.slice(1), ["mcp", "serve", "--stdio"]);
  assert.ok(fs.readdirSync(path.dirname(desktop)).some((f) => f.includes(".bak-")), "backup made");

  const vscodeFile = path.join(s.home, "Library", "Application Support", "Code", "User", "mcp.json");
  const v = JSON.parse(fs.readFileSync(vscodeFile, "utf8"));
  assert.equal(v.servers["db-agent"].type, "stdio");

  const gwText = fs.readFileSync(path.join(s.appDir, "gateway.json"), "utf8");
  const cfg = parseGatewayConfig(JSON.parse(gwText));
  assert.equal(cfg.tables.deny[0], "customers");
  assert.equal(authenticate(cfg, d.mcpServers["db-agent"].env.DB_AGENT_API_KEY).tool, "claude-desktop");
  assert.equal(authenticate(cfg, v.servers["db-agent"].env.DB_AGENT_API_KEY).tool, "vscode");
  assert.ok(cfg.callers.some((c) => c.tool === "ci"), "existing caller kept");
  assert.ok(!gwText.includes(d.mcpServers["db-agent"].env.DB_AGENT_API_KEY), "gateway.json has no plain key");
});

test("re-running rotates the key and leaves one entry per tool", async () => {
  const s = sandbox();
  await runSetup(base(s, { clients: ["claude-desktop"] }));
  const first = JSON.parse(fs.readFileSync(path.join(s.appDir, "gateway.json"), "utf8"));
  await runSetup(base(s, { clients: ["claude-desktop"] }));
  const second = JSON.parse(fs.readFileSync(path.join(s.appDir, "gateway.json"), "utf8"));
  assert.equal(second.callers.length, 1);
  assert.notEqual(first.callers[0].keySha256, second.callers[0].keySha256);
});

test("a config file that is not plain JSON is left untouched and reported; nothing else is written", async () => {
  const s = sandbox();
  const desktop = path.join(s.home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  fs.writeFileSync(desktop, "{ // comment\n}");
  const { results, ok } = await runSetup(base(s, { clients: ["claude-desktop"] }));
  assert.equal(ok, false);
  assert.equal(results[0].status, "failed");
  assert.equal(fs.readFileSync(desktop, "utf8"), "{ // comment\n}");
  assert.ok(!fs.existsSync(path.join(s.appDir, "gateway.json")));
});

test("dry run writes nothing; missing Claude Desktop and missing claude CLI are skipped", async () => {
  const s = sandbox();
  fs.rmSync(path.join(s.home, "Library"), { recursive: true });
  const dry = await runSetup(base(s, { clients: ["vscode"], dryRun: true }));
  assert.ok(dry.dryRun);
  assert.ok(!fs.existsSync(path.join(s.appDir, "gateway.json")));
  const r = await runSetup(base(s, { clients: ["claude-desktop", "claude-code"] }));
  assert.deepEqual(r.results.map((x) => x.status), ["skipped", "skipped"]);
});

test("claude code is added with `claude mcp add` and the key in --env", async () => {
  const s = sandbox();
  const calls = [];
  const claudeCli = (args) => { calls.push(args); return { status: 0, stdout: "", stderr: "" }; };
  const { results } = await runSetup(base(s, { clients: ["claude-code"], claudeCli }));
  assert.equal(results.find((x) => x.client === "claude-code").status, "ok");
  const add = calls.find((a) => a[1] === "add");
  assert.ok(add.some((a) => a.startsWith("DB_AGENT_API_KEY=")));
  assert.equal(add[add.indexOf("--") + 2].endsWith("db-agent.js"), true);
});

test("mergeGatewayCallers replaces only the same user and tool", () => {
  const merged = mergeGatewayCallers(
    { callers: [{ user: "alice", tool: "vscode", keySha256: "1" }, { user: "bob", tool: "vscode", keySha256: "2" }] },
    [{ user: "alice", tool: "vscode", keySha256: "3" }]
  );
  assert.deepEqual(merged.callers.map((c) => c.keySha256).sort(), ["2", "3"]);
});

test("an invalid existing caller stops setup before anything is written and names the entry", async () => {
  const s = sandbox();
  const gw = path.join(s.appDir, "gateway.json");
  fs.writeFileSync(gw, JSON.stringify({ callers: [{ keySha256: "abc123", user: "alice", tool: "vscode-copilot" }] }));
  const { results, ok } = await runSetup(base(s, { clients: ["claude-desktop"] }));
  assert.equal(ok, false);
  assert.match(results.at(-1).detail, /alice\/vscode-copilot.*64 hex/);
  assert.equal(JSON.parse(fs.readFileSync(gw, "utf8")).callers.length, 1);
  assert.ok(!fs.existsSync(path.join(s.home, "Library", "Application Support", "Claude", "claude_desktop_config.json")));
});
