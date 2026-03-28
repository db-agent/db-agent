"""
tests/test_pipeline.py — Pipeline integration tests.

These tests mock the LLM and database so they run offline and fast.
They verify that the pipeline orchestration is correct, not that the LLM
generates good SQL (that's a prompt engineering concern tested separately).
"""

import pytest
from unittest.mock import patch, MagicMock
from app.models import LLMConfig, SQLResponse, ValidationResult
from app.pipeline import run_pipeline

MOCK_LLM_CONFIG = LLMConfig(
    base_url="http://localhost:11434/v1",
    api_key="test",
    model="test-model",
)

MOCK_SCHEMA = {
    "customers": [{"name": "id", "type": "INTEGER"}, {"name": "name", "type": "TEXT"}],
    "orders": [{"name": "id", "type": "INTEGER"}, {"name": "customer_id", "type": "INTEGER"}],
}

VALID_SQL_RESPONSE = SQLResponse(
    sql="SELECT name FROM customers LIMIT 10",
    explanation="This query returns the first 10 customer names.",
)


@patch("app.pipeline.get_schema", return_value=MOCK_SCHEMA)
@patch("app.pipeline.call_llm", return_value='{"sql": "SELECT name FROM customers LIMIT 10", "explanation": "Returns customer names."}')
@patch("app.pipeline.run_query", return_value=(["name"], [{"name": "Alice"}, {"name": "Bob"}]))
def test_successful_pipeline(mock_run_query, mock_llm, mock_schema):
    result = run_pipeline("Show me all customers", MOCK_LLM_CONFIG)
    assert result.error is None
    assert result.sql_response is not None
    assert result.sql_response.sql.startswith("SELECT")
    assert result.validation is not None
    assert result.validation.is_valid is True
    assert result.rows is not None
    assert len(result.rows) == 2


@patch("app.pipeline.get_schema", return_value=MOCK_SCHEMA)
@patch("app.pipeline.call_llm", return_value='{"sql": "DROP TABLE customers", "explanation": "Drops the table."}')
def test_unsafe_sql_blocked(mock_llm, mock_schema):
    result = run_pipeline("Delete all customers", MOCK_LLM_CONFIG)
    assert result.validation is not None
    assert result.validation.is_valid is False
    assert result.rows is None  # Should not have executed


@patch("app.pipeline.get_schema", side_effect=Exception("DB connection failed"))
def test_schema_failure_handled(mock_schema):
    result = run_pipeline("any question", MOCK_LLM_CONFIG)
    assert result.error is not None
    assert "Schema" in result.error


@patch("app.pipeline.get_schema", return_value=MOCK_SCHEMA)
@patch("app.pipeline.call_llm", return_value='{"sql": "", "explanation": "Cannot answer this question."}')
def test_empty_sql_returns_gracefully(mock_llm, mock_schema):
    result = run_pipeline("What is the weather today?", MOCK_LLM_CONFIG)
    assert result.error is None
    assert result.sql_response is not None
    assert result.sql_response.sql == ""
