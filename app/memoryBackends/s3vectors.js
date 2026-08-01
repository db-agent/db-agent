// memoryBackends/s3vectors.js — AWS S3 Vectors (preview).
// Mirrors ../../core/memory.py's S3VectorsBackend. Bucket + index are
// expected to already exist — this class only puts/queries, to keep IAM
// scoped tight. Over-fetches (topK * 4) and filters ttlEpoch/excludeAgent
// client-side rather than relying on exact metadata-filter operator
// support — S3 Vectors is a preview service and filter semantics could
// shift; this stays correct across API changes at the cost of a slightly
// larger response.

import {
  S3VectorsClient,
  PutVectorsCommand,
  QueryVectorsCommand,
  GetVectorsCommand,
} from "@aws-sdk/client-s3vectors";
import { normalizeQuestion } from "../memory.js";

export class S3VectorsBackend {
  constructor({ bucket, index, region }) {
    this.bucket = bucket;
    this.index = index;
    this.client = new S3VectorsClient({ region });
  }

  async put(record, vector) {
    await this.client.send(
      new PutVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.index,
        vectors: [
          {
            key: record.recordId,
            data: { float32: vector },
            metadata: {
              sourceAgent: record.sourceAgent,
              sourceDbKind: record.sourceDbKind,
              createdAt: record.createdAt,
              ttlEpoch: record.ttlEpoch,
              entities: record.entities,
              insightSummary: record.insightSummary,
              suggestedFollowups: record.suggestedFollowups,
            },
          },
        ],
      })
    );
  }

  async query(vector, { excludeAgent, topK }) {
    const response = await this.client.send(
      new QueryVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.index,
        topK: Math.max(topK * 4, 10),
        queryVector: { float32: vector },
        returnMetadata: true,
        returnDistance: true,
      })
    );

    const now = Date.now() / 1000;
    const records = [];
    for (const item of response.vectors || []) {
      const meta = item.metadata || {};
      if (meta.sourceAgent === excludeAgent) continue;
      if (Number(meta.ttlEpoch || 0) < now) continue;
      records.push({
        recordId: item.key,
        sourceAgent: meta.sourceAgent || "",
        sourceDbKind: meta.sourceDbKind || "",
        createdAt: meta.createdAt || "",
        ttlEpoch: Number(meta.ttlEpoch || 0),
        entities: meta.entities || [],
        insightSummary: meta.insightSummary || "",
        suggestedFollowups: meta.suggestedFollowups || [],
      });
      if (records.length >= topK) break;
    }
    return records;
  }

  // Same intent as LocalJsonBackend.invalidateFollowup, but S3 Vectors has
  // no "list all" or text-search primitive — only vector similarity search.
  // So this is a best-effort semantic lookup: it queries near the question's
  // own embedding (a follow-up question is usually reasonably close to the
  // insightSummary it was suggested alongside), then does an exact,
  // normalized string match against the candidates' metadata before
  // touching anything, so a low-recall miss just means "nothing found",
  // never a wrong edit. Vector data for a match is re-fetched via
  // GetVectorsCommand and re-written unchanged — reusing the *query*
  // vector for the PutVectors overwrite would recenter that memory record
  // on the invalidated question's embedding instead of its original
  // insight, corrupting future similarity search for it.
  async invalidateFollowup(questionText, queryVector) {
    const target = normalizeQuestion(questionText);
    const queryResponse = await this.client.send(
      new QueryVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.index,
        topK: 20,
        queryVector: { float32: queryVector },
        returnMetadata: true,
      })
    );

    const candidateKeys = (queryResponse.vectors || [])
      .filter((item) => (item.metadata?.suggestedFollowups || []).some((f) => normalizeQuestion(f) === target))
      .map((item) => item.key);
    if (candidateKeys.length === 0) return { removed: 0 };

    const getResponse = await this.client.send(
      new GetVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.index,
        keys: candidateKeys,
        returnData: true,
        returnMetadata: true,
      })
    );

    let removed = 0;
    const updates = [];
    for (const item of getResponse.vectors || []) {
      const followups = item.metadata?.suggestedFollowups || [];
      const filtered = followups.filter((f) => normalizeQuestion(f) !== target);
      if (filtered.length === followups.length) continue;
      removed += followups.length - filtered.length;
      updates.push({
        key: item.key,
        data: item.data,
        metadata: { ...item.metadata, suggestedFollowups: filtered },
      });
    }

    if (updates.length > 0) {
      await this.client.send(
        new PutVectorsCommand({ vectorBucketName: this.bucket, indexName: this.index, vectors: updates })
      );
    }
    return { removed };
  }
}
