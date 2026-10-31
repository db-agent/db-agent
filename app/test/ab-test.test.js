import { test } from "node:test";
import assert from "node:assert/strict";
import { createAbRunner, summarize } from "../abTest.js";

const cases = [
  { id: "1", question: "How many orders?", groundTruthSql: "SELECT count(*) FROM orders" },
  { id: "2", question: "Shipped orders?", groundTruthSql: "SELECT count(*) FROM orders WHERE status = 5" },
  { id: "3", question: "Other database question", groundTruthSql: "SELECT 1 FROM nowhere" },
];
// The fake pipeline is right about "shipped" only when the knowledge file is on.
function fake({ calls = [] } = {}) {
  return {
    calls,
    deps: {
      listCases: () => cases,
      getSchema: async () => ({ orders: [{ name: "status" }] }),
      sqlFits: (sql) => sql.includes("orders"),
      runQuery: async (sql) => ({ rows: [{ n: sql.includes("status") ? 7 : 10 }] }),
      model: "fake-7b",
      runPipeline: async (q, { knowledgeMode }) => {
        calls.push([q, knowledgeMode]);
        if (q.startsWith("Shipped") && knowledgeMode !== "file") return { sql: "SELECT count(*) FROM orders", rows: [{ n: 10 }], usage: { inputTokens: 100, outputTokens: 10 } };
        if (q.startsWith("Shipped")) return { sql: "SELECT count(*) FROM orders WHERE status = 5", rows: [{ n: 7 }], usage: { inputTokens: 150, outputTokens: 10 } };
        return { sql: "SELECT count(*) FROM orders", rows: [{ n: 10 }], usage: { inputTokens: 90, outputTokens: 5 } };
      },
    },
  };
}
const finished = async (runner) => { while (runner.status().status === "running") await new Promise((r) => setTimeout(r, 5)); return runner.status(); };

test("runs each fitting question without and with the knowledge file and scores both", async () => {
  const f = fake();
  const runner = createAbRunner(f.deps);
  const { total } = await runner.start();
  assert.equal(total, 2, "the question for another database is left out");
  const s = await finished(runner);
  assert.equal(s.status, "done");
  assert.deepEqual(s.summary.off, { ...s.summary.off, pass: 1, total: 2, percent: 50 });
  assert.deepEqual([s.summary.on.pass, s.summary.on.total, s.summary.on.percent], [2, 2, 100]);
  assert.equal(s.summary.on.tokens, 90 + 5 + 150 + 10);
  assert.deepEqual(f.calls.filter(([q]) => q.startsWith("Shipped")).map(([, m]) => m), ["none", "file"]);
});

test("held, blocked and failed answers are not passes", async () => {
  const f = fake();
  f.deps.runPipeline = async (q, { knowledgeMode }) =>
    knowledgeMode === "none" ? { sql: "SELECT 1", status: "awaiting_approval", approvalReason: "big" } : { sql: "DELETE", validation: { isSafe: false, reason: "no" } };
  const runner = createAbRunner(f.deps);
  await runner.start();
  const s = await finished(runner);
  assert.equal(s.summary.off.pass + s.summary.on.pass, 0);
  assert.equal(s.summary.off.held, 2);
  assert.equal(s.results[0].on.status, "blocked");
});

test("only one test at a time, and an empty set is an error", async () => {
  const f = fake();
  const runner = createAbRunner(f.deps);
  await runner.start();
  await assert.rejects(() => runner.start(), /already running/);
  await finished(runner);
  const none = createAbRunner({ ...f.deps, sqlFits: () => false });
  await assert.rejects(() => none.start(), /No benchmark question fits/);
  assert.equal(none.status().status, "idle");
});

test("a question whose ground truth fails is skipped and counted", async () => {
  const f = fake();
  f.deps.runQuery = async (sql) => { if (sql.includes("status")) throw new Error("boom"); return { rows: [{ n: 10 }] }; };
  const runner = createAbRunner(f.deps);
  await runner.start();
  const s = await finished(runner);
  assert.equal(s.summary.skipped, 1);
  assert.equal(s.summary.off.total, 1);
});

test("summarize of nothing is zeros", () => {
  assert.deepEqual(summarize([]).off, { pass: 0, total: 0, percent: 0, held: 0, tokens: 0, avgMs: 0 });
});
