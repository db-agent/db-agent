"""
test_db.py — Tests for the DB layer using an in-memory SQLite database.

Run:  pytest tests/test_db.py -v

Teaching note:
    We monkeypatch app.db._engine so tests never touch the real demo.db.
    In-memory SQLite (sqlite:///:memory:) is created fresh per test.
"""

import pytest
from sqlalchemy import create_engine, text
import app.db as db_module


@pytest.fixture(autouse=True)
def in_memory_db(monkeypatch):
    """Replace the module-level engine with an in-memory SQLite engine."""
    engine = create_engine("sqlite:///:memory:")

    # Create a minimal schema
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE customers (
                id   INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                city TEXT
            )
        """))
        conn.execute(text("""
            INSERT INTO customers VALUES
            (1, 'Alice', 'New York'),
            (2, 'Bob',   'Chicago')
        """))
        conn.commit()

    monkeypatch.setattr(db_module, "_engine", engine)
    yield engine


# ── Schema inspection ─────────────────────────────────────────────────────────

def test_get_schema_returns_tables():
    schema = db_module.get_schema()
    assert "customers" in schema


def test_get_schema_returns_columns():
    schema = db_module.get_schema()
    col_names = [c["name"] for c in schema["customers"]]
    assert "id" in col_names
    assert "name" in col_names
    assert "city" in col_names


def test_schema_column_has_type():
    schema = db_module.get_schema()
    for col in schema["customers"]:
        assert "type" in col
        assert col["type"]  # not empty


# ── Query execution ───────────────────────────────────────────────────────────

def test_run_query_returns_rows():
    columns, rows = db_module.run_query("SELECT * FROM customers")
    assert len(rows) == 2


def test_run_query_returns_correct_columns():
    columns, rows = db_module.run_query("SELECT name, city FROM customers")
    assert "name" in columns
    assert "city" in columns


def test_run_query_where_clause():
    columns, rows = db_module.run_query(
        "SELECT name FROM customers WHERE city = 'New York'"
    )
    assert len(rows) == 1
    assert rows[0]["name"] == "Alice"


def test_run_query_empty_result():
    columns, rows = db_module.run_query(
        "SELECT * FROM customers WHERE city = 'Atlantis'"
    )
    assert rows == []
