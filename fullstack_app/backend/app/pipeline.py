"""
pipeline.py — Core orchestration for the text-to-SQL workflow.

Stages (in order):
  1. Inspect schema
  2. Build prompt
  3. Call LLM
  4. Parse SQL from LLM response
  5. Validate SQL (safety check)
  6. Execute query (only if valid)
  7. Return PipelineOutput

The pipeline never raises — all errors are captured into PipelineOutput.error
so the API handler can return a clean JSON response regardless.
"""

from __future__ import annotations
import time
from .models import LLMConfig, PipelineOutput, SQLResponse, Timings, ValidationResult
from .prompts import SYSTEM_PROMPT, build_user_prompt
from .llm import call_llm, parse_sql_response
from .db import get_schema, run_query
from .sql_safety import validate_sql


def run_pipeline(question: str, llm_config: LLMConfig, limit: int = 100) -> PipelineOutput:
    """
    Run the full text-to-SQL pipeline for a single question.

    Args:
        question:   Natural language question from the user.
        llm_config: LLM connection parameters.
        limit:      Max rows to return.

    Returns:
        PipelineOutput — always, even on partial failure.
    """
    total_start = time.monotonic()
    output = PipelineOutput(question=question)

    # ── Stage 1: Schema context ────────────────────────────────────────────
    try:
        schema = get_schema()
        schema_lines = []
        for table, columns in schema.items():
            col_names = ", ".join(c["name"] for c in columns)
            schema_lines.append(f"{table}({col_names})")
        output.schema_context = " | ".join(schema_lines)
    except Exception as exc:
        output.error = f"Schema inspection failed: {exc}"
        return output

    # ── Stage 2 & 3: Prompt + LLM ─────────────────────────────────────────
    llm_start = time.monotonic()
    try:
        user_prompt = build_user_prompt(question)
        raw_response = call_llm(SYSTEM_PROMPT, user_prompt, llm_config)
    except Exception as exc:
        output.error = f"LLM call failed: {exc}"
        output.timings.total_ms = _ms(total_start)
        return output
    output.timings.llm_ms = _ms(llm_start)

    # ── Stage 4: Parse SQL ─────────────────────────────────────────────────
    try:
        sql_response: SQLResponse = parse_sql_response(raw_response)
        output.sql_response = sql_response
    except Exception as exc:
        output.error = f"SQL parse failed: {exc}"
        output.timings.total_ms = _ms(total_start)
        return output

    # ── Stage 5: Validate ──────────────────────────────────────────────────
    validation_start = time.monotonic()
    validation: ValidationResult = validate_sql(sql_response.sql)
    output.validation = validation
    output.timings.validation_ms = _ms(validation_start)

    if not validation.is_valid:
        output.timings.total_ms = _ms(total_start)
        return output  # Stop here — do not execute unsafe SQL

    if not sql_response.sql.strip():
        output.timings.total_ms = _ms(total_start)
        return output  # LLM couldn't answer — return empty result

    # ── Stage 6: Execute ───────────────────────────────────────────────────
    exec_start = time.monotonic()
    try:
        columns, rows = run_query(sql_response.sql, limit=limit)
        output.columns = columns
        output.rows = rows
    except Exception as exc:
        output.error = f"Query execution failed: {exc}"
        output.timings.execution_ms = _ms(exec_start)
        output.timings.total_ms = _ms(total_start)
        return output
    output.timings.execution_ms = _ms(exec_start)

    output.timings.total_ms = _ms(total_start)
    return output


def _ms(start: float) -> float:
    return round((time.monotonic() - start) * 1000, 2)
