// queryShape.js — cheap, dependency-free guess at whether a SELECT can return
// a LARGE result, used to decide whether the cost guard (EXPLAIN COST + the
// system-table cost estimate) is worth running. It is a heuristic over the
// SQL text, deliberately conservative: anything it can't prove is bounded is
// treated as "may be large" and analyzed.
//
// Bounded (analysis skipped):
//   - a top-level LIMIT n with n <= ANALYZE_SKIP_LIMIT (default 1000,
//     the same cap the UI/engine apply to displayed rows)
//   - an aggregate-only SELECT with no GROUP BY (always one row), e.g.
//     SELECT COUNT(*), SUM(x) FROM t
// Everything else (open-ended SELECTs, GROUP BY, UNION, window functions,
// expressions mixing aggregates...) is analyzed.
//
// Known gap, by design: a bounded-result query can still scan a lot (an
// aggregate over a huge table). Set COST_ANALYSIS=always to analyze those too.

const AGG = "COUNT|SUM|AVG|MIN|MAX|STDDEV|STDDEV_POP|STDDEV_SAMP|VARIANCE|VAR_POP|VAR_SAMP|MEDIAN|APPROX_COUNT_DISTINCT|COUNT_IF|ANY_VALUE";
const AGG_ITEM = new RegExp(`^(?:${AGG})\\(\\)(?:\\s+AS\\s+\\w+|\\s+\\w+)?$`, "i");

// Replaces string literals, quoted identifiers and comments with placeholders,
// then collapses every parenthesized group to "()" so only top-level SQL
// remains (subqueries and function arguments can't confuse the checks).
function topLevel(sql) {
  let s = String(sql || "")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '"x"')
    .replace(/`[^`]*`/g, "`x`")
    .trim()
    .replace(/;+\s*$/, "");
  let prev;
  do {
    prev = s;
    s = s.replace(/\([^()]*\)/g, "()");
  } while (s !== prev);
  return s;
}

export function isBoundedQuery(sql, { skipLimit = 1000 } = {}) {
  const t = topLevel(sql);
  if (!t || /\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/i.test(t)) return false;

  const limit = /\bLIMIT\s+(\d+)(?:\s+OFFSET\s+\d+)?\s*$/i.exec(t);
  if (limit && Number(limit[1]) <= skipLimit) return true;

  if (/\bGROUP\s+BY\b|\bOVER\b|\bDISTINCT\b(?!\s+\w+\(\))|\bPIVOT\b|\bHAVING\b/i.test(t)) return false;
  const sel = /\bSELECT\s+([\s\S]+?)\s+FROM\b/i.exec(t);
  if (!sel) return false;
  // Last SELECT before the first FROM: ignores a CTE prefix like WITH x AS () SELECT ...
  const items = sel[1].replace(/^[\s\S]*\bSELECT\s+/i, "").split(",").map((x) => x.trim());
  return items.length > 0 && items.every((x) => AGG_ITEM.test(x));
}

export function needsCostAnalysis(sql, opts) {
  return !isBoundedQuery(sql, opts);
}
