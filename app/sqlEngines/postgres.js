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

export class PostgresEngine {
  constructor({ connectionString, host, port, database, user, password, ssl, schema }) {
    this.schemaName = schema || "public";

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

  async runQuery(sql) {
    const result = await this.pool.query(sql);
    const columns = result.fields.map((f) => f.name);
    return { columns, rows: result.rows };
  }

  describe() {
    return { type: "postgres", location: this.displayLocation };
  }
}
