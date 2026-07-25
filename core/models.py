"""
models.py — Pydantic data contracts shared across every app in this project.

Teaching note:
    Typed models (vs plain dicts) give us:
      • automatic validation — bad data fails fast, with a clear error
      • clear contracts between pipeline stages — every function's input
        and output is documented by a class
      • easy serialization — .model_dump() for logging, .model_dump_json()
        for caching or sending over the wire

    Each class corresponds to one boundary in the pipeline:

        SQLResponse        ← what we ask the LLM to produce
        ValidationResult   ← what the safety layer hands back
        LLMConfig          ← runtime LLM settings (UI-overridable)
        PipelineOutput     ← everything one pipeline run yields, for the UI
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SQLResponse(BaseModel):
    """The structured JSON the LLM is instructed to return."""
    sql: str
    explanation: str


class ValidationResult(BaseModel):
    """Output of the SQL safety check — always populated, never raises."""
    is_safe: bool
    reason: str  # shown verbatim in the UI so the user sees which rule fired


class LLMConfig(BaseModel):
    """
    Runtime LLM settings.

    Defaults come from each app's config.py, but the sidebar can override
    every field per-request — useful when demoing several providers without
    restarting the app.
    """
    base_url: str
    api_key: str
    model: str


class PipelineOutput(BaseModel):
    """
    Everything one end-to-end pipeline run produces.

    The UI reads from a single PipelineOutput per question and decides
    what to render based on which fields are populated.
    """
    question: str
    schema_context: str                                        # plain-text schema sent to the LLM
    sql_response: Optional[SQLResponse] = None                 # populated after step 3
    validation: Optional[ValidationResult] = None              # populated after step 4
    rows: Optional[List[Dict[str, Any]]] = None                # populated after step 5
    columns: Optional[List[str]] = None
    error: Optional[str] = None                                # any unexpected runtime error
    model_used: Optional[str] = None                           # model that produced the SQL


class MemoryRecord(BaseModel):
    """
    A cross-platform context record — the unit shared between DB Agent
    instances that cannot otherwise reach each other (different subnet /
    security islands, e.g. an OLTP agent on SQL Server and an OLAP agent
    on Snowflake or Databricks SQL).

    Deliberately does NOT carry raw rows or literal SQL — only an
    LLM-produced summary and derived entity tags, so the record itself is
    safe to write to a shared, cross-boundary store (S3 / S3 Vectors).
    """
    record_id: str
    source_agent: str                                    # e.g. "oltp-sqlserver"
    source_db_kind: str                                  # e.g. "sqlserver", "databricks"
    created_at: str                                      # ISO 8601
    ttl_epoch: int                                       # unix seconds; filtered out once past, at query time
    question: str                                        # original NL question, kept for transparency only
    entities: List[str] = Field(default_factory=list)    # e.g. ["account_id:4471", "table:transactions"]
    insight_summary: str = ""                             # redacted summary of what was learned
    suggested_followups: List[str] = Field(default_factory=list)
