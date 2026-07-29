// benchmark.js — fires every benchmark case through the real pipeline
// (server.js's /api/ask, including the SQL repair loop) and scores on
// RESULT SETS, not SQL string comparison — equivalent SQL differs textually
// (different joins, aliases, column order), so string diffing would
// produce false failures.
//
// Cases come from benchmarks.js's shared store, which merges three
// sources — see that file's header comment for the full model:
//   seed     — app/benchmarks.json, hand-verified, repo-tracked.
//              Failures here are real regressions: reported, never pruned.
//   user     — added via POST /api/benchmarks.
//   feedback — auto-promoted from thumbs-up feedback entries before this
//              run starts (see importFromFeedback below), unless
//              IMPORT_FEEDBACK=false.
// user/feedback cases that FAIL are auto-removed from the store and purged
// from shared memory's suggested follow-ups (via /api/memories/invalidate)
// — a case that no longer reflects the schema/data shouldn't keep being
// used as a few-shot example (knowledge.js) or suggested to other agents.
// This is what makes the ground-truth set self-healing rather than
// monotonically accumulating stale entries.
//
// Ground-truth SQL is executed directly against the same SQLite DB, not
// through the LLM. Hand-verify ground truth when you author it — this tool
// only tells you whether the generated SQL matches what you told it was
// correct, not whether your ground truth itself is right.
//
// Comparison tolerates row-order AND column-order differences: each row's
// values are sorted before being turned into a signature, then the set of
// row signatures is sorted and compared. This deliberately can't
// distinguish two same-type columns whose values got swapped — acceptable
// for a benchmark tool, not a certified test framework.
//
// Questions without a single deterministic answer ("summarize the data")
// can't be scored this way — keep ground truth to questions with one.
//
// Exit code reflects SEED failures only — a seed regression means the
// pipeline broke and should block CI. A user/feedback case failing just
// means it got pruned; that's the system working as designed, not a build
// break, so it's reported but doesn't fail the run.
//
//   npm run benchmark
//   BENCHMARKS_FILE=./my-benchmarks.json npm run benchmark
//   IMPORT_FEEDBACK=false npm run benchmark

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dedicated port so this doesn't collide with a `run_local.sh`/dev server
// already running on the default 3001.
const PORT = process.env.PORT || "3099";
process.env.PORT = PORT;
// Memory writes are an unrelated side effect during a benchmark run — off
// by default, override with MEMORY_ENABLED=true if you actually want them.
// Note this also disables the invalidateFollowup calls below (they're a
// no-op when memory is disabled), which is fine — there's nothing to purge
// from a store nothing is being written to.
process.env.MEMORY_ENABLED = process.env.MEMORY_ENABLED || "false";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "demo.db");
const FEEDBACK_PATH = process.env.FEEDBACK_STORE_PATH || path.join(__dirname, "data", "feedback.jsonl");
const IMPORT_FEEDBACK = (process.env.IMPORT_FEEDBACK ?? "true").toLowerCase() !== "false";

function normalizeValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return v.toFixed(6); // avoid float-precision false failures
  return String(v);
}

function rowSignature(row) {
  return Object.values(row).map(normalizeValue).sort().join("|");
}

function resultSetsMatch(actualRows, expectedRows) {
  if (actualRows.length !== expectedRows.length) return false;
  const actualSigs = actualRows.map(rowSignature).sort();
  const expectedSigs = expectedRows.map(rowSignature).sort();
  return actualSigs.every((sig, i) => sig === expectedSigs[i]);
}

async function waitForServer(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/config`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not become ready at ${baseUrl} within ${timeoutMs}ms`);
}

async function main() {
  console.log(`Starting server on port ${PORT}…`);
  const { benchmarkStore } = await import("./benchmarks.js");
  await import("./server.js");
  const baseUrl = `http://localhost:${PORT}`;
  await waitForServer(baseUrl);

  if (IMPORT_FEEDBACK) {
    const { imported } = benchmarkStore.importFromFeedback(FEEDBACK_PATH);
    if (imported > 0) {
      console.log(`Imported ${imported} thumbs-up feedback entr${imported === 1 ? "y" : "ies"} as candidate ground truth.`);
    }
  }

  const cases = benchmarkStore.listCases();
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  console.log(`Running ${cases.length} benchmark case(s) against ${DB_PATH}\n`);

  let passed = 0;
  const failures = [];
  const prunedQuestions = [];

  for (const { id, question, groundTruthSql, source } of cases) {
    const at = new Date().toISOString();
    let expectedRows;
    try {
      expectedRows = db.prepare(groundTruthSql).all();
    } catch (exc) {
      console.log(`✗ FAIL  [${source}] ${question}`);
      console.log(`  Ground-truth SQL itself failed to execute: ${exc.message || exc}\n`);
      await handleFailure({ id, question, source, reason: "ground truth SQL invalid" });
      continue;
    }

    const res = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const output = await res.json();

    if (output.error || output.rows === null) {
      console.log(`✗ FAIL  [${source}] ${question}`);
      console.log(`  Generated SQL: ${output.sql || "(none)"}`);
      console.log(`  Error: ${output.error || output.validation?.reason || "no rows returned"}\n`);
      await handleFailure({ id, question, source, reason: "pipeline error", sql: output.sql });
      continue;
    }

    if (resultSetsMatch(output.rows, expectedRows)) {
      console.log(`✓ PASS  [${source}] ${question}`);
      passed++;
      benchmarkStore.recordRunResult(id, { status: "pass", at, sql: output.sql });
    } else {
      console.log(`✗ FAIL  [${source}] ${question}`);
      console.log(`  Generated SQL: ${output.sql}`);
      console.log(`  Ground truth:  ${groundTruthSql}`);
      console.log(`  Got:      ${JSON.stringify(output.rows)}`);
      console.log(`  Expected: ${JSON.stringify(expectedRows)}\n`);
      await handleFailure({ id, question, source, reason: "result mismatch", sql: output.sql });
    }
  }

  async function handleFailure({ id, question, source, reason, sql }) {
    const at = new Date().toISOString();
    failures.push({ question, source, reason });
    benchmarkStore.recordRunResult(id, { status: "fail", at, sql: sql || null, reason });

    if (source === "seed") return; // curated regression test — report, never prune

    try {
      benchmarkStore.removeCase(id);
      await fetch(`${baseUrl}/api/memories/invalidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      prunedQuestions.push(question);
      console.log(`  Pruned this ${source} case from ground truth and shared memory.\n`);
    } catch (exc) {
      console.warn(`  Could not prune case ${id}: ${exc.message || exc}\n`);
    }
  }

  const seedFailures = failures.filter((f) => f.source === "seed");

  console.log(`\n${passed}/${cases.length} passed`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.map((f) => `[${f.source}] ${f.question}`).join(", ")}`);
  }
  if (prunedQuestions.length > 0) {
    console.log(`Pruned (not blocking): ${prunedQuestions.join(", ")}`);
  }
  if (seedFailures.length > 0) {
    console.log(`\n${seedFailures.length} SEED case(s) failed — this is a real regression.`);
  }

  process.exit(seedFailures.length > 0 ? 1 : 0);
}

main().catch((exc) => {
  console.error(`Benchmark run failed: ${exc.message || exc}`);
  process.exit(1);
});
