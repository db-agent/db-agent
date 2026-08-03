// memoryBackends/pgvector.js — any standard Postgres database with the
// pgvector extension available, via node-postgres (same driver as
// sqlEngines/postgres.js — reuses the dependency, adds nothing new).
// Covers Databricks Lakebase directly, which ships pgvector 0.8+ with both
// ivfflat and hnsw index types (verified against a real Lakebase instance
// before writing this).
//
// Cleaner than the other two vector backends in a few concrete ways, not
// just "another option": Postgres can do similarity ranking, TTL
// filtering, and self-exclusion in one indexed query (`ORDER BY embedding
// <=> $vector` combined with a plain `WHERE` clause) — S3VectorsBackend
// and MilvusBackend both over-fetch and filter client-side because their
// query APIs don't support that combination. And invalidateFollowup here
// is an exact match over a real array column, not a best-effort semantic
// lookup near the invalidated question's own embedding — Postgres just
// doesn't have the "vector search is the only way to find anything"
// limitation those two have.

import pg from "pg";
import { normalizeQuestion } from "../memory.js";

const { Pool } = pg;

function quoteIdent(id) {
  return `"${String(id).replace(/"/g, '""')}"`;
}

function sslOption(ssl) {
  // Same reasoning as sqlEngines/postgres.js's identical helper — managed
  // Postgres (Lakebase included) requires TLS, and its CA chain often
  // isn't in Node's default trust store.
  if (ssl === "strict") return true;
  if (ssl === "false") return false;
  return { rejectUnauthorized: false };
}

export class PgVectorBackend {
  constructor({ connectionString, host, port, database, user, password, ssl, dimension, table }) {
    this.dimension = dimension;
    this.table = table;
    this.pool = connectionString
      ? new Pool({ connectionString, ssl: sslOption(ssl) })
      : new Pool({ host, port: Number(port) || 5432, database, user, password, ssl: sslOption(ssl) });
    // Extension/table/index creation is async and can't happen in a
    // constructor — every public method awaits this first, same lazy-init
    // pattern as MilvusBackend.ensureCollection().
    this.ready = this.init();
  }

  async init() {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${quoteIdent(this.table)} (
        record_id TEXT PRIMARY KEY,
        source_agent TEXT NOT NULL,
        source_db_kind TEXT,
        created_at TEXT,
        ttl_epoch BIGINT,
        entities TEXT[],
        insight_summary TEXT,
        suggested_followups TEXT[],
        embedding VECTOR(${this.dimension})
      )
    `);
    // HNSW over ivfflat: builds incrementally (ivfflat needs representative
    // data present before it clusters well) and pgvector 0.8 (confirmed
    // available) supports it — better fit for a store that starts empty
    // and grows one write at a time.
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${quoteIdent(this.table + "_embedding_hnsw")}
      ON ${quoteIdent(this.table)} USING hnsw (embedding vector_cosine_ops)
    `);
  }

  async put(record, vector) {
    await this.ready;
    await this.pool.query(
      `INSERT INTO ${quoteIdent(this.table)}
        (record_id, source_agent, source_db_kind, created_at, ttl_epoch, entities, insight_summary, suggested_followups, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)`,
      [
        record.recordId,
        record.sourceAgent,
        record.sourceDbKind,
        record.createdAt,
        record.ttlEpoch,
        record.entities || [],
        record.insightSummary,
        record.suggestedFollowups || [],
        JSON.stringify(vector),
      ]
    );
  }

  async query(vector, { excludeAgent, topK }) {
    await this.ready;
    const now = Math.floor(Date.now() / 1000);
    const { rows } = await this.pool.query(
      `SELECT record_id, source_agent, source_db_kind, created_at, ttl_epoch, entities, insight_summary, suggested_followups
       FROM ${quoteIdent(this.table)}
       WHERE ttl_epoch > $1 AND source_agent != $2
       ORDER BY embedding <=> $3::vector
       LIMIT $4`,
      [now, excludeAgent, JSON.stringify(vector), topK]
    );
    return rows.map((r) => ({
      recordId: r.record_id,
      sourceAgent: r.source_agent,
      sourceDbKind: r.source_db_kind,
      createdAt: r.created_at,
      ttlEpoch: Number(r.ttl_epoch),
      entities: r.entities || [],
      insightSummary: r.insight_summary,
      suggestedFollowups: r.suggested_followups || [],
    }));
  }

  // Exact match over the real array column — no vector search needed here
  // at all, unlike the other two backends. Table sizes this is meant for
  // make a full scan of two columns cheap; only rows that actually change
  // get written back.
  async invalidateFollowup(questionText) {
    await this.ready;
    const target = normalizeQuestion(questionText);
    const { rows } = await this.pool.query(
      `SELECT record_id, suggested_followups FROM ${quoteIdent(this.table)}`
    );

    let removed = 0;
    for (const row of rows) {
      const followups = row.suggested_followups || [];
      const filtered = followups.filter((f) => normalizeQuestion(f) !== target);
      if (filtered.length === followups.length) continue;
      removed += followups.length - filtered.length;
      await this.pool.query(
        `UPDATE ${quoteIdent(this.table)} SET suggested_followups = $1 WHERE record_id = $2`,
        [filtered, row.record_id]
      );
    }
    return { removed };
  }
}
