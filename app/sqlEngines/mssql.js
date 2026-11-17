// sqlEngines/mssql.js — Microsoft SQL Server (2016+, Azure SQL Database, Azure
// SQL Managed Instance), via the `mssql` driver (tedious underneath: pure
// JavaScript, no ODBC driver or native build needed).
//
// Same shape as sqlEngines/postgres.js: schema read fresh per request from
// INFORMATION_SCHEMA, getMetadata() for `db-agent scan`, runQuery() capped at
// maxRows, streamRows() for CSV export. No analyzeQuery() in this first pass,
// so server.js runs queries directly (as it does for sqlite / minio-duckdb).
//
// Read-only: SQL Server has no READ ONLY transaction mode, so every query runs
// inside a transaction that is always rolled back, on top of sqlSafety.js's
// SELECT-only check. The real guard is the login: give it db_datareader only.
//
// Table naming: SQL Server has no search_path, so an unqualified name only
// resolves in the login's default schema (normally dbo). Names are therefore
// schema-qualified ("Sales.Customer") whenever the configured schema is not
// just "dbo", so the SQL the model writes resolves regardless of the login.

import sql from "mssql";

// Strips credentials out of a connection string for display/logging. Handles
// both URL form (mssql://user:pw@host/db) and ADO form (Server=...;Password=...).
export function redactMssqlConnectionString(connectionString) {
  const s = String(connectionString || "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      url.username = "";
      url.password = "";
      return url.toString();
    } catch {
      return "mssql://<unparsed-connection-string>";
    }
  }
  return s
    .split(";")
    .filter((part) => part.trim() && !/^\s*(password|pwd|user\s*id|uid|user)\s*=/i.test(part))
    .join(";");
}

// Schema setting: one schema (default dbo), a comma list, or "*" for every user schema.
export function parseSchemaSetting(schema) {
  const wanted = String(schema || "dbo").split(",").map((x) => x.trim()).filter(Boolean);
  const allSchemas = wanted.includes("*");
  const schemaNames = allSchemas ? [] : wanted.length ? wanted : ["dbo"];
  const qualify = allSchemas || schemaNames.length > 1 || schemaNames[0].toLowerCase() !== "dbo";
  return { allSchemas, schemaNames, qualify };
}

const bool = (v, fallback) => {
  if (v == null || v === "") return fallback;
  return String(v).toLowerCase() === "true";
};

// varbinary/image columns come back as Buffers; show them as 0x… hex like SSMS does.
const normalizeValue = (v) => (Buffer.isBuffer(v) ? `0x${v.toString("hex").toUpperCase()}` : v);

// SQL Server leaves computed columns without an alias unnamed (SELECT COUNT(*) has
// column name ""), and allows the same name twice. Give every column a usable,
// unique name: unnamed ones become column1, column2, … by position (as SSMS shows
// "(No column name)"), and repeats get a _2, _3 suffix instead of overwriting.
export function columnNames(rawNames) {
  const used = new Set();
  return rawNames.map((raw, i) => {
    const base = raw ? String(raw) : `column${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name); k += 1) name = `${base}_${k}`;
    used.add(name);
    return name;
  });
}

// Runs `sqlText` on a streaming mssql Request. Without onBatch, collects up to
// maxRows rows and cancels the rest (a runaway SELECT never loads fully into
// memory). With onBatch(columns, rows), hands rows over in batches, pausing the
// request while each batch is awaited (backpressure for CSV export).
// In stream mode mssql emits 'error' (if any) and then always 'done'.
export function streamRequest(request, sqlText, { maxRows = Infinity, batchSize = Infinity, onBatch = null } = {}) {
  return new Promise((resolve, reject) => {
    request.stream = true;
    request.arrayRowMode = true; // rows as arrays, so unnamed/duplicate columns keep their values
    let columns = [];
    let rows = [];
    let total = 0;
    let cancelled = false;
    let failure = null;
    let settled = false;
    let chain = Promise.resolve();

    const stop = (err) => {
      if (err && !failure) failure = err;
      if (cancelled) return;
      cancelled = true;
      try { request.cancel(); } catch { /* already finished */ }
    };

    request.on("recordset", (cols) => {
      if (columns.length) return;
      const list = Array.isArray(cols) ? cols : Object.values(cols || {});
      columns = columnNames([...list].sort((a, b) => a.index - b.index).map((c) => c.name));
    });

    request.on("row", (values) => {
      if (cancelled) return;
      const row = {};
      if (Array.isArray(values)) columns.forEach((name, i) => { row[name] = normalizeValue(values[i]); });
      else for (const [k, v] of Object.entries(values || {})) row[k] = normalizeValue(v);
      rows.push(row);
      total += 1;
      if (onBatch && rows.length >= batchSize) {
        const batch = rows;
        rows = [];
        request.pause();
        chain = chain.then(() => onBatch(columns, batch)).then(
          () => { if (!cancelled) request.resume(); },
          (err) => { stop(err); request.resume(); }
        );
      }
      if (total >= maxRows) stop(null);
    });

    request.on("error", (err) => {
      // The cancel we issued ourselves after maxRows is not an error.
      if (cancelled && err && err.code === "ECANCEL") return;
      if (!failure) failure = err;
    });

    request.on("done", () => {
      if (settled) return;
      settled = true;
      chain
        .then(async () => {
          if (failure) throw failure;
          if (onBatch) {
            if (rows.length) await onBatch(columns, rows);
            else if (total === 0) await onBatch(columns, []); // header-only file for a zero-row result
            rows = [];
          }
          resolve({ columns, rows: onBatch ? [] : rows, total });
        })
        .catch(reject);
    });

    request.query(sqlText, () => {});
  });
}

export class MssqlEngine {
  constructor({
    connectionString, server, port, instanceName, database, user, password,
    encrypt, trustServerCertificate, schema, maxRows, requestTimeoutMs, connectTimeoutMs,
  }) {
    const s = parseSchemaSetting(schema);
    this.allSchemas = s.allSchemas;
    this.schemaNames = s.schemaNames;
    this.qualify = s.qualify;
    this.schemaName = this.allSchemas ? "*" : this.schemaNames[0];
    this.maxRows = Number(maxRows) || 1000;
    const requestTimeout = Number(requestTimeoutMs) || 120000;
    // Azure SQL serverless / free tier pauses when idle and can take close to a
    // minute to resume, longer than the driver's 15 s default connect timeout.
    const connectionTimeout = Number(connectTimeoutMs) || 60000;
    const schemaLabel = this.allSchemas ? "*" : this.schemaNames.join(",");

    if (connectionString) {
      const parsed = sql.ConnectionPool.parseConnectionString(connectionString);
      this.config = {
        ...parsed,
        requestTimeout: parsed.requestTimeout ?? requestTimeout,
        connectionTimeout: parsed.connectionTimeout ?? connectionTimeout,
      };
      this.displayLocation = `${redactMssqlConnectionString(connectionString)} (schema=${schemaLabel})`;
    } else {
      this.config = {
        server,
        port: instanceName ? undefined : Number(port) || 1433,
        database,
        user,
        password,
        requestTimeout,
        connectionTimeout,
        options: {
          encrypt: bool(encrypt, true),
          trustServerCertificate: bool(trustServerCertificate, false),
          ...(instanceName ? { instanceName } : {}),
        },
      };
      const where = instanceName ? `${server}\\${instanceName}` : `${server}:${this.config.port}`;
      this.displayLocation = `mssql://${where}/${database}?schema=${schemaLabel}`;
    }
    this.pool = null;
    this.connecting = null;
  }

  async getPool() {
    if (this.pool?.connected) return this.pool;
    if (!this.connecting) {
      const pool = new sql.ConnectionPool(this.config);
      pool.on("error", () => {}); // idle-connection errors must not crash the process
      this.connecting = pool.connect().then(
        (p) => { this.pool = p; this.connecting = null; return p; },
        (err) => { this.connecting = null; throw err; }
      );
    }
    return this.connecting;
  }

  async reset() {
    const pool = this.pool;
    this.pool = null;
    await pool?.close().catch(() => {});
  }

  // Adds @s0, @s1, ... inputs for the configured schemas and returns the SQL filter on `column`.
  schemaFilter(request, column) {
    if (this.allSchemas) return `${column} NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') AND ${column} NOT LIKE 'db[_]%'`;
    const names = this.schemaNames.map((name, i) => {
      request.input(`s${i}`, sql.NVarChar, name);
      return `@s${i}`;
    });
    return `${column} IN (${names.join(", ")})`;
  }

  tableKey(schemaName, tableName) {
    return this.qualify ? `${schemaName}.${tableName}` : tableName;
  }

  async getSchema() {
    const pool = await this.getPool();
    const request = pool.request();
    const { recordset } = await request.query(
      `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE ${this.schemaFilter(request, "TABLE_SCHEMA")}
       ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`
    );
    const schema = {};
    for (const row of recordset) {
      const table = this.tableKey(row.table_schema, row.table_name);
      (schema[table] ||= []).push({ name: row.column_name, type: row.data_type });
    }
    return schema;
  }

  // Names, types, MS_Description comments, row estimates and declared keys only:
  // no table is read. Used by `db-agent scan`. Same table naming as getSchema().
  async getMetadata() {
    const pool = await this.getPool();

    const colReq = pool.request();
    const { recordset: cols } = await colReq.query(
      `SELECT s.name AS table_schema, o.name AS table_name, o.type AS obj_type,
              c.name AS column_name, TYPE_NAME(c.user_type_id) AS data_type,
              CAST(cep.value AS nvarchar(4000)) AS column_comment,
              CAST(tep.value AS nvarchar(4000)) AS table_comment,
              (SELECT SUM(p.rows) FROM sys.partitions p
                WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS row_estimate
       FROM sys.objects o
       JOIN sys.schemas s ON s.schema_id = o.schema_id
       JOIN sys.columns c ON c.object_id = o.object_id
       LEFT JOIN sys.extended_properties tep
         ON tep.class = 1 AND tep.major_id = o.object_id AND tep.minor_id = 0 AND tep.name = 'MS_Description'
       LEFT JOIN sys.extended_properties cep
         ON cep.class = 1 AND cep.major_id = o.object_id AND cep.minor_id = c.column_id AND cep.name = 'MS_Description'
       WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0 AND ${this.schemaFilter(colReq, "s.name")}
       ORDER BY s.name, o.name, c.column_id`
    );
    const tables = {};
    for (const r of cols) {
      const t = (tables[this.tableKey(r.table_schema, r.table_name)] ||= {
        kind: r.obj_type.trim() === "V" ? "view" : "table",
        comment: r.table_comment || null,
        rowEstimate: r.obj_type.trim() === "U" && r.row_estimate != null ? Number(r.row_estimate) : null,
        columns: [],
        foreignKeys: [],
      });
      t.columns.push({ name: r.column_name, type: r.data_type, comment: r.column_comment || null, primaryKey: false });
    }

    const pkReq = pool.request();
    const { recordset: pks } = await pkReq.query(
      `SELECT s.name AS table_schema, o.name AS table_name, c.name AS column_name
       FROM sys.indexes i
       JOIN sys.objects o ON o.object_id = i.object_id
       JOIN sys.schemas s ON s.schema_id = o.schema_id
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE i.is_primary_key = 1 AND ${this.schemaFilter(pkReq, "s.name")}`
    );
    for (const r of pks) {
      const col = tables[this.tableKey(r.table_schema, r.table_name)]?.columns.find((c) => c.name === r.column_name);
      if (col) col.primaryKey = true;
    }

    const fkReq = pool.request();
    const { recordset: fks } = await fkReq.query(
      `SELECT ps.name AS table_schema, po.name AS table_name, pc.name AS column_name,
              rs.name AS ref_schema, ro.name AS ref_table, rc.name AS ref_column
       FROM sys.foreign_key_columns fkc
       JOIN sys.objects po ON po.object_id = fkc.parent_object_id
       JOIN sys.schemas ps ON ps.schema_id = po.schema_id
       JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.objects ro ON ro.object_id = fkc.referenced_object_id
       JOIN sys.schemas rs ON rs.schema_id = ro.schema_id
       JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       WHERE ${this.schemaFilter(fkReq, "ps.name")}`
    );
    for (const r of fks) {
      const t = tables[this.tableKey(r.table_schema, r.table_name)];
      if (t) t.foreignKeys.push({ column: r.column_name, refTable: this.tableKey(r.ref_schema, r.ref_table), refColumn: r.ref_column });
    }
    return { tables };
  }

  // Runs fn(request) inside a transaction that is always rolled back.
  async withRollback(fn) {
    const pool = await this.getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      return await fn(new sql.Request(tx));
    } finally {
      await tx.rollback().catch(() => {});
    }
  }

  async runQuery(sqlText) {
    const { columns, rows } = await this.withRollback((request) =>
      streamRequest(request, sqlText, { maxRows: this.maxRows })
    );
    return { columns, rows };
  }

  // Streams the FULL result in batches for CSV export. onBatch(columns, rows)
  // is awaited per batch, which gives the HTTP response backpressure.
  async streamRows(sqlText, onBatch, batchSize = 10000) {
    const { total } = await this.withRollback((request) =>
      streamRequest(request, sqlText, { batchSize, onBatch })
    );
    return total;
  }

  describe() {
    return { type: "mssql", location: this.displayLocation };
  }
}
