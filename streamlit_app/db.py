"""
db.py — Database connection, schema inspection, and query execution.

Teaching note:
    SQLAlchemy is doing two specific jobs here:

      1. Engine management — one process-wide connection pool that knows
         how to talk to SQLite, Postgres, MySQL, etc. via a single DB_URL.
      2. Reflection — inspecting tables and columns without us writing
         driver-specific SHOW / INFORMATION_SCHEMA queries.

    We deliberately do NOT use the SQLAlchemy ORM. The agent generates raw
    SQL, and we execute it via `text()` so learners can see the exact string
    that runs against the database. No magic translation layer.

    Schema is returned as a plain dict so it's trivial to log, cache, or
    feed into the LLM prompt — see prompts.build_user_prompt().
"""

from __future__ import annotations

from typing import Any
from sqlalchemy import create_engine, text, inspect

import config


# ── Engine (singleton) ────────────────────────────────────────────────────────
# check_same_thread=False is required for SQLite when used from Streamlit:
# Streamlit reruns happen on different threads, and SQLite by default refuses
# to share a connection across threads.
_engine = create_engine(
    config.DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in config.DB_URL else {},
)


def get_schema() -> dict[str, list[dict[str, str]]]:
    """
    Introspect the database and return a JSON-serializable schema.

    Shape:
        {
            "customers": [{"name": "id", "type": "INTEGER"}, ...],
            "orders":    [...],
        }

    Used in two places:
      • prompts.build_user_prompt() — the LLM needs to know what tables exist
      • streamlit_app.py sidebar    — the user wants to browse them too
    """
    inspector = inspect(_engine)
    schema: dict[str, list[dict[str, str]]] = {}

    for table_name in inspector.get_table_names():
        schema[table_name] = [
            {"name": col["name"], "type": str(col["type"])}
            for col in inspector.get_columns(table_name)
        ]

    return schema


def run_query(sql: str) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Execute a SQL query and return (column_names, rows).

    Teaching note:
        We rely on the safety layer (sql_safety.validate_sql) having already
        whitelisted this string before we get here. This function does NOT
        re-validate — defence in depth lives in the pipeline stage above.

    Raises:
        Any SQLAlchemy / DBAPI exception is propagated. pipeline.run_pipeline
        catches it and stores the message in PipelineOutput.error.
    """
    with _engine.connect() as conn:
        result = conn.execute(text(sql))
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
    return columns, rows


def check_connection() -> bool:
    """
    Lightweight liveness check — used by the sidebar health badge.

    Returns True if a `SELECT 1` round-trip succeeds. Never raises.
    """
    try:
        with _engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
