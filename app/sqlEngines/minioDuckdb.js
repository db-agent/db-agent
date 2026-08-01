// sqlEngines/minioDuckdb.js — queries Parquet files stored in MinIO (or any
// other S3-compatible object store) via DuckDB's httpfs extension.
//
// MinIO holds no live database here, just Parquet objects under a bucket
// prefix. DuckDB is the query engine that makes them queryable through
// exactly the same getSchema()/runQuery() contract every other engine
// implements — the LLM-facing pipeline in server.js never knows the data
// lives in object storage rather than a real database.
//
// Convention: every `<prefix>/<table>.parquet` object directly under the
// configured bucket/prefix becomes one logical table named <table>, exposed
// as a DuckDB view over `read_parquet()`. That keeps the LLM's generated SQL
// identical to what it would write against a real table ("SELECT * FROM
// orders ...") — it never needs to know an S3 path or Parquet is involved.
// Partitioned/multi-file-per-table datasets aren't handled by this Phase 1
// (see app/README.md) — each table is exactly one Parquet object.

import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export class MinioDuckDBEngine {
  constructor({ endpoint, bucket, prefix, accessKey, secretKey, useSsl, region }) {
    this.bucket = bucket;
    // Normalize so joining with the bucket/table name never produces a
    // double slash regardless of how the env var was written.
    this.prefix = (prefix || "").replace(/^\/+|\/+$/g, "");
    this.tables = [];
    // DuckDB extension install/load and view creation are async and can't
    // happen in a constructor — every public method awaits this first.
    // Cached as a single promise, same lazy-init pattern as
    // memoryBackends/milvus.js's MilvusBackend, so concurrent calls before
    // the first one resolves don't race to reconnect or re-create views.
    this.ready = this.init({ endpoint, accessKey, secretKey, useSsl, region });
  }

  async init({ endpoint, accessKey, secretKey, useSsl, region }) {
    const instance = await DuckDBInstance.create(); // in-memory — DuckDB itself
    // stores nothing; every table is a view over Parquet objects in MinIO.
    this.connection = await instance.connect();

    await this.connection.run("INSTALL httpfs; LOAD httpfs;");
    // DuckDB's S3 settings work against any S3-compatible endpoint, not
    // just AWS — that's what makes MinIO usable here at all. s3_url_style
    // 'path' is required for MinIO (and most self-hosted S3-compatible
    // stores, e.g. bucket.example.com/key doesn't resolve for them); AWS S3
    // itself defaults to virtual-hosted style, which is why this isn't
    // DuckDB's own default.
    await this.connection.run(`
      SET s3_endpoint='${escapeSqlLiteral(endpoint)}';
      SET s3_access_key_id='${escapeSqlLiteral(accessKey)}';
      SET s3_secret_access_key='${escapeSqlLiteral(secretKey)}';
      SET s3_url_style='path';
      SET s3_use_ssl=${useSsl ? "true" : "false"};
      SET s3_region='${escapeSqlLiteral(region)}';
    `);

    await this.createViews();
  }

  s3Path(objectName) {
    const key = this.prefix ? `${this.prefix}/${objectName}` : objectName;
    return `s3://${this.bucket}/${key}`;
  }

  // Discovers tables once at startup (mirrors MilvusBackend's one-time
  // ensureCollection() call) rather than re-globbing on every request —
  // cheap either way at Parquet-file counts this is meant for, but this
  // keeps startup and query-time concerns separate. Adding/removing a
  // Parquet object under the prefix requires a server restart to pick up;
  // worth knowing before a live demo, not a hidden surprise.
  async createViews() {
    const globPattern = this.s3Path("*.parquet");
    const reader = await this.connection.runAndReadAll(
      `SELECT file FROM glob('${escapeSqlLiteral(globPattern)}')`
    );
    const files = reader.getRowObjectsJson().map((r) => String(r.file));

    this.tables = [];
    for (const filePath of files) {
      const table = path.posix.basename(filePath, ".parquet");
      await this.connection.run(
        `CREATE OR REPLACE VIEW ${quoteIdentifier(table)} AS SELECT * FROM read_parquet('${escapeSqlLiteral(filePath)}')`
      );
      this.tables.push(table);
    }

    if (this.tables.length === 0) {
      console.warn(
        `[sqlEngines/minio-duckdb] no .parquet objects found under ${globPattern} — schema will be empty`
      );
    }
  }

  async getSchema() {
    await this.ready;
    const schema = {};
    for (const table of this.tables) {
      const reader = await this.connection.runAndReadAll(`DESCRIBE ${quoteIdentifier(table)}`);
      schema[table] = reader.getRowObjectsJson().map((r) => ({
        name: String(r.column_name),
        type: String(r.column_type),
      }));
    }
    return schema;
  }

  async runQuery(sql) {
    await this.ready;
    // No table-name rewriting needed here — the views created in
    // createViews() mean the LLM's generated SQL (bare table names, exactly
    // like it would write for any other engine) runs against this
    // connection unmodified.
    const reader = await this.connection.runAndReadAll(sql);
    return { columns: reader.columnNames(), rows: reader.getRowObjectsJson() };
  }
}
