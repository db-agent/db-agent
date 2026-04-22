"""
models.py — Pydantic data models for the pipeline.

Teaching note:
    Typed models (vs plain dicts) give us auto-validation, clear contracts
    between pipeline stages, and easy serialization for logging / display.
"""

from typing import Any
from pydantic import BaseModel


class SQLResponse(BaseModel):
    """Structured output the LLM is asked to return."""
    sql: str
    explanation: str


class ValidationResult(BaseModel):
    """Result of the SQL safety check."""
    is_safe: bool
    reason: str


class LLMConfig(BaseModel):
    """Runtime LLM settings — can be overridden from the UI."""
    base_url: str
    api_key: str
    model: str


class PipelineOutput(BaseModel):
    """Everything produced by one end-to-end pipeline run."""
    question: str
    schema_context: str
    sql_response: SQLResponse | None = None
    validation: ValidationResult | None = None
    rows: list[dict[str, Any]] | None = None
    columns: list[str] | None = None
    error: str | None = None
