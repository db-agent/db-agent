"""
models.py — Pydantic data models for the pipeline.

Teaching note:
    Using typed models (instead of plain dicts) gives us:
      • auto-validation
      • clear contracts between pipeline stages
      • easy serialization for logging / display
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
    reason: str  # human-readable message shown in the UI


class LLMConfig(BaseModel):
    """Runtime LLM settings — can be overridden from the UI."""
    base_url: str
    api_key: str
    model: str


class PipelineOutput(BaseModel):
    """
    Everything produced by one end-to-end pipeline run.
    The Streamlit UI reads from this single object.
    """
    question: str
    schema_context: str          # the schema snippet sent to the LLM
    sql_response: SQLResponse | None = None
    validation: ValidationResult | None = None
    rows: list[dict[str, Any]] | None = None
    columns: list[str] | None = None
    error: str | None = None     # any unexpected runtime error
