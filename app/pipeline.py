"""
pipeline.py — The core orchestration logic. Start reading here.

Teaching note:
    This file is the heart of the system. It wires together every other
    module in a single, linear function: run_pipeline().

    Data flow (one question → one PipelineOutput):

        question
          │
          ▼
        build_user_prompt()      ← prompts.py  (schema + question → prompt)
          │
          ▼
        call_llm()               ← llm.py      (prompt → raw LLM text)
          │
          ▼
        parse_sql_response()     ← llm.py      (raw text → SQLResponse)
          │
          ▼
        validate_sql()           ← sql_safety.py  (SQL → ValidationResult)
          │
          ▼  (only if is_safe)
        run_query()              ← db.py       (SQL → rows)
          │
          ▼
        PipelineOutput           ← models.py   (everything bundled together)

    Each stage either succeeds or populates PipelineOutput.error,
    so the caller never sees an unhandled exception.
"""

from app.config import LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
from app.models import LLMConfig, PipelineOutput, SQLResponse, ValidationResult
from app.prompts import SYSTEM_PROMPT, build_user_prompt
from app.llm import call_llm, parse_sql_response
from app.sql_safety import validate_sql
from app.db import run_query, get_schema


def run_pipeline(question: str, llm_config: LLMConfig | None = None) -> PipelineOutput:
    """
    llm_config — optional override from the UI. Falls back to .env values.
    """
    config = llm_config or LLMConfig(
        base_url=LLM_BASE_URL,
        api_key=LLM_API_KEY,
        model=LLM_MODEL,
    )
    """
    Execute the full natural-language → SQL → results pipeline.

    Returns a PipelineOutput regardless of success or failure.
    Check output.error to detect failures.
    """

    # ── Step 0: capture schema context for display ─────────────────────────
    # We call build_user_prompt() below (which also calls get_schema()),
    # but we also want the raw schema text for the UI's explainability panel.
    schema = get_schema()
    schema_context = _format_schema_for_display(schema)

    output = PipelineOutput(
        question=question,
        schema_context=schema_context,
    )

    try:
        # ── Step 1: build prompt ────────────────────────────────────────────
        user_prompt = build_user_prompt(question)

        # ── Step 2: call LLM ────────────────────────────────────────────────
        raw_response = call_llm(SYSTEM_PROMPT, user_prompt, config)

        # ── Step 3: parse structured output ────────────────────────────────
        sql_response: SQLResponse = parse_sql_response(raw_response)
        output.sql_response = sql_response

        # ── Step 4: validate SQL ────────────────────────────────────────────
        validation: ValidationResult = validate_sql(sql_response.sql)
        output.validation = validation

        if not validation.is_safe:
            # Stop here — do not run unsafe SQL
            return output

        if not sql_response.sql:
            # LLM signalled it couldn't answer (empty sql)
            output.validation = ValidationResult(
                is_safe=False,
                reason="The LLM could not generate a query for this question.",
            )
            return output

        # ── Step 5: execute query ───────────────────────────────────────────
        columns, rows = run_query(sql_response.sql)
        output.columns = columns
        output.rows = rows

    except Exception as exc:
        output.error = str(exc)

    return output


def _format_schema_for_display(schema: dict) -> str:
    """Plain-text schema representation shown in the UI's expander."""
    lines: list[str] = []
    for table, columns in schema.items():
        lines.append(f"Table: {table}")
        for col in columns:
            lines.append(f"  - {col['name']}  ({col['type']})")
        lines.append("")
    return "\n".join(lines)
