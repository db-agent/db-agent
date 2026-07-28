// benchmark.js — fires each benchmarks.json question through the real
// pipeline (server.js's /api/ask, including the SQL repair loop) and scores
// on RESULT SETS, not SQL string comparison — equivalent SQL differs
// textually (different joins, aliases, column order), so string diffing
// would produce false failures.
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
// can't be scored this way — keep benchmarks.json to questions with one.
//
//   npm run benchmark
//   BENCHMARKS_FILE=./my-benchmarks.json npm run benchmark

import fs from "node:fs";
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
process.env.MEMORY_ENABLED = process.env.MEMORY_ENABLED || "false";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "demo.db");
const BENCHMARKS_PATH = process.env.BENCHMARKS_FILE || path.join(__dirname, "benchmarks.json");

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
  if (!fs.existsSync(BENCHMARKS_PATH)) {
    console.error(`Benchmarks file not found: ${BENCHMARKS_PATH}`);
    process.exit(1);
  }
  const cases = JSON.parse(fs.readFileSync(BENCHMARKS_PATH, "utf-8"));

  const db = new DatabaseSync(DB_PATH, { readOnly: true });

  console.log(`Starting server on port ${PORT}…`);
  await import("./server.js");
  const baseUrl = `http://localhost:${PORT}`;
  await waitForServer(baseUrl);
  console.log(`Server ready. Running ${cases.length} benchmark case(s) against ${DB_PATH}\n`);

  let passed = 0;
  const failures = [];

  for (const { question, groundTruthSql } of cases) {
    let expectedRows;
    try {
      expectedRows = db.prepare(groundTruthSql).all();
    } catch (exc) {
      console.log(`✗ FAIL  ${question}`);
      console.log(`  Ground-truth SQL itself failed to execute: ${exc.message || exc}\n`);
      failures.push({ question, reason: "ground truth SQL invalid" });
      continue;
    }

    const res = await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const output = await res.json();

    if (output.error || output.rows === null) {
      console.log(`✗ FAIL  ${question}`);
      console.log(`  Generated SQL: ${output.sql || "(none)"}`);
      console.log(`  Error: ${output.error || output.validation?.reason || "no rows returned"}\n`);
      failures.push({ question, reason: "pipeline error", sql: output.sql });
      continue;
    }

    if (resultSetsMatch(output.rows, expectedRows)) {
      console.log(`✓ PASS  ${question}`);
      passed++;
    } else {
      console.log(`✗ FAIL  ${question}`);
      console.log(`  Generated SQL: ${output.sql}`);
      console.log(`  Ground truth:  ${groundTruthSql}`);
      console.log(`  Got:      ${JSON.stringify(output.rows)}`);
      console.log(`  Expected: ${JSON.stringify(expectedRows)}\n`);
      failures.push({ question, reason: "result mismatch", sql: output.sql });
    }
  }

  console.log(`\n${passed}/${cases.length} passed`);
  if (failures.length > 0) {
    console.log(`\nFailed: ${failures.map((f) => f.question).join(", ")}`);
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((exc) => {
  console.error(`Benchmark run failed: ${exc.message || exc}`);
  process.exit(1);
});
