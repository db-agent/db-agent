"""
models.py — Pydantic data contracts for the entire pipeline.

These types define the API contract between frontend, backend handlers, and
internal pipeline stages. Keeping them here makes it easy to teach the
data flow end to end.
"""

from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field


# ── LLM layer ──────────────────────────────────────────────────────────────

class LLMConfig(BaseModel):
    base_url: str
    api_key: str
    model: str


class SQLResponse(BaseModel):
    """What the LLM returns after parsing its output."""
    sql: str
    explanation: str


# ── Safety layer ────────────────────────────────────────────────────────────

class ValidationResult(BaseModel):
    is_valid: bool
    errors: list[str] = Field(default_factory=list)


# ── Timing ──────────────────────────────────────────────────────────────────

class Timings(BaseModel):
    llm_ms: float = 0
    validation_ms: float = 0
    execution_ms: float = 0
    total_ms: float = 0


# ── API request/response ────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    limit: int = Field(default=100, ge=1, le=1000)


class QueryResponse(BaseModel):
    question: str
    schema_context: str
    sql: str
    validation: ValidationResult
    explanation: str
    rows: list[dict[str, Any]]
    row_count: int
    timings: Timings
    error: str | None = None


class SchemaTable(BaseModel):
    name: str
    columns: list[dict[str, str]]  # [{name, type}]
    row_count: int | None = None


class SchemaResponse(BaseModel):
    tables: list[SchemaTable]
    db_url_display: str   # sanitised — never expose credentials


class HealthResponse(BaseModel):
    status: str
    db_connected: bool
    version: str = "1.0.0"


# ── Internal pipeline ────────────────────────────────────────────────────────

class PipelineOutput(BaseModel):
    question: str
    schema_context: str = ""
    sql_response: SQLResponse | None = None
    validation: ValidationResult | None = None
    rows: list[dict[str, Any]] | None = None
    columns: list[str] | None = None
    timings: Timings = Field(default_factory=Timings)
    error: str | None = None
