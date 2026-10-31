// abTest.js: does the team's ontology (knowledge file) improve answers? Runs each benchmark question twice
// through the real pipeline, once with the schema only and once with the knowledge file, and scores the
// result set of each answer against the ground-truth SQL.
//
// Benchmark-derived few-shot examples are left out of both runs, so the model never sees the answer.
// A query the cost guard holds for approval is counted as "held" and is not run.

import crypto from "node:crypto";
import { sameResult, sameResultLenient } from "./resultCompare.js";

const ARMS = [["off", "none"], ["on", "file"]];
const rowsOf = (out) => (out.rows || []).map((r) => Object.values(r));

export function createAbRunner({ listCases, getSchema, sqlFits, runPipeline, runQuery, model, now = Date.now }) {
  let job = null;
  let cancelled = false;

  async function scoreArm(question, truth, mode) {
    const t0 = now();
    let out;
    try {
      out = await runPipeline(question, { knowledgeMode: mode });
    } catch (exc) {
      return { status: "error", detail: String(exc?.message || exc).slice(0, 200), sql: null, ms: now() - t0, tokens: 0 };
    }
    const tokens = (out.usage?.inputTokens || 0) + (out.usage?.outputTokens || 0);
    const base = { sql: out.sql || null, ms: now() - t0, tokens, repairs: out.repairAttempts || 0 };
    if (out.validation && out.validation.isSafe === false) return { ...base, status: "blocked", detail: out.validation.reason };
    if (out.status === "awaiting_approval") return { ...base, status: "held", detail: out.approvalReason };
    if (out.error) return { ...base, status: "error", detail: String(out.error).slice(0, 200) };
    if (!out.sql) return { ...base, status: "error", detail: "no SQL generated" };
    const ok = sameResult(rowsOf(out), truth);
    return { ...base, status: ok ? "pass" : "wrong", lenient: ok || sameResultLenient(rowsOf(out), truth), detail: ok ? "" : `got ${JSON.stringify(rowsOf(out).slice(0, 2))}`.slice(0, 200) };
  }

  async function run(current, cases) {
    try {
      for (const c of cases) {
        if (cancelled) break;
        current.current = c.question;
        const entry = { id: c.id, question: c.question, groundTruthSql: c.groundTruthSql };
        try {
          const { rows } = await runQuery(c.groundTruthSql);
          const truth = rows.map((r) => Object.values(r));
          for (const [arm, mode] of ARMS) entry[arm] = await scoreArm(c.question, truth, mode);
        } catch (exc) {
          entry.skipped = `ground-truth SQL failed: ${String(exc?.message || exc).slice(0, 160)}`;
        }
        current.results.push(entry);
        current.done += 1;
      }
      current.status = cancelled ? "cancelled" : "done";
    } catch (exc) {
      current.status = "error";
      current.error = String(exc?.message || exc);
    }
    current.current = null;
    current.finishedAt = new Date(now()).toISOString();
    current.summary = summarize(current.results);
  }

  return {
    // Benchmark questions that fit the connected schema (the bundled SQLite cases do not fit another database).
    async eligibleCases(ids = null) {
      const schema = await getSchema();
      return listCases().filter((c) => (!ids || ids.includes(c.id)) && sqlFits(c.groundTruthSql, schema));
    },
    async start({ ids = null } = {}) {
      if (job?.status === "running") throw new Error("An accuracy test is already running.");
      const cases = await this.eligibleCases(ids);
      if (cases.length === 0) throw new Error("No benchmark question fits the connected database. Add questions with their correct SQL first.");
      cancelled = false;
      job = { id: crypto.randomBytes(4).toString("hex"), status: "running", model, startedAt: new Date(now()).toISOString(), finishedAt: null, total: cases.length, done: 0, current: null, results: [], summary: summarize([]) };
      void run(job, cases);
      return { id: job.id, total: job.total };
    },
    status() {
      if (!job) return { status: "idle" };
      return { ...job, summary: summarize(job.results) };
    },
    cancel() { cancelled = true; },
  };
}

export function summarize(results) {
  const arm = (name) => {
    const rs = results.filter((r) => r[name]);
    const pass = rs.filter((r) => r[name].status === "pass").length;
    return {
      pass, total: rs.length, percent: rs.length ? Math.round((100 * pass) / rs.length) : 0,
      held: rs.filter((r) => r[name].status === "held").length,
      tokens: rs.reduce((s, r) => s + (r[name].tokens || 0), 0),
      avgMs: rs.length ? Math.round(rs.reduce((s, r) => s + r[name].ms, 0) / rs.length) : 0,
    };
  };
  return { off: arm("off"), on: arm("on"), skipped: results.filter((r) => r.skipped).length };
}
