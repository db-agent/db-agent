// sqlEngines/index.js — registry of pluggable SQL query engines. Mirrors
// memoryBackends/index.js's registry pattern exactly (same shape, same
// reasoning) — see that file if this one is unclear. Adding a new engine
// means writing sqlEngines/foo.js implementing getSchema()/runQuery(),
// adding one entry below, and nothing in server.js needs to change.
//
// Every engine implements the same interface:
//   getSchema() -> schema | Promise<schema>
//     Same shape server.js's formatSchema()/buildUserPrompt() already
//     expect: { [table]: [{ name, type, sampleValues? }] }.
//   runQuery(sql) -> { columns, rows } | Promise<{ columns, rows }>
//     `sql` is already validated (sqlSafety.js) and, on repair attempts,
//     may be a retried statement — the engine just executes it.

import path from "node:path";
import { SQLiteEngine } from "./sqlite.js";
import { MinioDuckDBEngine } from "./minioDuckdb.js";

const REGISTRY = {
  sqlite: {
    description: "Node's built-in node:sqlite against a local file. The default.",
    create: (env, { dataDir }) =>
      new SQLiteEngine({
        dbPath: env.DB_PATH || path.join(dataDir, "demo.db"),
      }),
  },
  "minio-duckdb": {
    description:
      "Parquet files in MinIO (or any S3-compatible object store), queried through DuckDB's httpfs extension.",
    create: (env) => {
      if (!env.MINIO_ENDPOINT || !env.MINIO_BUCKET) {
        throw new Error(
          'SQL_ENGINE=minio-duckdb requires MINIO_ENDPOINT and MINIO_BUCKET to be set (see .env.example).'
        );
      }
      return new MinioDuckDBEngine({
        endpoint: env.MINIO_ENDPOINT,
        bucket: env.MINIO_BUCKET,
        prefix: env.MINIO_PREFIX || "",
        accessKey: env.MINIO_ACCESS_KEY || "",
        secretKey: env.MINIO_SECRET_KEY || "",
        useSsl: (env.MINIO_USE_SSL || "false").toLowerCase() === "true",
        region: env.MINIO_REGION || "us-east-1",
      });
    },
  },
};

export function listSqlEngines() {
  return Object.entries(REGISTRY).map(([name, { description }]) => ({ name, description }));
}

// `dataDir` is only used by the `sqlite` engine's default DB_PATH — kept as
// an explicit param (rather than each engine computing its own
// __dirname-relative path) so it's resolved the same way regardless of
// engine, same reasoning as memoryBackends/index.js's createMemoryBackend.
export function createSqlEngine(name, { env = process.env, dataDir } = {}) {
  const key = (name || "sqlite").toLowerCase();
  const entry = REGISTRY[key];
  if (!entry) {
    const available = Object.keys(REGISTRY).join(", ");
    throw new Error(`Unknown SQL_ENGINE "${name}" — available engines: ${available}`);
  }
  return entry.create(env, { dataDir });
}
