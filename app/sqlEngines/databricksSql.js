// sqlEngines/databricksSql.js — a Databricks SQL warehouse (serverless or
// pro), queried through the official @databricks/sql Node driver. This is
// for Unity Catalog tables; for Lakebase (managed Postgres) use the
// `postgres` engine instead, which needs no Databricks-specific code.
//
// Schema is read fresh per request from <catalog>.information_schema.columns,
// scoped to a single schema (introspecting a whole catalog is slow and
// blows up the prompt). No PII-aware sample-value mining in this first pass
// (same scope decision as sqlEngines/postgres.js) — name+type only.
//
// The connection is opened lazily and reused. If a statement fails with a
// transport-level error the session is dropped so the next request
// reconnects (warehouses auto-stop, tokens get rotated). A SQL error from
// the warehouse itself is just rethrown, which feeds the repair loop.

import { DBSQLClient } from "@databricks/sql";

// information_schema stores identifiers as written; Unity Catalog names are
// lowercase by default. Backtick-quoting is how Databricks escapes names.
function quoteIdent(name) {
  return "`" + String(name).replaceAll("`", "``") + "`";
}

// The driver returns BIGINT as a JS bigint (or Int64 wrapper), DECIMAL as a
// string or Decimal-like, and DATE/TIMESTAMP as Date. res.json() throws on
// raw bigint, so normalize everything JSON-unsafe here.
function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") {
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(v)
      : v.toString();
  }
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("hex");
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (typeof v === "object") {
    // Int64 wrappers expose toString/valueOf; nested STRUCT/MAP are plain objects.
    if (typeof v.toJSON === "function") return normalizeValue(v.toJSON());
    if (v.constructor && v.constructor !== Object) return String(v);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeValue(x)]));
  }
  return v;
}

// Spark / Databricks EXPLAIN COST prints Statistics(sizeInBytes=…, rowCount=…).
// Prefer the last (outermost) match — that is usually the full-plan estimate.
const SIZE_RE = /sizeInBytes\s*=\s*([0-9.]+)\s*([KMGTP]?i?B)/gi;
const ROWS_RE = /rowCount\s*=\s*([0-9.]+(?:[eE][+-]?\d+)?)/gi;

function parseSizeToBytes(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const u = (unit || "B").toUpperCase();
  const mult =
    u === "B" ? 1
    : u === "KIB" || u === "KB" ? 1024
    : u === "MIB" || u === "MB" ? 1024 ** 2
    : u === "GIB" || u === "GB" ? 1024 ** 3
    : u === "TIB" || u === "TB" ? 1024 ** 4
    : u === "PIB" || u === "PB" ? 1024 ** 5
    : 1;
  return Math.round(n * mult);
}

// Serverless / Pro SQL warehouse DBU per hour per cluster, by size. From
// Databricks' published SQL warehouse sizing table (not exposed in a system
// table). Cross-checked against system.billing.usage: no hourly total for
// a 2X-Small warehouse here exceeds 4 DBU.
const DBU_PER_HOUR = {
  "2X_SMALL": 4, X_SMALL: 6, SMALL: 12, MEDIUM: 24, LARGE: 40,
  X_LARGE: 80, "2X_LARGE": 144, "3X_LARGE": 272, "4X_LARGE": 528,
};
const PROFILE_TTL_MS = 15 * 60 * 1000;
const PROFILE_FAIL_TTL_MS = 60 * 1000;
// Used only when system.query.history has too few comparable queries.
const FALLBACK_ROWS_PER_MS = 2000;
const MIN_HISTORY_SAMPLES = 5;

export function parseExplainCost(planText) {
  const text = String(planText || "");
  // Data consumption ≈ largest sizeInBytes in the plan (typically a Relation
  // scan). Outermost Aggregate stats are often tiny output estimates.
  let sizeInBytes = null;
  let sizeLabel = null;
  let m;
  SIZE_RE.lastIndex = 0;
  while ((m = SIZE_RE.exec(text)) !== null) {
    const bytes = parseSizeToBytes(m[1], m[2]);
    if (bytes != null && (sizeInBytes == null || bytes > sizeInBytes)) {
      sizeInBytes = bytes;
      sizeLabel = `${m[1]} ${m[2]}`;
    }
  }
  // Result-row estimate: last (outermost) rowCount in the plan.
  let rowCount = null;
  // Rows the plan has to read: the largest rowCount anywhere in the plan
  // (a base-table Relation), as opposed to rowCount above, which is the
  // outermost node, i.e. the RESULT size. Drives the cost estimate.
  let scanRows = null;
  ROWS_RE.lastIndex = 0;
  while ((m = ROWS_RE.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) {
      rowCount = n;
      if (scanRows == null || n > scanRows) scanRows = n;
    }
  }
  return {
    scanRows,
    sizeInBytes,
    sizeLabel,
    rowCount,
    rawPlan: text,
  };
}

export class DatabricksSqlEngine {
  constructor({ host, httpPath, token, catalog, schema, maxRows }) {
    this.host = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    this.httpPath = httpPath;
    // .trim(): a trailing newline from a pasted secret otherwise surfaces as
    // "not a legal HTTP header value" (same reason server.js trims LLM keys).
    this.token = token.trim();
    this.catalog = catalog;
    this.schemaName = schema;
    this.maxRows = Number(maxRows) || 1000;
    this.client = null;
    this.session = null;
  }

  async getSession() {
    if (this.session) return this.session;
    const client = new DBSQLClient();
    await client.connect({ host: this.host, path: this.httpPath, token: this.token });
    try {
      this.session = await client.openSession({
        initialCatalog: this.catalog,
        initialSchema: this.schemaName,
      });
    } catch (exc) {
      await client.close().catch(() => {});
      throw exc;
    }
    this.client = client;
    return this.session;
  }

  async reset() {
    const { session, client } = this;
    this.session = null;
    this.client = null;
    await session?.close().catch(() => {});
    await client?.close().catch(() => {});
  }

  async execute(sql) {
    const session = await this.getSession();
    let op;
    try {
      op = await session.executeStatement(sql, { runAsync: true, maxRows: 10000 });
      const rows = await op.fetchAll();
      let columns = [];
      try {
        const meta = await op.getSchema();
        columns = (meta?.columns || []).map((c) => c.columnName);
      } catch {
        columns = rows.length ? Object.keys(rows[0]) : [];
      }
      return { columns, rows };
    } catch (exc) {
      // Only drop the session for connection-level failures. A bad query
      // (syntax error, missing column) must leave it intact for the repair retry.
      const msg = String(exc?.message || exc);
      if (/ECONN|ETIMEDOUT|ENOTFOUND|socket|session|closed|expired|401|403|400|bad HTTP status/i.test(msg)) {
        await this.reset();
      }
      throw exc;
    } finally {
      await op?.close().catch(() => {});
    }
  }

  // Streams the FULL result in batches (no maxRows cap) for CSV export, so
  // a large result never has to fit in memory. onBatch(columns, rows) is
  // awaited per batch, which gives the HTTP response backpressure.
  async streamRows(sql, onBatch, batchSize = 10000) {
    const session = await this.getSession();
    let op;
    try {
      op = await session.executeStatement(sql, { runAsync: true, maxRows: batchSize });
      let columns = [];
      try {
        columns = ((await op.getSchema())?.columns || []).map((c) => c.columnName);
      } catch {
        // fall back to the first batch's keys below
      }
      let total = 0;
      do {
        const chunk = await op.fetchChunk({ maxRows: batchSize });
        if (!columns.length && chunk.length) columns = Object.keys(chunk[0]);
        const rows = chunk.map((r) => Object.fromEntries(columns.map((c) => [c, normalizeValue(r[c])])));
        await onBatch(columns, rows);
        total += rows.length;
      } while (await op.hasMoreRows());
      return total;
    } finally {
      await op?.close().catch(() => {});
    }
  }

  async getSchema() {
    const { rows } = await this.execute(
      `SELECT table_name, column_name, data_type
       FROM ${quoteIdent(this.catalog)}.information_schema.columns
       WHERE table_schema = '${this.schemaName.replaceAll("'", "''")}'
       ORDER BY table_name, ordinal_position`
    );
    const schema = {};
    for (const row of rows) {
      if (!schema[row.table_name]) schema[row.table_name] = [];
      schema[row.table_name].push({ name: row.column_name, type: row.data_type });
    }
    return schema;
  }

  // Names, types and comments from Unity Catalog information_schema; no table is read. Used by `db-agent scan`.
  // Primary and foreign keys are read when the catalog declares them, and skipped otherwise.
  async getMetadata() {
    const cat = quoteIdent(this.catalog);
    const sch = this.schemaName.replaceAll("'", "''");
    const { rows } = await this.execute(
      `SELECT c.table_name, c.column_name, c.data_type, c.comment AS column_comment, t.comment AS table_comment
       FROM ${cat}.information_schema.columns c
       LEFT JOIN ${cat}.information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = '${sch}'
       ORDER BY c.table_name, c.ordinal_position`
    );
    const tables = {};
    for (const r of rows) {
      const t = (tables[r.table_name] ||= { comment: r.table_comment || null, rowEstimate: null, columns: [], foreignKeys: [] });
      t.columns.push({ name: r.column_name, type: r.data_type, comment: r.column_comment || null, primaryKey: false });
    }
    try {
      const keys = await this.execute(
        `SELECT tc.constraint_type, k.table_name, k.column_name, r.table_name AS ref_table, r.column_name AS ref_column
         FROM ${cat}.information_schema.table_constraints tc
         JOIN ${cat}.information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
         LEFT JOIN ${cat}.information_schema.constraint_column_usage r ON r.constraint_name = tc.constraint_name AND tc.constraint_type = 'FOREIGN KEY'
         WHERE tc.table_schema = '${sch}' AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`
      );
      for (const r of keys.rows) {
        const t = tables[r.table_name];
        if (!t) continue;
        if (r.constraint_type === "PRIMARY KEY") {
          const col = t.columns.find((c) => c.name === r.column_name);
          if (col) col.primaryKey = true;
        } else if (r.ref_table) t.foreignKeys.push({ column: r.column_name, refTable: r.ref_table, refColumn: r.ref_column });
      }
    } catch {
      // keys are optional metadata
    }
    return { tables };
  }

  async runQuery(sql) {
    const { columns, rows } = await this.execute(sql);
    // Cap result size so a runaway SELECT can't flood the response/UI. The
    // warehouse still executes the full query; add a LIMIT via the prompt
    // or knowledge file to avoid the compute cost.
    const capped = rows.length > this.maxRows ? rows.slice(0, this.maxRows) : rows;
    return { columns, rows: capped.map((r) => Object.fromEntries(columns.map((c) => [c, normalizeValue(r[c])]))) };
  }

  get warehouseId() {
    return String(this.httpPath).split("/").filter(Boolean).pop();
  }

  async safeRows(sql) {
    try {
      return (await this.execute(sql)).rows;
    } catch (exc) {
      return { error: String(exc?.message || exc).split("\n")[0].slice(0, 200) };
    }
  }

  // Everything the estimate needs from system tables, cached because it
  // changes slowly (warehouse config, list price, historical throughput).
  async getCostProfile() {
    const now = Date.now();
    if (this.costProfile && now < this.costProfile.expires) return this.costProfile.value;

    const wh = `'${this.warehouseId.replaceAll("'", "''")}'`;
    const [warehouse, usage, tput, small] = await Promise.all([
      this.safeRows(`SELECT warehouse_type, warehouse_size, min_clusters, max_clusters
        FROM system.compute.warehouses WHERE warehouse_id = ${wh} ORDER BY change_time DESC LIMIT 1`),
      this.safeRows(`SELECT sku_name FROM system.billing.usage
        WHERE usage_metadata.warehouse_id = ${wh} ORDER BY usage_start_time DESC LIMIT 1`),
      this.safeRows(`SELECT COUNT(*) AS n,
          percentile(read_rows / execution_duration_ms, 0.25) AS p25,
          percentile(read_rows / execution_duration_ms, 0.5) AS p50,
          percentile(read_rows / execution_duration_ms, 0.75) AS p75
        FROM system.query.history
        WHERE compute.warehouse_id = ${wh} AND statement_type = 'SELECT' AND execution_status = 'FINISHED'
          AND NOT from_result_cache AND read_rows >= 100000 AND execution_duration_ms > 0
          AND start_time > current_timestamp() - INTERVAL 30 DAYS`),
      this.safeRows(`SELECT COUNT(*) AS n, percentile(execution_duration_ms, 0.5) AS med_ms
        FROM system.query.history
        WHERE compute.warehouse_id = ${wh} AND statement_type = 'SELECT' AND execution_status = 'FINISHED'
          AND NOT from_result_cache AND read_rows < 100000
          AND start_time > current_timestamp() - INTERVAL 30 DAYS`),
    ]);

    const value = { notes: [] };
    const w = Array.isArray(warehouse) ? warehouse[0] : null;
    if (!w) value.notes.push(`Warehouse config unavailable (${warehouse?.error || "no row"}).`);
    value.size = w?.warehouse_size || null;
    value.type = w?.warehouse_type || null;
    value.dbuPerHour = DBU_PER_HOUR[value.size] ?? null;

    let sku = Array.isArray(usage) ? usage[0]?.sku_name : null;
    if (!sku) value.notes.push("No billing history for this warehouse yet, so the price SKU could not be confirmed.");
    if (!sku && value.type) {
      sku = value.type === "SERVERLESS" ? "PREMIUM_SERVERLESS_SQL_COMPUTE" : value.type === "PRO" ? "PREMIUM_SQL_PRO_COMPUTE" : null;
      if (sku) value.skuGuessed = true;
    }
    value.sku = sku || null;
    if (sku) {
      const p = await this.safeRows(`SELECT pricing.default AS price FROM system.billing.list_prices
        WHERE sku_name = '${sku.replaceAll("'", "''")}' AND price_end_time IS NULL LIMIT 1`);
      value.pricePerDbu = Array.isArray(p) && p[0] ? Number(p[0].price) : null;
      if (value.pricePerDbu == null) value.notes.push(`List price lookup failed (${p?.error || "no row"}).`);
    }

    const t = Array.isArray(tput) ? tput[0] : null;
    const nT = Number(t?.n || 0);
    if (nT >= MIN_HISTORY_SAMPLES && Number(t.p50) > 0) {
      value.rowsPerMs = { p25: Number(t.p25), p50: Number(t.p50), p75: Number(t.p75) };
      value.samples = nT;
    } else {
      value.rowsPerMs = { p25: FALLBACK_ROWS_PER_MS / 2, p50: FALLBACK_ROWS_PER_MS, p75: FALLBACK_ROWS_PER_MS * 2 };
      value.samples = nT;
      value.assumedThroughput = true;
      value.notes.push(`Only ${nT} comparable past queries in system.query.history; assumed ${FALLBACK_ROWS_PER_MS} rows/ms.`);
    }
    const sm = Array.isArray(small) ? small[0] : null;
    value.overheadMs = Number(sm?.med_ms) > 0 && Number(sm?.n) >= MIN_HISTORY_SAMPLES ? Number(sm.med_ms) : 300;

    const ok = value.dbuPerHour != null && value.pricePerDbu != null;
    this.costProfile = { value, expires: now + (ok ? PROFILE_TTL_MS : PROFILE_FAIL_TTL_MS) };
    return value;
  }

  // Marginal compute cost = predicted runtime x warehouse DBU rate x list
  // price. Runtime = typical small-query overhead + rows scanned / observed
  // throughput (p25..p75 of this warehouse's own past queries gives the range).
  // This is an estimate of the query's share of warehouse time, NOT what
  // appears on the bill: serverless bills the warehouse while it is running,
  // including startup and idle time before auto-stop.
  async estimateCost(plan) {
    const p = await this.getCostProfile();
    const base = { warehouseSize: p.size, warehouseType: p.type, sku: p.sku, dbuPerHour: p.dbuPerHour,
      pricePerDbu: p.pricePerDbu, historySamples: p.samples, notes: [...p.notes] };
    if (p.dbuPerHour == null || p.pricePerDbu == null) {
      return { ...base, error: "Not enough system-table data to price this query." };
    }
    if (plan.scanRows == null) {
      return { ...base, error: "Optimizer gave no row estimate (table statistics missing), so runtime can't be predicted." };
    }
    const msFor = (rowsPerMs) => p.overheadMs + plan.scanRows / rowsPerMs;
    const usd = (ms) => (ms / 3_600_000) * p.dbuPerHour * p.pricePerDbu;
    const durationMs = msFor(p.rowsPerMs.p50);
    const lowMs = msFor(p.rowsPerMs.p75);
    const highMs = msFor(p.rowsPerMs.p25);
    if (p.skuGuessed) base.notes.push(`Price SKU assumed to be ${p.sku} (region unknown).`);
    return {
      ...base,
      usd: usd(durationMs), usdLow: usd(lowMs), usdHigh: usd(highMs),
      dbu: (durationMs / 3_600_000) * p.dbuPerHour,
      durationMs: Math.round(durationMs),
      scanRows: plan.scanRows,
      confidence: p.assumedThroughput || p.skuGuessed ? "low" : p.samples >= 20 ? "moderate" : "low",
    };
  }

  // Uses Databricks/Spark EXPLAIN COST — no custom cost model. Estimates
  // sizeInBytes / rowCount from the plan text when the optimizer has stats.
  async analyzeQuery(sql) {
    const trimmed = String(sql || "").trim().replace(/;+\s*$/, "");
    if (!trimmed) {
      return { sizeInBytes: null, sizeLabel: null, rowCount: null, rawPlan: "", error: "empty SQL" };
    }
    const { rows } = await this.execute(`EXPLAIN COST ${trimmed}`);
    const planText = rows
      .map((r) => Object.values(r).map((v) => (v == null ? "" : String(v))).join(" "))
      .join("\n");
    // Databricks reports planning failures (missing table/column) as plan
    // text, not an exception. Surface it so the repair loop can fix the SQL.
    if (/Error occurred during query planning|\[[A-Z_]+\] .*SQLSTATE/.test(planText)) {
      const err = new Error(planText.split("\n").slice(0, 4).join(" ").trim());
      err.planningError = true;
      throw err;
    }
    const plan = parseExplainCost(planText);
    try {
      plan.cost = await this.estimateCost(plan);
    } catch (exc) {
      plan.cost = { error: String(exc?.message || exc).split("\n")[0].slice(0, 200) };
    }
    return plan;
  }

  describe() {
    return {
      type: "databricks-sql",
      location: `https://${this.host}${this.httpPath} (${this.catalog}.${this.schemaName})`,
      endpoint: this.host,
      catalog: this.catalog,
      schema: this.schemaName,
      httpPath: this.httpPath,
    };
  }
}
