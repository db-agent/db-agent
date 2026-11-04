// version.js: which commit is this? Shown in the UI sidebar and /api/config so a deployed copy can be identified.
// Order: GIT_COMMIT env (set at build or deploy time), git itself (a checkout run with run_local.sh or npm start,
// so a stale VERSION file cannot override it), then a VERSION file next to this one (Databricks Apps has no git:
// the deploy workflow writes it). "unknown" when none of them works.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: here, stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).toString().trim();

export function resolveVersion(env = process.env) {
  const fromEnv = (env.GIT_COMMIT || "").trim();
  if (fromEnv) return { commit: fromEnv, short: fromEnv.slice(0, 7), source: "env" };
  try {
    const commit = git("rev-parse", "HEAD");
    const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
    return { commit, short: commit.slice(0, 7) + (dirty ? "-dirty" : ""), source: "git" };
  } catch { /* not a git checkout, or git missing */ }
  try {
    const fromFile = fs.readFileSync(path.join(here, "VERSION"), "utf8").trim();
    if (fromFile) return { commit: fromFile, short: fromFile.slice(0, 7), source: "file" };
  } catch { /* no VERSION file */ }
  return { commit: null, short: "unknown", source: "none" };
}

export const APP_VERSION = resolveVersion();
