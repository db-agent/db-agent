"""
memory.py — Cross-platform contextual memory for DB Agent.

Teaching note:
    Two DB Agent instances can run in separate security/subnet islands
    (e.g. an OLTP agent on SQL Server, an OLAP agent on Snowflake or
    Databricks SQL) with no network path between them. Memory records are
    the one thing that crosses that boundary — via a shared vector store,
    never a live connection between the agents themselves.

    A memory record is a redacted, LLM-produced *summary* of a question a
    user asked and what was learned from it — never the raw SQL or rows.
    That's what makes it safe to write into a shared, cross-boundary store.

    Two backends implement MemoryBackend:

        LocalJsonBackend  — in-process / on-disk, numpy cosine similarity.
                             Zero cloud setup — this is what run_local.sh
                             and the default config use, so the "suggested
                             from other agents" feature works out of the box.

        S3VectorsBackend  — boto3 s3vectors client (AWS S3 Vectors,
                             preview). Same interface, swapped in via
                             MEMORY_BACKEND=s3vectors.

    Both are behind fetch_relevant_memories() / write_memory(), so the app
    never imports a backend directly.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Protocol

from openai import OpenAI

from core.models import LLMConfig, MemoryRecord, PipelineOutput

_REPO_ROOT = Path(__file__).parent.parent

_SUMMARY_SYSTEM_PROMPT = """\
You turn one question-and-answer turn from a database analyst into a short,
REDACTED memory record for a different analyst working on a different
database platform, who cannot see this data directly.

Rules:
- Never include literal row values, names, emails, amounts, or any other
  literal data from the result set.
- Reference entities only by identifier/type, e.g. "account_id:4471",
  "table:transactions". Do not include the values *inside* those rows.
- If the question was trivial (e.g. browsing schema, a failed query, a
  request with no analytical content), set "memory_worthy" to false.
- suggested_followups are natural-language questions a *different* analyst,
  on a *different* database, might reasonably ask next, given the entities
  involved. Do not assume that database's schema — keep them generic enough
  to make sense cross-platform.

Respond with ONLY a JSON object:
{
  "memory_worthy": true|false,
  "insight_summary": "one or two sentences, no literal data",
  "entities": ["account_id:4471", "table:transactions"],
  "suggested_followups": ["...", "..."]
}
"""


class MemoryBackend(Protocol):
    def put(self, record: MemoryRecord, vector: list[float]) -> None: ...

    def query(
        self, vector: list[float], *, exclude_agent: str, top_k: int
    ) -> list[MemoryRecord]: ...


# ── Embeddings ──────────────────────────────────────────────────────────────

def _embed(text: str, llm_config: LLMConfig, embedding_model: str) -> list[float]:
    client = OpenAI(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key or "no-key",
    )
    response = client.embeddings.create(model=embedding_model, input=text)
    return list(response.data[0].embedding)


# ── Summarization ─────────────────────────────────────────────────────────

def _parse_summary_json(raw: str) -> dict:
    text = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError(f"No JSON object found in summary response:\n{raw}")
        return json.loads(match.group())


def summarize_for_memory(
    output: PipelineOutput,
    llm_config: LLMConfig,
    *,
    agent_id: str,
    db_kind: str,
    ttl_seconds: int,
) -> MemoryRecord | None:
    """
    Turn one pipeline run into a MemoryRecord, or None if it isn't worth
    remembering (errors, unsafe queries, trivial questions).

    Never raises — a summarization failure just means no memory is written.
    """
    if output.error or not output.sql_response:
        return None
    if output.validation and not output.validation.is_safe:
        return None

    client = OpenAI(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key or "no-key",
    )
    row_count = len(output.rows) if output.rows is not None else 0
    user_prompt = (
        f"Question: {output.question}\n"
        f"SQL: {output.sql_response.sql}\n"
        f"Explanation: {output.sql_response.explanation}\n"
        f"Row count returned: {row_count}\n"
    )
    try:
        response = client.chat.completions.create(
            model=llm_config.model,
            messages=[
                {"role": "system", "content": _SUMMARY_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0,
        )
        data = _parse_summary_json(response.choices[0].message.content or "")
    except Exception as exc:
        print(f"[memory] summarization skipped: {exc}")
        return None

    if not data.get("memory_worthy", False):
        return None

    now = time.time()
    return MemoryRecord(
        record_id=str(uuid.uuid4()),
        source_agent=agent_id,
        source_db_kind=db_kind,
        created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        ttl_epoch=int(now + ttl_seconds),
        question=output.question,
        entities=[str(e) for e in data.get("entities", [])],
        insight_summary=str(data.get("insight_summary", "")),
        suggested_followups=[str(s) for s in data.get("suggested_followups", [])],
    )


# ── Local backend (default — no cloud setup required) ──────────────────────

class LocalJsonBackend:
    """
    JSONL file + numpy cosine similarity. Persists to disk so memories
    survive process restarts (simulating a shared store) without needing
    any cloud credentials — this is what makes the feature demoable via
    run_local.sh with zero extra setup.
    """

    def __init__(self, path: Path | None = None):
        self._path = path or (_REPO_ROOT / "data" / "memory_store.jsonl")
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def put(self, record: MemoryRecord, vector: list[float]) -> None:
        row = {"record": record.model_dump(), "vector": vector}
        with self._path.open("a") as f:
            f.write(json.dumps(row) + "\n")

    def query(
        self, vector: list[float], *, exclude_agent: str, top_k: int
    ) -> list[MemoryRecord]:
        import numpy as np

        if not self._path.exists():
            return []

        now = time.time()
        query_vec = np.array(vector, dtype="float32")
        query_norm = np.linalg.norm(query_vec) or 1.0

        scored: list[tuple[float, MemoryRecord]] = []
        with self._path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                record = MemoryRecord(**row["record"])
                if record.source_agent == exclude_agent:
                    continue
                if record.ttl_epoch < now:
                    continue
                cand_vec = np.array(row["vector"], dtype="float32")
                cand_norm = np.linalg.norm(cand_vec) or 1.0
                similarity = float(np.dot(query_vec, cand_vec) / (query_norm * cand_norm))
                scored.append((similarity, record))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [record for _, record in scored[:top_k]]


# ── S3 Vectors backend ───────────────────────────────────────────────────────

class S3VectorsBackend:
    """
    Amazon S3 Vectors (preview) — boto3 `s3vectors` client. One vector
    index per org/tenant; agent identity + TTL travel as vector metadata
    so a single query call can span every agent writing into that index.

    The bucket + index are expected to already exist (see README / infra
    notes) — this class does not provision them, to keep IAM scoped to
    put/query only.
    """

    def __init__(self, bucket: str, index: str, region: str):
        import boto3

        self._client = boto3.client("s3vectors", region_name=region)
        self._bucket = bucket
        self._index = index

    def put(self, record: MemoryRecord, vector: list[float]) -> None:
        self._client.put_vectors(
            vectorBucketName=self._bucket,
            indexName=self._index,
            vectors=[
                {
                    "key": record.record_id,
                    "data": {"float32": [float(v) for v in vector]},
                    "metadata": {
                        "source_agent": record.source_agent,
                        "source_db_kind": record.source_db_kind,
                        "ttl_epoch": record.ttl_epoch,
                        "created_at": record.created_at,
                        "question": record.question,
                        "insight_summary": record.insight_summary,
                        "suggested_followups": record.suggested_followups,
                        "entities": record.entities,
                    },
                }
            ],
        )

    def query(
        self, vector: list[float], *, exclude_agent: str, top_k: int
    ) -> list[MemoryRecord]:
        # Over-fetch and post-filter in Python rather than relying on exact
        # metadata-filter operator support (preview service — filter
        # semantics may shift), so this stays correct across API changes.
        response = self._client.query_vectors(
            vectorBucketName=self._bucket,
            indexName=self._index,
            queryVector={"float32": [float(v) for v in vector]},
            topK=max(top_k * 4, 10),
            returnMetadata=True,
            returnDistance=True,
        )
        now = time.time()
        records: list[MemoryRecord] = []
        for item in response.get("vectors", []):
            meta = item.get("metadata", {})
            if meta.get("source_agent") == exclude_agent:
                continue
            if float(meta.get("ttl_epoch", 0)) < now:
                continue
            records.append(
                MemoryRecord(
                    record_id=item["key"],
                    source_agent=meta.get("source_agent", ""),
                    source_db_kind=meta.get("source_db_kind", ""),
                    created_at=meta.get("created_at", ""),
                    ttl_epoch=int(meta.get("ttl_epoch", 0)),
                    question=meta.get("question", ""),
                    entities=list(meta.get("entities", [])),
                    insight_summary=meta.get("insight_summary", ""),
                    suggested_followups=list(meta.get("suggested_followups", [])),
                )
            )
            if len(records) >= top_k:
                break
        return records


# ── Public API ───────────────────────────────────────────────────────────────

_backend: MemoryBackend | None = None


def get_backend(cfg) -> MemoryBackend:
    global _backend
    if _backend is not None:
        return _backend
    if cfg.MEMORY_BACKEND == "s3vectors":
        _backend = S3VectorsBackend(
            bucket=cfg.MEMORY_S3_BUCKET,
            index=cfg.MEMORY_ORG_ID,
            region=cfg.MEMORY_S3_REGION,
        )
    else:
        _backend = LocalJsonBackend()
    return _backend


def write_memory(output: PipelineOutput, llm_config: LLMConfig, cfg) -> None:
    """Never raises — memory is best-effort context, not a critical path."""
    if not cfg.MEMORY_ENABLED:
        return
    try:
        record = summarize_for_memory(
            output,
            llm_config,
            agent_id=cfg.DBAGENT_ID,
            db_kind=cfg.MEMORY_DB_KIND,
            ttl_seconds=cfg.MEMORY_TTL_SECONDS,
        )
        if record is None:
            return
        vector = _embed(record.insight_summary, llm_config, cfg.EMBEDDING_MODEL)
        get_backend(cfg).put(record, vector)
    except Exception as exc:
        print(f"[memory] write skipped: {exc}")


def fetch_relevant_memories(
    query_text: str, llm_config: LLMConfig, cfg, *, top_k: int = 3
) -> list[MemoryRecord]:
    """Never raises — an empty list just means no suggestions are shown."""
    if not cfg.MEMORY_ENABLED:
        return []
    try:
        vector = _embed(query_text, llm_config, cfg.EMBEDDING_MODEL)
        return get_backend(cfg).query(
            vector, exclude_agent=cfg.DBAGENT_ID, top_k=top_k
        )
    except Exception as exc:
        print(f"[memory] fetch skipped: {exc}")
        return []
