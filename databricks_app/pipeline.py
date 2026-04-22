"""
pipeline.py — Core orchestration. Start reading here.

Teaching note:
    This file wires every module together in one linear function.

    Data flow (one question → one PipelineOutput):

        question
          │
          ▼
        build_user_prompt()      ← prompts.py   (schema + question → prompt)
          │
          ▼
        call_llm()               ← llm.py       (prompt → raw LLM text)
          │
          ▼
        parse_sql_response()     ← llm.py       (raw text → SQLResponse)
          │
          ▼
        validate_sql()           ← sql_safety.py (SQL → ValidationResult)
          │
          ▼  (only if is_safe)
        run_query()              ← connector.py  (SQL → rows from Databricks)
          │
          ▼
        PipelineOutput           ← models.py    (everything bundled)

    The pipeline never raises — errors go into PipelineOutput.error so the
    Streamlit UI can display a friendly message instead of a stack trace.
"""

import config
from models import LLMConfig, PipelineOutput, SQLResponse, ValidationResult
from prompts import SYSTEM_PROMPT, build_user_prompt
from llm import call_llm, parse_sql_response
from sql_safety import validate_sql
from connector import run_query, get_schema


def run_pipeline(question: str, llm_config: LLMConfig | None = None) -> PipelineOutput:
    """
    Execute the full natural-language → SQL → results pipeline.

    Args:
        question   — plain English question from the user
        llm_config — optional LLM override from the UI sidebar;
                     falls back to values in config.py / .env

    Returns:
        PipelineOutput — always returns, never raises.
        Check output.error to detect failures.
    """
    active_config = llm_config or LLMConfig(
        base_url=config.LLM_BASE_URL,
        api_key=config.LLM_API_KEY,
        model=config.LLM_MODEL,
    )

    # Capture schema for the explainability panel (same call prompts.py makes)
    schema = get_schema()
    schema_context = _format_schema_for_display(schema)

    output = PipelineOutput(question=question, schema_context=schema_context)

    try:
        # Step 1 — build prompt
        user_prompt = build_user_prompt(question)

        # Step 2 — call LLM
        raw_response = call_llm(SYSTEM_PROMPT, user_prompt, active_config)

        # Step 3 — parse structured output
        sql_response: SQLResponse = parse_sql_response(raw_response)
        output.sql_response = sql_response

        # Step 4 — safety validation
        validation: ValidationResult = validate_sql(sql_response.sql)
        output.validation = validation

        if not validation.is_safe:
            return output  # blocked — do not execute

        if not sql_response.sql:
            output.validation = ValidationResult(
                is_safe=False,
                reason="The LLM could not generate a query for this question.",
            )
            return output

        # Step 5 — execute on Databricks
        columns, rows = run_query(sql_response.sql)
        output.columns = columns
        output.rows    = rows

    except Exception as exc:
        output.error = str(exc)

    return output


def _format_schema_for_display(schema: dict) -> str:
    lines: list[str] = []
    for table, columns in schema.items():
        lines.append(f"Table: {table}")
        for col in columns:
            lines.append(f"  - {col['name']}  ({col['type']})")
        lines.append("")
    return "\n".join(lines)
