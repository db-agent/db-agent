"""
pipeline.py — Core orchestration. Start reading here.

Teaching note:
    This file wires every other module together in one linear function.
    If you only read one file in this project, read this one.

    Data flow (one question → one PipelineOutput):

        question
          │
          ▼
        build_user_prompt()      ← prompts.py    (schema + question → prompt)
          │
          ▼
        call_llm()               ← llm.py        (prompt → raw LLM text)
          │
          ▼
        parse_sql_response()     ← llm.py        (raw text → SQLResponse)
          │
          ▼
        validate_sql()           ← sql_safety.py (SQL → ValidationResult)
          │
          ▼  (only if is_safe)
        run_query()              ← db.py         (SQL → rows)
          │
          ▼
        PipelineOutput           ← models.py     (everything bundled together)

    The pipeline never raises — every failure mode populates
    PipelineOutput.error so the Streamlit UI can render a friendly message
    instead of a stack trace.
"""

from __future__ import annotations

import config
from models import LLMConfig, PipelineOutput, SQLResponse, ValidationResult
from prompts import SYSTEM_PROMPT, build_user_prompt
from llm import call_llm, parse_sql_response
from sql_safety import validate_sql
from db import run_query, get_schema


def run_pipeline(question: str, llm_config: LLMConfig | None = None) -> PipelineOutput:
    """
    Execute the full natural-language → SQL → results pipeline.

    Args:
        question   — plain-English question from the user
        llm_config — optional override from the UI sidebar; if omitted, falls
                     back to values resolved by config.py (env / secrets / .env)

    Returns:
        PipelineOutput — always returned, never raised. Inspect output.error
        to detect a hard failure; output.validation.is_safe for a soft block.
    """
    active_config = llm_config or LLMConfig(
        base_url=config.LLM_BASE_URL,
        api_key=config.LLM_API_KEY,
        model=config.LLM_MODEL,
    )

    # Capture the schema once, both for the LLM prompt and the UI's
    # explainability tab. Calling get_schema() twice would be cheap but
    # could give different results if the DB changes mid-request.
    schema = get_schema()
    schema_context = _format_schema_for_display(schema)

    output = PipelineOutput(question=question, schema_context=schema_context)

    try:
        # Step 1 — build the prompt (re-reads schema; cheap)
        user_prompt = build_user_prompt(question)

        # Step 2 — call the LLM
        raw_response = call_llm(SYSTEM_PROMPT, user_prompt, active_config)

        # Step 3 — parse the JSON contract into a SQLResponse
        sql_response: SQLResponse = parse_sql_response(raw_response)
        output.sql_response = sql_response

        # Step 4 — safety validation (this is the actual guardrail)
        validation: ValidationResult = validate_sql(sql_response.sql)
        output.validation = validation

        if not validation.is_safe:
            return output  # blocked — do not execute

        if not sql_response.sql:
            # The LLM correctly signalled "I can't answer from this schema"
            # by returning empty sql. Surface it as a soft failure.
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
