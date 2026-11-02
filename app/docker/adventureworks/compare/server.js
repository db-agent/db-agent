// Side-by-side for the AdventureWorks demo: sends one question to both db-agent instances (without and with the
// ontology) and shows the two answers next to each other, scored against the correct SQL when the question is a
// known one. No dependencies. Run by docker-compose.adventureworks.yml.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sameResult } from "../../../resultCompare.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SIDES = {
  plain: process.env.PLAIN_URL || "http://agent-plain:3001",
  curated: process.env.CURATED_URL || "http://agent-curated:3001",
};
const cases = JSON.parse(fs.readFileSync(path.join(here, "../../../scripts/adventureworks/cases.json"), "utf8")).map((c, i) => ({ id: i, ...c }));
const page = fs.readFileSync(path.join(here, "index.html"), "utf8");

async function ask(base, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
    const out = await res.json();
    return { out, ms: Date.now() - t0 };
  } catch (exc) {
    return { out: { error: String(exc.message || exc) }, ms: Date.now() - t0 };
  }
}
const rowsOf = (out) => (out.rows || []).map((r) => Object.values(r));

function shape(out, ms, truth) {
  const rows = rowsOf(out);
  let status = "complete";
  if (out.validation && out.validation.isSafe === false) status = "blocked";
  else if (out.status === "awaiting_approval") status = "held";
  else if (out.error) status = "error";
  else if (!out.sql) status = "error";
  return {
    status, sql: out.sql || null, columns: out.columns || [], rows: rows.slice(0, 15), rowCount: rows.length,
    error: out.error || (out.validation && out.validation.isSafe === false ? out.validation.reason : null) || out.approvalReason || null,
    repairs: out.repairAttempts || 0, ms,
    tokens: (out.usage?.inputTokens || 0) + (out.usage?.outputTokens || 0),
    llmUsd: out.usage?.llmUsdEstimate ?? null,
    match: truth && status === "complete" ? sameResult(rows, truth) : truth ? false : null,
  };
}

async function compare(question, caseId) {
  const c = caseId != null ? cases[caseId] : cases.find((x) => x.question === question);
  const [plain, curated, ref] = await Promise.all([
    ask(SIDES.plain, { question }),
    ask(SIDES.curated, { question }),
    c ? ask(SIDES.plain, { sql: c.groundTruthSql }) : Promise.resolve(null),
  ]);
  const truth = ref && ref.out.rows ? rowsOf(ref.out) : null;
  return {
    question, difficulty: c?.difficulty || null,
    reference: truth ? { sql: c.groundTruthSql, columns: ref.out.columns, rows: truth.slice(0, 15), rowCount: truth.length } : null,
    plain: shape(plain.out, plain.ms, truth), curated: shape(curated.out, curated.ms, truth),
  };
}

async function info() {
  const one = async (base) => {
    try {
      const [cfg, onto] = await Promise.all([fetch(`${base}/api/config`).then((r) => r.json()), fetch(`${base}/api/ontology`).then((r) => r.json())]);
      const k = onto.knowledge;
      return { model: cfg.llmModel, notes: Object.keys(k.descriptions).length, definitions: Object.keys(k.expressions).length, rules: k.instructions.length, examples: k.examples.length };
    } catch (exc) {
      return { error: String(exc.message || exc) };
    }
  };
  return {
    plain: { ...(await one(SIDES.plain)), port: process.env.PUBLIC_PLAIN_PORT || "3001" },
    curated: { ...(await one(SIDES.curated)), port: process.env.PUBLIC_CURATED_PORT || "3002" },
  };
}

const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
http.createServer(async (req, res) => {
  try {
    const route = new URL(req.url, "http://x").pathname;
    if (req.method === "GET" && route === "/") return send(res, 200, page, "text/html; charset=utf-8");
    if (req.method === "GET" && route === "/api/cases") return send(res, 200, cases);
    if (req.method === "GET" && route === "/api/info") return send(res, 200, await info());
    if (req.method === "POST" && route === "/api/compare") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const { question, caseId } = JSON.parse(raw || "{}");
      if (!question || !String(question).trim()) return send(res, 400, { error: "question is required" });
      return send(res, 200, await compare(String(question).trim(), Number.isInteger(caseId) ? caseId : null));
    }
    send(res, 404, { error: "not found" });
  } catch (exc) {
    send(res, 500, { error: String(exc.message || exc) });
  }
}).listen(Number(process.env.PORT) || 3000, () => console.log(`compare on :${process.env.PORT || 3000}`));
