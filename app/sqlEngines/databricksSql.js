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
      if (/ECONN|ETIMEDOUT|ENOTFOUND|socket|session|closed|expired|401|403/i.test(msg)) {
        await this.reset();
      }
      throw exc;
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

  async runQuery(sql) {
    const { columns, rows } = await this.execute(sql);
    // Cap result size so a runaway SELECT can't flood the response/UI. The
    // warehouse still executes the full query; add a LIMIT via the prompt
    // or knowledge file to avoid the compute cost.
    const capped = rows.length > this.maxRows ? rows.slice(0, this.maxRows) : rows;
    return { columns, rows: capped.map((r) => Object.fromEntries(columns.map((c) => [c, normalizeValue(r[c])]))) };
  }

  describe() {
    return {
      type: "databricks-sql",
      location: `https://${this.host}${this.httpPath} (${this.catalog}.${this.schemaName})`,
    };
  }
}
