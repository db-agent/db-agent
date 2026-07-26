"""
pipeline.py — Core orchestration. Start reading here.

Teaching note:
    This file wires every other module together in one linear function.
    If you only read one file in this project, read this one.

    Data flow (one question → one PipelineOutput):

        question
          │
          ▼
        build_user_prompt()      ← app's prompts.py  (schema + question → prompt)
          │
          ▼
        call_llm()               ← core/llm.py       (prompt → raw LLM text)
          │
          ▼
        parse_sql_response()     ← core/llm.py       (raw text → SQLResponse)
          │
          ▼
        validate_sql()           ← core/sql_safety.py (SQL → ValidationResult)
          │
          ▼  (only if is_safe)
        run_query()              ← app's db/connector (SQL → rows)
          │
          ▼
        PipelineOutput           ← core/models.py    (everything bundled)

    get_schema, run_query, system_prompt, and build_user_prompt are injected
    by each app's thin pipeline.py wrapper — keeping core/ free of any
    database-driver or app-framework imports.

    The pipeline never raises — every failure mode populates
    PipelineOutput.error so the UI can render a friendly message instead
    of a stack trace.
"""

from __future__ import annotations

from typing import Callable

from core.llm import parse_sql_response
from core.models import LLMConfig, PipelineOutput, SQLResponse, ValidationResult
from core.router import call_llm_with_failover
from core.sql_safety import validate_sql


def run_pipeline(
    question: str,
    llm_config: LLMConfig,
    *,
    get_schema: Callable,
    run_query: Callable,
    system_prompt: str,
    build_user_prompt: Callable[[str], str],
    extra_forbidden: frozenset[str] = frozenset(),
    model_chain: list[str] = [],
) -> PipelineOutput:
    """
    Execute the full natural-language → SQL → results pipeline.

    Args:
        question          — plain-English question from the user
        llm_config        — LLM connection settings (base_url, api_key, model)
        get_schema        — callable returning {table: [{name, type}, …]}
        run_query         — callable(sql) → (columns, rows)
        system_prompt     — the LLM system-turn prompt (app-specific)
        build_user_prompt — callable(question) → user-turn prompt with schema
        extra_forbidden   — additional SQL keywords to block beyond the base set

    Returns:
        PipelineOutput — always returned, never raised. Inspect output.error
        to detect a hard failure; output.validation.is_safe for a soft block.
    """
    schema = get_schema()
    schema_context = _format_schema_for_display(schema)
    output = PipelineOutput(question=question, schema_context=schema_context)

    try:
        # Step 1 — build the prompt
        user_prompt = build_user_prompt(question)

        # Step 2 — call the LLM (with ordered failover when chain has >1 model)
        chain = model_chain or [llm_config.model]
        raw_response, model_used = call_llm_with_failover(
            system_prompt, user_prompt, llm_config, chain
        )
        output.model_used = model_used

        # Step 3 — parse the JSON contract into a SQLResponse
        sql_response: SQLResponse = parse_sql_response(raw_response)
        output.sql_response = sql_response

        # Step 4 — safety validation (the actual guardrail)
        validation: ValidationResult = validate_sql(sql_response.sql, extra_forbidden)
        output.validation = validation

        if not validation.is_safe:
            return output  # blocked — do not execute

        if not sql_response.sql:
            # LLM correctly signalled "I can't answer from this schema"
            output.validation = ValidationResult(
                is_safe=False,
                reason="The LLM could not generate a query for this question.",
            )
            return output

        # Step 5 — execute the validated query
        columns, rows = run_query(sql_response.sql)
        output.columns = columns
        output.rows = rows

    except Exception as exc:
        output.error = str(exc)

    return output


def _format_schema_for_display(schema: dict) -> str:
    """Plain-text schema rendering shown in the UI's 'Schema context' tab."""
    lines: list[str] = []
    for table, columns in schema.items():
        lines.append(f"Table: {table}")
        for col in columns:
            lines.append(f"  - {col['name']}  ({col['type']})")
        lines.append("")
    return "\n".join(lines)
