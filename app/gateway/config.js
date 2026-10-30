// gateway/config.js: who may call the MCP gateway, and which tables they may see.
//
// JSON, not YAML: the app has no YAML parser and this adds no dependency (see #71).
// Each caller maps one API key to a user, a team and the AI tool that holds the key.
// Keys are matched by SHA-256 and never written to the log or the store.

import crypto from "node:crypto";
import fs from "node:fs";

const MIN_KEY_LENGTH = 16;

export const sha256 = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");

function resolveKey(entry, index) {
  if (entry.keySha256) {
    if (!/^[0-9a-f]{64}$/i.test(entry.keySha256)) throw new Error(`callers[${index}].keySha256 must be 64 hex characters`);
    return entry.keySha256.toLowerCase();
  }
  let key = entry.key;
  if (typeof key === "string" && key.startsWith("env:")) {
    const name = key.slice(4);
    key = process.env[name];
    if (!key) return { missingEnv: name };
  }
  if (typeof key !== "string" || key.length < MIN_KEY_LENGTH) {
    throw new Error(`callers[${index}] needs "key" (at least ${MIN_KEY_LENGTH} characters, or "env:NAME") or "keySha256"`);
  }
  return sha256(key);
}

const lowerList = (v) => (Array.isArray(v) ? v.map((t) => String(t).toLowerCase()) : null);

// A caller whose "env:NAME" key is not set cannot authenticate, so it is skipped with a warning
// (a client launched by an AI tool only sees the env that tool passes it). Only an empty result is an error.
export function parseGatewayConfig(data, { warn = (m) => console.error(m) } = {}) {
  if (!data || !Array.isArray(data.callers) || data.callers.length === 0) {
    throw new Error('gateway config needs a non-empty "callers" array');
  }
  const seen = new Set();
  const callers = data.callers.map((entry, i) => {
    for (const field of ["user", "tool"]) {
      if (!entry[field] || typeof entry[field] !== "string") throw new Error(`callers[${i}] needs "${field}"`);
    }
    const keyHash = resolveKey(entry, i);
    if (keyHash.missingEnv) {
      warn(`db-agent: skipping caller ${entry.user}/${entry.tool}: env var ${keyHash.missingEnv} is not set`);
      return null;
    }
    if (seen.has(keyHash)) throw new Error(`callers[${i}] reuses another caller's key`);
    seen.add(keyHash);
    return {
      keyHash,
      user: entry.user,
      team: entry.team || null,
      tool: entry.tool,
      allowTables: lowerList(entry.allowTables),
    };
  }).filter(Boolean);
  if (callers.length === 0) throw new Error("no caller in the gateway config has a usable key (set the env vars named by env: keys, or use keySha256)");
  return {
    callers,
    tables: { allow: lowerList(data.tables?.allow), deny: lowerList(data.tables?.deny) || [] },
    maxRows: Number(data.limits?.maxRows) > 0 ? Number(data.limits.maxRows) : 200,
  };
}

export function loadGatewayConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `No gateway config at ${filePath}. Copy gateway.example.json to gateway.json (or set GATEWAY_CONFIG) and add a caller.`
    );
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (exc) {
    throw new Error(`${filePath} is not valid JSON: ${exc.message}`);
  }
  return parseGatewayConfig(data);
}

// Returns { user, team, tool, allowTables } or null. Constant-time comparison; the key itself is not kept.
export function authenticate(config, presentedKey) {
  if (!presentedKey || typeof presentedKey !== "string") return null;
  const presented = Buffer.from(sha256(presentedKey), "hex");
  let match = null;
  for (const c of config.callers) {
    if (crypto.timingSafeEqual(presented, Buffer.from(c.keyHash, "hex"))) match = c;
  }
  return match && { user: match.user, team: match.team, tool: match.tool, allowTables: match.allowTables };
}

// The tables this caller may see, out of the schema's table names.
export function allowedTables(config, caller, allTables) {
  const deny = new Set(config.tables.deny);
  return allTables.filter((t) => {
    const name = t.toLowerCase();
    if (deny.has(name)) return false;
    if (config.tables.allow && !config.tables.allow.includes(name)) return false;
    if (caller.allowTables && !caller.allowTables.includes(name)) return false;
    return true;
  });
}
