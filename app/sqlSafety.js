// sqlSafety.js — read-only SQL validation, mirrors ../core/sql_safety.py.
//
// Pulled out of server.js because it's no longer only gating LLM-generated
// SQL before execution: benchmark ground truth submitted through
// /api/benchmarks (see benchmarks.js) needs the exact same guarantee before
// it's allowed to run directly against the database.

const FORBIDDEN = [
  "DROP", "DELETE", "UPDATE", "INSERT", "ALTER",
  "TRUNCATE", "CREATE", "REPLACE", "MERGE", "EXEC",
  "EXECUTE", "GRANT", "REVOKE", "ATTACH", "DETACH",
];

export function validateSql(sql) {
  const stripped = (sql || "").trim();
  if (!stripped) return { isSafe: false, reason: "SQL is empty." };

  const cleaned = stripped.replace(/;$/, "");
  if (cleaned.includes(";")) {
    return { isSafe: false, reason: "Multiple SQL statements detected. Only a single SELECT is allowed." };
  }

  const firstWord = cleaned.trim().split(/\s+/)[0].toUpperCase();
  if (!["SELECT", "WITH"].includes(firstWord)) {
    return { isSafe: false, reason: `Query must start with SELECT or WITH, got '${firstWord}'.` };
  }

  const upperSql = cleaned.toUpperCase();
  for (const keyword of FORBIDDEN) {
    if (new RegExp(`\\b${keyword}\\b`).test(upperSql)) {
      return { isSafe: false, reason: `Forbidden keyword detected: ${keyword}.` };
    }
  }

  return { isSafe: true, reason: "SQL passed all safety checks." };
}
