// sqlEngines/postgres.js — any standard Postgres-wire-protocol database,
// via the `pg` (node-postgres) driver. Covers Databricks Lakebase (managed
// Postgres) directly — Lakebase speaks the standard Postgres protocol, so
// this engine needs no Lakebase-specific code, just a host/port/database/
// user/password/sslmode pointed at it. Get those from Lakebase's own
// "Connection details" panel; this engine doesn't assume any particular
// auth method (password vs. a Databricks OAuth token as the password both
// work, since from this driver's perspective it's just a password).
//
// Schema is read fresh per request (information_schema.columns), same
// reasoning as sqlEngines/sqlite.js: cheap, and a table added to the
// database should show up without a server restart. No PII-aware sample
// value mining in this first pass (same scope decision as
// sqlEngines/minioDuckdb.js) — every column is exposed as name+type only.

import pg from "pg";

const { Pool } = pg;

function sslOption(ssl) {
  // Lakebase (and most managed Postgres) requires TLS; rejectUnauthorized:
  // false is the pragmatic default for managed-service CA chains that
  // aren't in Node's default trust store — set PG_SSL=strict to require
  // full verification instead.
  if (ssl === "strict") return true;
  if (ssl === "false") return false;
  return { rejectUnauthorized: false };
}

// Strips user:password out of a connection string for display/logging —
// same "never leak credentials" reasoning as everywhere else this project
// touches secrets. Falls back to a redacted placeholder if the string
// doesn't parse as a URL for any reason, rather than risking a leak.
function redactConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "postgres://<unparsed-connection-string>";
  }
}


// ── Plan analysis (issue #63) ────────────────────────────────────────────────
// analyzeQuery() asks the planner for EXPLAIN (FORMAT JSON) — planning only,
// the query is NOT executed — and reduces the plan tree to what the cost
// guard in server.js needs: estimated result rows, bytes the plan has to read,
// the scan type per table, and warnings for likely-expensive patterns.
// parsePostgresPlan() is pure (plan + table stats in, summary out) so it can
// be unit-tested without a database.

const PAGE_BYTES = 8192;
const SCAN_NODES = new Set([
  "Seq Scan", "Index Scan", "Index Only Scan", "Bitmap Heap Scan",
  "Tid Scan", "Tid Range Scan", "Sample Scan",
]);
// Nodes that pass a parent LIMIT straight through to their child, so a Seq Scan
// underneath really does stop early. Sort / Aggregate / Hash / ... do not.
const LIMIT_PASS_THROUGH = new Set(["Limit", "Result", "Gather", "Gather Merge", "Subquery Scan"]);

function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return null;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const fmtRows = (n) => Math.round(n).toLocaleString("en-US");

// reltuples is -1 (PG14+) or 0 (older) until the table is first analyzed/vacuumed.
function tableStats(stats, schema, name) {
  const s = stats[`${schema}.${name}`];
  if (!s) return { rows: null, pages: null, known: false };
  const known = s.reltuples > 0 || (s.reltuples === 0 && s.relpages === 0);
  return { rows: known ? Math.round(s.reltuples) : null, pages: s.relpages, known };
}

export function parsePostgresPlan(root, stats = {}, { largeTableRows = 100000 } = {}) {
  const scans = [];
  const warnings = [];
  let bytes = 0;
  let bytesKnown = false;
  let scanRows = null;

  const visit = (node, limitRows) => {
    const type = node["Node Type"];
    const children = node.Plans || [];

    if (SCAN_NODES.has(type) && node["Relation Name"]) {
      const schema = node.Schema || "public";
      const name = node["Relation Name"];
      const label = schema === "public" ? name : `${schema}.${name}`;
      const st = tableStats(stats, schema, name);
      const filter = node.Filter || node["Index Cond"] || node["Recheck Cond"] || null;
      const seq = type === "Seq Scan";
      const planRows = node["Plan Rows"] ?? null;
      const width = node["Plan Width"] ?? 0;

      // Rows/bytes this scan really has to read.
      let readRows;
      let readBytes = null;
      if (limitRows != null) {
        // Under a LIMIT the scan stops early (the node still reports its full row estimate).
        readRows = limitRows;
        readBytes = limitRows * width;
      } else if (seq || type === "Bitmap Heap Scan") {
        readRows = st.rows ?? planRows;
        readBytes = st.pages != null && st.known ? st.pages * PAGE_BYTES : planRows != null ? planRows * width : null;
      } else if (!filter && (type === "Index Scan" || type === "Index Only Scan")) {
        // No index condition: the whole index is walked (e.g. count(*) answered by an
        // Index Only Scan). Index entries are small, so assume at least 16 bytes each.
        readRows = st.rows ?? planRows;
        readBytes = readRows != null ? readRows * Math.max(width, 16) : null;
      } else {
        readRows = planRows;
        readBytes = planRows != null ? planRows * width : null;
      }
      if (readBytes != null) { bytes += readBytes; bytesKnown = true; }
      if (readRows != null && (scanRows == null || readRows > scanRows)) scanRows = readRows;

      scans.push({
        table: label,
        scanType: type,
        indexName: node["Index Name"] || null,
        filtered: Boolean(filter),
        tableRows: st.rows,
        estimatedRows: planRows,
        bounded: limitRows != null,
      });

      if (seq && limitRows == null) {
        if (!st.known) {
          warnings.push({
            code: "no_table_stats", table: label,
            message: `${label} has no planner statistics, so estimates are unreliable. Run ANALYZE ${label}.`,
          });
        } else if (st.rows >= largeTableRows) {
          warnings.push(node.Filter
            ? {
                code: "seq_scan_large_table", table: label,
                message: `Sequential scan on ${label} (~${fmtRows(st.rows)} rows): the filter ${node.Filter} cannot use an index. Consider an index on the filtered column.`,
              }
            : {
                code: "no_filter_large_table", table: label,
                message: `Sequential scan on ${label} (~${fmtRows(st.rows)} rows) with no filter. Consider a WHERE clause (for example a date range) or a LIMIT.`,
              });
        }
      }
    }

    if ((type === "Index Scan" || type === "Index Only Scan") && node["Relation Name"] && limitRows == null &&
        !(node["Index Cond"] || node.Filter)) {
      const st = tableStats(stats, node.Schema || "public", node["Relation Name"]);
      if (st.known && st.rows >= largeTableRows) {
        const label = (node.Schema || "public") === "public" ? node["Relation Name"] : `${node.Schema}.${node["Relation Name"]}`;
        warnings.push({
          code: "full_index_scan_large_table", table: label,
          message: `Full scan of index ${node["Index Name"]} on ${label} (~${fmtRows(st.rows)} rows) with no filter. Consider a WHERE clause (for example a date range) or a LIMIT.`,
        });
      }
    }

    // A nested loop with no join condition and no index lookup on the inner side is a cross product.
    if (type === "Nested Loop" && limitRows == null && !node["Join Filter"]) {
      const inner = children[1];
      const innerIndexed = inner && (inner["Index Cond"] || inner["Recheck Cond"] ||
        (inner.Plans || []).some((c) => c["Index Cond"]));
      if (!innerIndexed) {
        warnings.push({
          code: "unbounded_join",
          table: null,
          message: "Join without a join condition (cross product): the result size is the product of both inputs.",
        });
      }
    }

    let childLimit = null;
    if (type === "Limit" && node["Plan Rows"] != null) childLimit = node["Plan Rows"];
    else if (limitRows != null && LIMIT_PASS_THROUGH.has(type)) childLimit = limitRows;
    for (const c of children) visit(c, childLimit);
  };

  visit(root, null);

  return {
    engine: "postgres",
    rowCount: root["Plan Rows"] ?? null,
    scanRows,
    sizeInBytes: bytesKnown ? Math.round(bytes) : null,
    sizeLabel: bytesKnown ? formatBytes(bytes) : null,
    totalCost: root["Total Cost"] ?? null,
    scans,
    warnings,
  };
}

// Strips a trailing semicolon so the statement can be embedded in EXPLAIN / DECLARE.
const stripSemicolon = (sql) => String(sql || "").trim().replace(/;+\s*$/, "");

export class PostgresEngine {
  constructor({ connectionString, host, port, database, user, password, ssl, schema, maxRows, largeTableRows }) {
    this.schemaName = schema || "public";
    this.maxRows = Number(maxRows) || 1000;
    this.largeTableRows = Number(largeTableRows) || 100000;
    // EXPLAIN only plans (milliseconds, no data read), so the server can analyze
    // every query instead of guessing which ones might be large (queryShape.js).
    this.cheapAnalysis = true;

    if (connectionString) {
      this.displayLocation = redactConnectionString(connectionString);
      this.pool = new Pool({ connectionString, ssl: sslOption(ssl) });
    } else {
      this.displayLocation = `postgres://${host}:${port}/${database}?schema=${this.schemaName}`;
      this.pool = new Pool({
        host,
        port: Number(port) || 5432,
        database,
        user,
        password,
        ssl: sslOption(ssl),
      });
    }
  }

  async getSchema() {
    const { rows } = await this.pool.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [this.schemaName]
    );

    const schema = {};
    for (const row of rows) {
      const table = row.table_name;
      if (!schema[table]) schema[table] = [];
      schema[table].push({ name: row.column_name, type: row.data_type });
    }
    return schema;
  }

  // Runs inside a transaction through a cursor so a runaway SELECT only ever
  // brings maxRows rows into memory (the database still plans/executes lazily).
  async runQuery(sql) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`DECLARE db_agent_cur NO SCROLL CURSOR FOR ${stripSemicolon(sql)}`);
      const result = await client.query(`FETCH ${this.maxRows} FROM db_agent_cur`);
      return { columns: result.fields.map((f) => f.name), rows: result.rows };
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }

  // Streams the FULL result in batches for CSV export. onBatch(columns, rows)
  // is awaited per batch, which gives the HTTP response backpressure.
  async streamRows(sql, onBatch, batchSize = 10000) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`DECLARE db_agent_export NO SCROLL CURSOR FOR ${stripSemicolon(sql)}`);
      let total = 0;
      let columns = [];
      while (true) {
        const result = await client.query(`FETCH ${batchSize} FROM db_agent_export`);
        if (result.fields.length) columns = result.fields.map((f) => f.name);
        if (result.rows.length === 0) {
          if (total === 0) await onBatch(columns, []); // header-only file for a zero-row result
          break;
        }
        await onBatch(columns, result.rows);
        total += result.rows.length;
        if (result.rows.length < batchSize) break;
      }
      return total;
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }

  // EXPLAIN (FORMAT JSON) in a read-only transaction: plans the query without
  // executing it. Planning failures on the SQL itself (unknown table/column,
  // syntax: SQLSTATE class 42) are flagged so the repair loop can fix the SQL.
  async analyzeQuery(sql) {
    const trimmed = stripSemicolon(sql);
    if (!trimmed) return { rowCount: null, sizeInBytes: null, sizeLabel: null, rawPlan: "", error: "empty SQL" };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const json = await client.query(`EXPLAIN (FORMAT JSON) ${trimmed}`);
      const text = await client.query(`EXPLAIN ${trimmed}`);
      const root = json.rows[0]["QUERY PLAN"][0].Plan;

      const rels = [];
      const collect = (n) => {
        if (n["Relation Name"]) rels.push([n.Schema || "public", n["Relation Name"]]);
        (n.Plans || []).forEach(collect);
      };
      collect(root);
      const stats = {};
      if (rels.length) {
        const { rows } = await client.query(
          `SELECT n.nspname AS schema, c.relname AS name, c.reltuples::float8 AS reltuples, c.relpages::bigint AS relpages
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN unnest($1::text[], $2::text[]) AS t(s, r) ON n.nspname = t.s AND c.relname = t.r`,
          [rels.map((r) => r[0]), rels.map((r) => r[1])]
        );
        for (const r of rows) stats[`${r.schema}.${r.name}`] = { reltuples: Number(r.reltuples), relpages: Number(r.relpages) };
      }

      const plan = parsePostgresPlan(root, stats, { largeTableRows: this.largeTableRows });
      plan.rawPlan = text.rows.map((r) => r["QUERY PLAN"]).join("\n");
      return plan;
    } catch (err) {
      if (/^42/.test(err.code || "")) err.planningError = true;
      throw err;
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }

  describe() {
    return { type: "postgres", location: this.displayLocation };
  }
}
