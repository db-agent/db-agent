// resultCompare.js: do two query results hold the same answer? Row and column order are ignored and
// numbers are compared to 2 decimals. Shared by the eval script and the in-app accuracy test.
function norm(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))) {
    return String(Math.round(Number(v) * 100) / 100);
  }
  return String(v).trim();
}
export const signature = (rows) => rows.map((r) => r.map(norm).sort().join("\u0001")).sort();
export function sameResult(a, b) {
  const x = signature(a), y = signature(b);
  return x.length === y.length && x.every((s, i) => s === y[i]);
}
// Lenient: the answer may carry extra columns (e.g. the count next to a "which category" answer).
// True if some choice of columns, in any order, reproduces the ground-truth result set.
export function sameResultLenient(got, want) {
  if (sameResult(got, want)) return true;
  const w = want[0]?.length ?? 0, g = got[0]?.length ?? 0;
  if (!w || g <= w || g > 8) return false;
  const pick = (start, chosen) => {
    if (chosen.length === w) return sameResult(got.map((r) => chosen.map((c) => r[c])), want);
    for (let c = start; c < g; c++) if (pick(c + 1, [...chosen, c])) return true;
    return false;
  };
  return pick(0, []);
}

