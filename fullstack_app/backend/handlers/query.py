"""
handlers/query.py — POST /query

The main API endpoint. Accepts a natural language question and returns
the full pipeline output: SQL, validation, results, explanation, timings.
"""

from __future__ import annotations
import json
from app.models import LLMConfig, QueryRequest, QueryResponse
from app.pipeline import run_pipeline
from app import config


def handle(event: dict, context: object) -> dict:
    # Parse request body
    try:
        body = json.loads(event.get("body") or "{}")
        request = QueryRequest(**body)
    except Exception as exc:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": f"Invalid request: {exc}"}),
            "headers": {"Content-Type": "application/json"},
        }

    llm_config = LLMConfig(
        base_url=config.LLM_BASE_URL,
        api_key=config.LLM_API_KEY,
        model=config.LLM_MODEL,
    )

    result = run_pipeline(
        question=request.question,
        llm_config=llm_config,
        limit=request.limit,
    )

    response = QueryResponse(
        question=result.question,
        schema_context=result.schema_context,
        sql=result.sql_response.sql if result.sql_response else "",
        validation=result.validation or {"is_valid": False, "errors": ["Pipeline did not reach validation."]},
        explanation=result.sql_response.explanation if result.sql_response else "",
        rows=result.rows or [],
        row_count=len(result.rows) if result.rows else 0,
        timings=result.timings,
        error=result.error,
    )

    status = 200 if not result.error else 422
    return {
        "statusCode": status,
        "body": response.model_dump_json(),
        "headers": {"Content-Type": "application/json"},
    }
