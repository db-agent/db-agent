"""
main.py — FastAPI application with Mangum adapter for AWS Lambda.

Local dev:  uvicorn main:app --reload --port 8000
Lambda:     The `handler` export is the Lambda entry point.

FastAPI handles routing, CORS, validation, and docs.
Mangum adapts the ASGI app to the Lambda event/context protocol.
"""

from __future__ import annotations
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from mangum import Mangum

from app import config
from app.models import (
    HealthResponse, SchemaResponse, QueryRequest, QueryResponse,
    LLMConfig, SchemaTable, ValidationResult,
)
from app.db import check_connection, get_schema, get_row_counts, run_query
from app.pipeline import run_pipeline

app = FastAPI(
    title="DB-Agent API",
    description="Natural language to SQL — serverless backend",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse, tags=["ops"])
def health():
    """Liveness check. Returns DB connectivity status."""
    db_ok = check_connection()
    return HealthResponse(status="ok" if db_ok else "degraded", db_connected=db_ok)


@app.get("/schema", response_model=SchemaResponse, tags=["database"])
def schema():
    """Return database schema for the frontend schema browser."""
    tables_raw = get_schema()
    counts = get_row_counts()
    tables = [
        SchemaTable(name=t, columns=cols, row_count=counts.get(t))
        for t, cols in tables_raw.items()
    ]
    db_display = config.DB_URL.split("@")[-1] if "@" in config.DB_URL else config.DB_URL
    return SchemaResponse(tables=tables, db_url_display=db_display)


@app.post("/query", response_model=QueryResponse, tags=["query"])
def query(request: QueryRequest):
    """
    Accept a natural language question, run the full pipeline,
    return SQL, validation, explanation, and results.
    """
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
        validation=result.validation or ValidationResult(is_valid=False, errors=["Pipeline error."]),
        explanation=result.sql_response.explanation if result.sql_response else "",
        rows=result.rows or [],
        row_count=len(result.rows) if result.rows else 0,
        timings=result.timings,
        error=result.error,
    )

    status_code = 200 if not result.error else 422
    return JSONResponse(content=response.model_dump(), status_code=status_code)


# ── AWS Lambda entry point ────────────────────────────────────────────────────
# Mangum wraps the FastAPI ASGI app into a Lambda-compatible handler.
handler = Mangum(app, lifespan="off")
