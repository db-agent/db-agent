"""
db.py — Database connectivity and query execution via SQLAlchemy.

SQLAlchemy gives us a consistent interface across SQLite (demo),
PostgreSQL (production), and MySQL — swap only the DB_URL.
"""

from __future__ import annotations
from sqlalchemy import create_engine, text, inspect
from . import config


def _engine():
    """Create a SQLAlchemy engine. Stateless — safe for Lambda."""
    connect_args = {}
    if config.DB_URL.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    return create_engine(config.DB_URL, connect_args=connect_args)


def get_schema() -> dict[str, list[dict[str, str]]]:
    """
    Inspect the database and return table -> column metadata.

    Returns:
        { "table_name": [{"name": "col", "type": "TEXT"}, ...], ... }
    """
    engine = _engine()
    inspector = inspect(engine)
    schema: dict[str, list[dict[str, str]]] = {}
    for table in inspector.get_table_names():
        columns = [
            {"name": col["name"], "type": str(col["type"])}
            for col in inspector.get_columns(table)
        ]
        schema[table] = columns
    return schema


def get_row_counts() -> dict[str, int]:
    """Return approximate row counts per table for display."""
    engine = _engine()
    counts = {}
    with engine.connect() as conn:
        for table in inspect(engine).get_table_names():
            try:
                result = conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
                counts[table] = result.scalar() or 0
            except Exception:
                counts[table] = -1
    return counts


def run_query(sql: str, limit: int = 100) -> tuple[list[str], list[dict]]:
    """
    Execute a validated SQL query and return (columns, rows).

    The LIMIT is injected at the engine layer as a safety backstop
    even if the generated SQL doesn't include one.
    """
    engine = _engine()
    # Wrap in a subquery to apply limit safely
    safe_sql = f"SELECT * FROM ({sql.rstrip(';')}) AS _q LIMIT {limit}"
    with engine.connect() as conn:
        result = conn.execute(text(safe_sql))
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
    return columns, rows


def check_connection() -> bool:
    """Verify database connectivity. Used by the health handler."""
    try:
        engine = _engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
