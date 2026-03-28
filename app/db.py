"""
db.py — Database connection, schema inspection, and query execution.

Teaching note:
    SQLAlchemy is used only for connection management and reflection.
    Raw SQL is executed via text() so learners can see exactly what runs.
    Schema is returned as a plain dict so it's easy to inspect / log.
"""

from typing import Any
from sqlalchemy import create_engine, text, inspect
from app.config import DB_URL


# ── Engine (singleton) ────────────────────────────────────────────────────────
# check_same_thread=False is required for SQLite when used from Streamlit
# (Streamlit reruns happen on different threads).
_engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DB_URL else {},
)


def get_schema() -> dict[str, list[dict[str, str]]]:
    """
    Return the database schema as a dict:
        { "table_name": [{"name": "col", "type": "TEXT"}, ...], ... }
    """
    inspector = inspect(_engine)
    schema: dict[str, list[dict[str, str]]] = {}

    for table_name in inspector.get_table_names():
        columns = []
        for col in inspector.get_columns(table_name):
            columns.append({
                "name": col["name"],
                "type": str(col["type"]),
            })
        schema[table_name] = columns

    return schema


def run_query(sql: str) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Execute a SQL query and return (column_names, rows).

    Raises:
        Exception — propagated to the caller; pipeline.py handles it.
    """
    with _engine.connect() as conn:
        result = conn.execute(text(sql))
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
    return columns, rows
