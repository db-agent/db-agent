// sqlEngines/sqlite.js — the default SQL engine: Node's built-in node:sqlite
// module against a local file (data/demo.db by default).
//
// This is the same schema-introspection and query logic that used to live
// directly in server.js, moved here unchanged so it can sit behind the same
// pluggable interface every other engine implements (see sqlEngines/index.js)
// — no functional change, just packaging.

import { DatabaseSync } from "node:sqlite";

// The LLM guesses literal column values ("status = 'Pending'" when the data
// stores 'pending'), returning zero rows with no error — one of the most
// common real-world text-to-SQL failures. Sampling distinct values for
// low-cardinality TEXT columns and showing them in the schema fixes this
// automatically, no config needed.
const MAX_DISTINCT_VALUES = 10;
// Skip columns whose name suggests personal data even if low-cardinality —
// sampling exists to disambiguate enum-like columns, not to leak literal
// customer data into every prompt. These patterns are unambiguous on their
// own regardless of table.
const PII_ALWAYS_PATTERNS = [
  "email", "phone", "address", "ssn", "password", "secret", "token", "dob", "birth",
];
// "name" alone is ambiguous — customers.name is a person's name (PII),
// products.name is not. Only treat *_name columns as PII when the table
// itself looks like it holds people.
const PERSON_TABLE_PATTERNS = [
  "customer", "user", "person", "employee", "contact", "client", "patient", "student", "member",
];

function looksLikePII(table, columnName) {
  const lowerCol = columnName.toLowerCase();
  if (PII_ALWAYS_PATTERNS.some((p) => lowerCol.includes(p))) return true;
  if (lowerCol.includes("name")) {
    const lowerTable = table.toLowerCase();
    return PERSON_TABLE_PATTERNS.some((p) => lowerTable.includes(p));
  }
  return false;
}

export class SQLiteEngine {
  constructor({ dbPath }) {
    this.db = new DatabaseSync(dbPath, { readOnly: false });
    // Cached for the process lifetime rather than re-sampled every request
    // — the schema itself is read fresh each time (cheap PRAGMA calls), but
    // sampling adds a real query per eligible column, and the underlying
    // data doesn't change from a user's perspective the way a knowledge.json
    // edit would. A server restart clears it.
    this.columnValueCache = new Map();
  }

  sampleColumnValues(table, column) {
    const cacheKey = `${table}.${column}`;
    if (this.columnValueCache.has(cacheKey)) return this.columnValueCache.get(cacheKey);

    let values = null;
    try {
      const safeTable = `"${table.replaceAll('"', '""')}"`;
      const safeColumn = `"${column.replaceAll('"', '""')}"`;
      const rows = this.db
        .prepare(
          `SELECT DISTINCT ${safeColumn} AS v FROM ${safeTable} WHERE ${safeColumn} IS NOT NULL LIMIT ${MAX_DISTINCT_VALUES + 1}`
        )
        .all();
      // Hitting the +1 limit means the column is higher-cardinality than
      // "enum-like" — skip it rather than show a truncated, misleading list.
      if (rows.length > 0 && rows.length <= MAX_DISTINCT_VALUES) {
        values = rows.map((r) => String(r.v));
      }
    } catch {
      values = null;
    }

    this.columnValueCache.set(cacheKey, values);
    return values;
  }

  getSchema() {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();

    const schema = {};
    for (const { name: table } of tables) {
      const safeTable = `"${String(table).replaceAll('"', '""')}"`;
      const columns = this.db.prepare(`PRAGMA table_info(${safeTable})`).all();
      schema[table] = columns.map((c) => {
        const col = { name: c.name, type: c.type };
        if (String(c.type).toUpperCase().includes("TEXT") && !looksLikePII(table, c.name)) {
          const values = this.sampleColumnValues(table, c.name);
          if (values) col.sampleValues = values;
        }
        return col;
      });
    }
    return schema;
  }

  runQuery(sql) {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all();
    const columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
    return { columns, rows };
  }
}
