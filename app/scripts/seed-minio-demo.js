// scripts/seed-minio-demo.js — builds the demo dataset for the
// minio-duckdb SQL engine: exports the bundled SQLite demo.db's tables to
// Parquet (via DuckDB's sqlite extension, so no separate export tooling is
// needed) and uploads them to a running MinIO instance (via DuckDB's own
// S3 write support, so no `mc`/AWS CLI install is needed either).
//
// Same demo domain (customers/products/orders) as the SQLite default, on
// purpose — makes it easy to ask the same benchmark questions against
// either engine and compare, and means this needs zero new demo data design.
//
// Requires a running MinIO instance — see scripts/minio-demo-compose.yml:
//   docker compose -f scripts/minio-demo-compose.yml up -d
//   node scripts/seed-minio-demo.js
//
// Bucket must already exist (DuckDB's S3 writer doesn't create buckets).
// Defaults below match minio-demo-compose.yml's minioadmin/minioadmin and
// the bucket this script creates via the MinIO S3 API directly.

import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "demo.db");
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "localhost:9000";
const MINIO_BUCKET = process.env.MINIO_BUCKET || "demo-bucket";
const MINIO_PREFIX = process.env.MINIO_PREFIX || "db-agent-demo";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "minioadmin";
const MINIO_USE_SSL = (process.env.MINIO_USE_SSL || "false").toLowerCase() === "true";
const TABLES = ["customers", "products", "orders"];

function mcCommand(cmd) {
  const scheme = MINIO_USE_SSL ? "https" : "http";
  return (
    `mc alias set local ${scheme}://${MINIO_ENDPOINT} ${MINIO_ACCESS_KEY} ${MINIO_SECRET_KEY} ` +
    `>/dev/null && ${cmd}`
  );
}

// DuckDB's S3 writer needs the bucket to already exist — it can write
// objects but has no "create bucket" operation, and MinIO's bucket-creation
// endpoint requires a properly SigV4-signed request, which isn't worth
// hand-rolling here when the official minio/mc image already does it
// correctly. Shells out to a throwaway `minio/mc` container rather than
// requiring `mc` installed on the host, same reasoning as
// minio-demo-compose.yml using a container for MinIO itself: nothing extra
// to install beyond Docker, which running the demo at all already assumes.
function ensureBucket() {
  try {
    execSync(`docker run --rm --network host --entrypoint /bin/sh minio/mc -c "${mcCommand(`mc mb -p local/${MINIO_BUCKET}`)}"`, {
      stdio: "pipe",
    });
    return true;
  } catch (exc) {
    console.warn(
      `[seed-minio-demo] Could not create bucket "${MINIO_BUCKET}" automatically (${exc.message.split("\n")[0]}). ` +
        `Create it manually, then re-run this script:\n` +
        `  docker run --rm --network host --entrypoint /bin/sh minio/mc -c \\\n` +
        `    "mc alias set local http://${MINIO_ENDPOINT} ${MINIO_ACCESS_KEY} ${MINIO_SECRET_KEY} && mc mb local/${MINIO_BUCKET}"`
    );
    return false;
  }
}

async function main() {
  console.log(`Exporting ${TABLES.join(", ")} from ${DB_PATH} and uploading to ` +
    `${MINIO_USE_SSL ? "https" : "http"}://${MINIO_ENDPOINT}/${MINIO_BUCKET}/${MINIO_PREFIX}/ ...`);

  const bucketReady = await ensureBucket();
  if (!bucketReady) {
    console.warn(
      `[seed-minio-demo] Could not confirm bucket "${MINIO_BUCKET}" exists via a plain PUT ` +
        `(MinIO's default config often requires an authenticated request for this). If the ` +
        `upload below fails with "NoSuchBucket", create it first:\n` +
        `  docker run --rm --network host --entrypoint /bin/sh minio/mc -c \\\n` +
        `    "mc alias set local http://${MINIO_ENDPOINT} ${MINIO_ACCESS_KEY} ${MINIO_SECRET_KEY} && mc mb local/${MINIO_BUCKET}"`
    );
  }

  const instance = await DuckDBInstance.create();
  const conn = await instance.connect();

  await conn.run("INSTALL sqlite; LOAD sqlite; INSTALL httpfs; LOAD httpfs;");
  await conn.run(`ATTACH '${DB_PATH.replaceAll("'", "''")}' AS demo (TYPE sqlite);`);
  await conn.run(`
    SET s3_endpoint='${MINIO_ENDPOINT.replaceAll("'", "''")}';
    SET s3_access_key_id='${MINIO_ACCESS_KEY.replaceAll("'", "''")}';
    SET s3_secret_access_key='${MINIO_SECRET_KEY.replaceAll("'", "''")}';
    SET s3_url_style='path';
    SET s3_use_ssl=${MINIO_USE_SSL ? "true" : "false"};
    SET s3_region='us-east-1';
  `);

  for (const table of TABLES) {
    const dest = `s3://${MINIO_BUCKET}/${MINIO_PREFIX}/${table}.parquet`;
    await conn.run(`COPY demo.${table} TO '${dest}' (FORMAT parquet);`);
    console.log(`  uploaded ${table} -> ${dest}`);
  }

  console.log(
    `\nDone. Point db-agent at it with:\n` +
      `  SQL_ENGINE=minio-duckdb MINIO_ENDPOINT=${MINIO_ENDPOINT} MINIO_BUCKET=${MINIO_BUCKET} \\\n` +
      `    MINIO_PREFIX=${MINIO_PREFIX} MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY} MINIO_SECRET_KEY=${MINIO_SECRET_KEY} \\\n` +
      `    MINIO_USE_SSL=${MINIO_USE_SSL} ./run_local.sh`
  );
}

main().catch((exc) => {
  console.error(`Seeding failed: ${exc.message || exc}`);
  process.exit(1);
});
