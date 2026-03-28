"""
test_pipeline.py — Integration tests for the full pipeline.

Run:  pytest tests/test_pipeline.py -v

Teaching note:
    We stub out the LLM call (call_llm) and the DB engine so the pipeline
    tests run instantly with no external dependencies.

    The key thing being tested here is the orchestration logic:
    does the pipeline correctly route through validation, skip execution
    on unsafe SQL, and populate the right output fields?
"""

import pytest
from unittest.mock import patch
from sqlalchemy import create_engine, text

import app.db as db_module
from app.pipeline import run_pipeline


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def in_memory_db(monkeypatch):
    """Use an in-memory DB for all pipeline tests."""
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE products (
                id    INTEGER PRIMARY KEY,
                name  TEXT NOT NULL,
                price REAL
            )
        """))
        conn.execute(text("""
            INSERT INTO products VALUES
            (1, 'Widget', 9.99),
            (2, 'Gadget', 19.99)
        """))
        conn.commit()
    monkeypatch.setattr(db_module, "_engine", engine)


def make_llm_response(sql: str, explanation: str = "A test query.") -> str:
    """Helper to build the JSON string an LLM would return."""
    return f'{{"sql": "{sql}", "explanation": "{explanation}"}}'


# ── Happy path ────────────────────────────────────────────────────────────────

def test_pipeline_returns_rows_for_valid_question():
    llm_reply = make_llm_response("SELECT * FROM products")
    with patch("app.pipeline.call_llm", return_value=llm_reply):
        output = run_pipeline("Show all products")

    assert output.error is None
    assert output.sql_response is not None
    assert output.validation is not None
    assert output.validation.is_safe
    assert output.rows is not None
    assert len(output.rows) == 2


def test_pipeline_populates_schema_context():
    llm_reply = make_llm_response("SELECT * FROM products")
    with patch("app.pipeline.call_llm", return_value=llm_reply):
        output = run_pipeline("List products")

    assert "products" in output.schema_context


def test_pipeline_stores_question():
    llm_reply = make_llm_response("SELECT * FROM products")
    with patch("app.pipeline.call_llm", return_value=llm_reply):
        output = run_pipeline("What are the products?")

    assert output.question == "What are the products?"


# ── Safety guard ──────────────────────────────────────────────────────────────

def test_pipeline_blocks_unsafe_sql():
    llm_reply = make_llm_response("DROP TABLE products")
    with patch("app.pipeline.call_llm", return_value=llm_reply):
        output = run_pipeline("Delete everything")

    assert output.validation is not None
    assert not output.validation.is_safe
    assert output.rows is None   # must NOT have executed


def test_pipeline_blocks_multi_statement():
    llm_reply = make_llm_response("SELECT 1; DROP TABLE products")
    with patch("app.pipeline.call_llm", return_value=llm_reply):
        output = run_pipeline("Do something bad")

    assert not output.validation.is_safe
    assert output.rows is None


# ── Error handling ────────────────────────────────────────────────────────────

def test_pipeline_handles_llm_parse_error():
    with patch("app.pipeline.call_llm", return_value="not valid json at all"):
        output = run_pipeline("Broken LLM response")

    assert output.error is not None
    assert output.rows is None


def test_pipeline_handles_db_error():
    # LLM returns SQL that references a table that doesn't exist
    llm_reply = make_llm_response("SELECT * FROM nonexistent_table")
    with patch("app.pipeline.call_llm", return_value=llm_reply):
        output = run_pipeline("Query ghost table")

    assert output.error is not None
