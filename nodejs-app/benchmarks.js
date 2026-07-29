// benchmarks.js — the benchmark case store shared by server.js (API +
// prompt-building) and benchmark.js (the CLI runner). A "case" is a
// question paired with hand-verified ground-truth SQL; benchmark.js scores
// the live pipeline's output against it, and server.js also mines passing
// cases as few-shot examples (see selectRelevantKnowledge in knowledge.js).
//
// Three sources of cases, ranked by trust:
//   seed     — nodejs-app/benchmarks.json, repo-tracked and hand-verified.
//              Read-only through this module: seed cases can't be deleted
//              or have their run result persisted back into a file that's
//              committed to the repo, since that would make every CI run
//              dirty a tracked file. Failures are still reported, just not
//              written anywhere or auto-pruned — a seed regression means
//              the pipeline broke, not that the case is bad.
//   user     — added through POST /api/benchmarks (a human typed a
//              question + the SQL they believe is correct).
//   feedback — promoted automatically from thumbs-up feedback entries that
//              included generated SQL (see importFromFeedback). The user
//              only confirmed the *answer* looked right, not that the SQL
//              is correct for all future data — so these are held to the
//              same "prune on failure" standard as user-submitted cases,
//              not treated as curated truth.
//
// user + feedback cases both live in data/benchmark-cases.json (gitignored,
// mutable) and both can be auto-removed by benchmark.js when they fail —
// that's the "self-healing ground truth" loop: a thumbs-up promotes a case,
// a later benchmark run either keeps validating it or prunes it.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateSql } from "./sqlSafety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SOURCE = Object.freeze({ SEED: "seed", USER: "user", FEEDBACK: "feedback" });

function normalizeQuestion(text) {
  return String(text).trim().toLowerCase().replace(/[?.!]+$/, "");
}

function seedId(question) {
  // Stable across runs so a seed case's identity doesn't shift just because
  // the file was reformatted — derived from the question text itself since
  // benchmarks.json has no id field (it's hand-authored, kept simple).
  return "seed-" + crypto.createHash("sha1").update(normalizeQuestion(question)).digest("hex").slice(0, 12);
}

// `validateSql` is injected (from sqlSafety.js) rather than imported
// directly so this module doesn't hard-depend on where that lives, and so
// tests can stub it out.
export function createBenchmarkStore({ seedPath, userPath, validateSql }) {
  function loadSeed() {
    if (!fs.existsSync(seedPath)) return [];
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    } catch (exc) {
      console.warn(`[benchmarks] could not read ${seedPath}: ${exc.message || exc}`);
      return [];
    }
    if (!Array.isArray(raw)) return [];
    return raw.map((c) => ({
      id: seedId(c.question),
      question: c.question,
      groundTruthSql: c.groundTruthSql,
      source: SOURCE.SEED,
      createdAt: null,
      lastRun: null,
    }));
  }

  function loadUser() {
    if (!fs.existsSync(userPath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(userPath, "utf-8"));
      return Array.isArray(raw) ? raw : [];
    } catch (exc) {
      console.warn(`[benchmarks] could not read ${userPath}, ignoring: ${exc.message || exc}`);
      return [];
    }
  }

  function saveUser(cases) {
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    fs.writeFileSync(userPath, JSON.stringify(cases, null, 2) + "\n");
  }

  function listCases() {
    return [...loadSeed(), ...loadUser()];
  }

  function findCase(id) {
    return listCases().find((c) => c.id === id) || null;
  }

  function addCase({ question, groundTruthSql, source = SOURCE.USER }) {
    const q = (question || "").trim();
    const sql = (groundTruthSql || "").trim();
    if (!q) throw new Error("question is required");
    if (!sql) throw new Error("groundTruthSql is required");
    if (validateSql) {
      const validation = validateSql(sql);
      if (!validation.isSafe) {
        throw new Error(`groundTruthSql must be a safe read-only query: ${validation.reason}`);
      }
    }

    const cases = loadUser();
    const existingIdx = cases.findIndex((c) => normalizeQuestion(c.question) === normalizeQuestion(q));
    const entry = {
      id: existingIdx >= 0 ? cases[existingIdx].id : crypto.randomUUID(),
      question: q,
      groundTruthSql: sql,
      source,
      createdAt: new Date().toISOString(),
      lastRun: null,
    };
    if (existingIdx >= 0) {
      cases[existingIdx] = entry;
    } else {
      cases.push(entry);
    }
    saveUser(cases);
    return entry;
  }

  function removeCase(id) {
    if (id.startsWith("seed-")) {
      throw new Error("cannot remove a curated seed benchmark case");
    }
    const cases = loadUser();
    const idx = cases.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error("benchmark case not found");
    const [removed] = cases.splice(idx, 1);
    saveUser(cases);
    return removed;
  }

  // result: { status: "pass"|"fail", at: isoString, sql, reason? }
  function recordRunResult(id, result) {
    if (id.startsWith("seed-")) return; // see module comment — never persisted
    const cases = loadUser();
    const idx = cases.findIndex((c) => c.id === id);
    if (idx === -1) return;
    cases[idx] = { ...cases[idx], lastRun: result };
    saveUser(cases);
  }

  // Promotes thumbs-up feedback entries (rating "up", with generated SQL)
  // into candidate ground truth, deduped by question (latest wins) and
  // skipped if a case for that question already exists from any source.
  function importFromFeedback(feedbackPath) {
    if (!fs.existsSync(feedbackPath)) return { imported: 0 };

    const lines = fs.readFileSync(feedbackPath, "utf-8").split("\n").filter(Boolean);
    const byQuestion = new Map();
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.rating !== "up" || !entry.sql) continue;
      byQuestion.set(normalizeQuestion(entry.question), entry);
    }

    const existingQuestions = new Set(listCases().map((c) => normalizeQuestion(c.question)));
    const cases = loadUser();
    let imported = 0;

    for (const [key, entry] of byQuestion) {
      if (existingQuestions.has(key)) continue;
      if (validateSql) {
        const validation = validateSql(entry.sql);
        if (!validation.isSafe) continue;
      }
      cases.push({
        id: crypto.randomUUID(),
        question: entry.question,
        groundTruthSql: entry.sql,
        source: SOURCE.FEEDBACK,
        createdAt: new Date().toISOString(),
        lastRun: null,
      });
      imported++;
    }

    if (imported > 0) saveUser(cases);
    return { imported };
  }

  return { listCases, findCase, addCase, removeCase, recordRunResult, importFromFeedback };
}

// Singleton used by both server.js and benchmark.js (benchmark.js imports
// server.js as a module for its side effect of starting the server, so both
// end up sharing this same instance within one process — no separate wiring
// needed to keep the API and the CLI runner looking at the same cases).
export const benchmarkStore = createBenchmarkStore({
  seedPath: process.env.BENCHMARKS_FILE || path.join(__dirname, "benchmarks.json"),
  userPath: process.env.BENCHMARK_CASES_STORE_PATH || path.join(__dirname, "data", "benchmark-cases.json"),
  validateSql,
});
