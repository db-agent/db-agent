"""
sqlalchemy_backend.py — SQLAlchemy connection, schema inspection, and query execution.

Used when DATABRICKS_HOST is not set. Supports SQLite, Postgres, MySQL, and
any other database with an SQLAlchemy driver.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import create_engine, inspect, text

import config


def _normalize_url(url: str) -> str:
    # SQLAlchemy maps postgresql:// to psycopg2, but we ship psycopg (v3).
    # Rewrite bare postgresql:// / postgres:// to the explicit psycopg3 dialect.
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


# check_same_thread=False is required for SQLite when used from Streamlit:
# Streamlit reruns happen on different threads, and SQLite by default refuses
# to share a connection across threads.
_db_url = _normalize_url(config.DB_URL)
_engine = create_engine(
    _db_url,
    connect_args={"check_same_thread": False} if "sqlite" in _db_url else {},
)


def get_schema() -> dict[str, list[dict[str, str]]]:
    """
    Introspect the database and return a JSON-serializable schema.

    Shape:
        {
            "customers": [{"name": "id", "type": "INTEGER"}, ...],
            "orders":    [...],
        }
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
    """Execute a SQL query and return (column_names, rows)."""
    with _engine.connect() as conn:
        result = conn.execute(text(sql))
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
    return columns, rows


def check_connection() -> bool:
    """Lightweight liveness check — returns True if SELECT 1 succeeds."""
    try:
        with _engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
