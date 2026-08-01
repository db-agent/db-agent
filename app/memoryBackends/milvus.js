// memoryBackends/milvus.js — Milvus (self-hosted or Zilliz Cloud) via
// @zilliz/milvus2-sdk-node.
//
// Unlike S3VectorsBackend, this backend auto-creates its collection/index on
// first use rather than expecting one pre-provisioned out of band — Milvus
// is commonly self-hosted for local/dev use (a single `docker run
// milvusdb/milvus` gets you a real server), so removing the "go provision
// something in a cloud console first" step matters more here than it does
// for AWS S3 Vectors, where provisioning is deliberately manual and
// IAM-scoped.
//
// Method names/shapes below were verified against the installed
// @zilliz/milvus2-sdk-node v3 type definitions (dist/milvus/types/*.d.ts),
// not written from memory — that package's API has shifted across majors.

import { MilvusClient, DataType } from "@zilliz/milvus2-sdk-node";
import { normalizeQuestion } from "../memory.js";

const RECORD_ID_FIELD = "recordId";
const VECTOR_FIELD = "vector";
const METADATA_OUTPUT_FIELDS = [
  "sourceAgent",
  "sourceDbKind",
  "createdAt",
  "ttlEpoch",
  "entities",
  "insightSummary",
  "suggestedFollowups",
];

export class MilvusBackend {
  constructor({ address, collection, dimension, token, username, password, ssl }) {
    this.collection = collection;
    this.dimension = dimension;
    this.client = new MilvusClient({
      address,
      ssl: !!ssl,
      ...(token ? { token } : {}),
      ...(username ? { username, password } : {}),
    });
    // Collection creation/loading is async and can't happen in a
    // constructor — every public method awaits this first. Cached as a
    // single promise so concurrent calls before the first one resolves
    // don't race to create the collection twice.
    this.ready = this.ensureCollection();
  }

  async ensureCollection() {
    const has = await this.client.hasCollection({ collection_name: this.collection });
    if (has.value) {
      await this.client.loadCollection({ collection_name: this.collection });
      return;
    }

    await this.client.createCollection({
      collection_name: this.collection,
      fields: [
        { name: RECORD_ID_FIELD, data_type: DataType.VarChar, is_primary_key: true, type_params: { max_length: 64 } },
        { name: VECTOR_FIELD, data_type: DataType.FloatVector, type_params: { dim: this.dimension } },
        { name: "sourceAgent", data_type: DataType.VarChar, type_params: { max_length: 256 } },
        { name: "sourceDbKind", data_type: DataType.VarChar, type_params: { max_length: 128 } },
        { name: "createdAt", data_type: DataType.VarChar, type_params: { max_length: 64 } },
        { name: "ttlEpoch", data_type: DataType.Int64 },
        {
          name: "entities",
          data_type: DataType.Array,
          element_type: DataType.VarChar,
          type_params: { max_length: 256, max_capacity: 64 },
        },
        { name: "insightSummary", data_type: DataType.VarChar, type_params: { max_length: 2048 } },
        {
          name: "suggestedFollowups",
          data_type: DataType.Array,
          element_type: DataType.VarChar,
          type_params: { max_length: 512, max_capacity: 16 },
        },
      ],
    });

    await this.client.createIndex({
      collection_name: this.collection,
      field_name: VECTOR_FIELD,
      index_type: "AUTOINDEX",
      metric_type: "COSINE",
    });

    await this.client.loadCollection({ collection_name: this.collection });
  }

  async put(record, vector) {
    await this.ready;
    await this.client.insert({
      collection_name: this.collection,
      data: [
        {
          [RECORD_ID_FIELD]: record.recordId,
          [VECTOR_FIELD]: vector,
          sourceAgent: record.sourceAgent,
          sourceDbKind: record.sourceDbKind,
          createdAt: record.createdAt,
          ttlEpoch: record.ttlEpoch,
          entities: record.entities || [],
          insightSummary: record.insightSummary,
          suggestedFollowups: record.suggestedFollowups || [],
        },
      ],
    });
  }

  async query(vector, { excludeAgent, topK }) {
    await this.ready;
    const now = Math.floor(Date.now() / 1000);
    const response = await this.client.search({
      collection_name: this.collection,
      data: [vector],
      anns_field: VECTOR_FIELD,
      metric_type: "COSINE",
      // Over-fetch and filter excludeAgent/ttl client-side, same reasoning
      // as S3VectorsBackend — keeps this correct even if a future Milvus
      // filter-expression edge case doesn't behave the way `filter` expects.
      limit: Math.max(topK * 4, 10),
      filter: `ttlEpoch > ${now}`,
      output_fields: [RECORD_ID_FIELD, ...METADATA_OUTPUT_FIELDS],
    });

    const records = [];
    for (const item of response.results || []) {
      if (item.sourceAgent === excludeAgent) continue;
      records.push({
        recordId: item[RECORD_ID_FIELD] ?? item.id,
        sourceAgent: item.sourceAgent || "",
        sourceDbKind: item.sourceDbKind || "",
        createdAt: item.createdAt || "",
        ttlEpoch: Number(item.ttlEpoch || 0),
        entities: item.entities || [],
        insightSummary: item.insightSummary || "",
        suggestedFollowups: item.suggestedFollowups || [],
      });
      if (records.length >= topK) break;
    }
    return records;
  }

  // Same best-effort semantic-lookup design as S3VectorsBackend's version —
  // see that file's comment for the full reasoning. Re-fetches the original
  // vector via `get()` (by primary key) rather than reusing the query
  // vector, so re-inserting via upsert doesn't recenter the record on the
  // invalidated question's embedding.
  async invalidateFollowup(questionText, queryVector) {
    await this.ready;
    const target = normalizeQuestion(questionText);

    const searchResponse = await this.client.search({
      collection_name: this.collection,
      data: [queryVector],
      anns_field: VECTOR_FIELD,
      metric_type: "COSINE",
      limit: 20,
      output_fields: [RECORD_ID_FIELD, "suggestedFollowups"],
    });

    const candidateIds = (searchResponse.results || [])
      .filter((item) => (item.suggestedFollowups || []).some((f) => normalizeQuestion(f) === target))
      .map((item) => item[RECORD_ID_FIELD] ?? item.id);
    if (candidateIds.length === 0) return { removed: 0 };

    const getResponse = await this.client.get({
      collection_name: this.collection,
      ids: candidateIds,
      output_fields: [RECORD_ID_FIELD, VECTOR_FIELD, ...METADATA_OUTPUT_FIELDS],
    });

    let removed = 0;
    const updates = [];
    for (const row of getResponse.data || []) {
      const followups = row.suggestedFollowups || [];
      const filtered = followups.filter((f) => normalizeQuestion(f) !== target);
      if (filtered.length === followups.length) continue;
      removed += followups.length - filtered.length;
      updates.push({
        [RECORD_ID_FIELD]: row[RECORD_ID_FIELD],
        [VECTOR_FIELD]: row[VECTOR_FIELD],
        sourceAgent: row.sourceAgent,
        sourceDbKind: row.sourceDbKind,
        createdAt: row.createdAt,
        ttlEpoch: row.ttlEpoch,
        entities: row.entities || [],
        insightSummary: row.insightSummary,
        suggestedFollowups: filtered,
      });
    }

    if (updates.length > 0) {
      await this.client.upsert({ collection_name: this.collection, data: updates });
    }
    return { removed };
  }
}
