// memoryBackends/index.js — registry of pluggable cross-platform-memory
// storage backends. Adding a new one (e.g. a future AIStor Memory backend,
// once it has a public/documented API) means: write memoryBackends/foo.js
// implementing put()/query()/invalidateFollowup(), add one entry below, and
// nothing in server.js or memory.js needs to change.
//
// Every backend implements the same interface:
//   put(record, vector) -> void | Promise<void>
//   query(vector, { excludeAgent, topK }) -> record[] | Promise<record[]>
//   invalidateFollowup(questionText, queryVector) -> { removed } | Promise<{ removed }>

import path from "node:path";
import { LocalJsonBackend } from "./local.js";
import { S3VectorsBackend } from "./s3vectors.js";
import { MilvusBackend } from "./milvus.js";

const REGISTRY = {
  local: {
    description: "JSONL file + cosine similarity. No cloud or server setup — the default.",
    create: (env, { dataDir }) =>
      new LocalJsonBackend(env.MEMORY_STORE_PATH || path.join(dataDir, "memory_store.jsonl")),
  },
  s3vectors: {
    description: "AWS S3 Vectors (preview). Requires a pre-provisioned vector bucket/index.",
    create: (env) =>
      new S3VectorsBackend({
        bucket: env.MEMORY_S3_BUCKET || "",
        index: env.MEMORY_ORG_ID || "demo-org",
        region: env.MEMORY_S3_REGION || "us-east-1",
      }),
  },
  milvus: {
    description: "Milvus (self-hosted or Zilliz Cloud). Auto-creates its collection/index on first use.",
    create: (env) =>
      new MilvusBackend({
        address: env.MILVUS_ADDRESS || "localhost:19530",
        collection: env.MEMORY_ORG_ID || "demo_org",
        // Must match EMBEDDING_MODEL's output dimension exactly — same
        // constraint as S3 Vectors' pre-provisioned index dimension, just
        // enforced here instead of in an out-of-band `aws s3vectors
        // create-index` call, since Milvus collections are created by this
        // code rather than provisioned separately.
        dimension: Number(env.MEMORY_VECTOR_DIM || 768),
        token: env.MILVUS_TOKEN,
        username: env.MILVUS_USERNAME,
        password: env.MILVUS_PASSWORD,
        ssl: (env.MILVUS_SSL || "false").toLowerCase() === "true",
      }),
  },
};

export function listMemoryBackends() {
  return Object.entries(REGISTRY).map(([name, { description }]) => ({ name, description }));
}

// `dataDir` is only used by the `local` backend's default file path — kept
// as an explicit param (rather than each backend computing its own
// __dirname-relative path) so every backend's storage location is
// resolved the same way, relative to server.js's own directory.
export function createMemoryBackend(name, { env = process.env, dataDir } = {}) {
  const key = (name || "local").toLowerCase();
  const entry = REGISTRY[key];
  if (!entry) {
    const available = Object.keys(REGISTRY).join(", ");
    throw new Error(`Unknown MEMORY_BACKEND "${name}" — available backends: ${available}`);
  }
  return entry.create(env, { dataDir });
}
