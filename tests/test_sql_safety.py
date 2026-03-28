"""
test_sql_safety.py — Unit tests for the SQL validation layer.

Run:  pytest tests/test_sql_safety.py -v
"""

import pytest
from streamlit_app.sql_safety import validate_sql


# ── Safe queries ──────────────────────────────────────────────────────────────

def test_simple_select_is_safe():
    result = validate_sql("SELECT * FROM customers")
    assert result.is_safe


def test_select_with_where_is_safe():
    result = validate_sql("SELECT name, email FROM customers WHERE city = 'New York'")
    assert result.is_safe


def test_select_with_join_is_safe():
    sql = """
        SELECT c.name, COUNT(o.id) AS order_count
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        GROUP BY c.id
    """
    result = validate_sql(sql)
    assert result.is_safe


def test_trailing_semicolon_is_safe():
    result = validate_sql("SELECT 1;")
    assert result.is_safe


# ── Blocked queries ───────────────────────────────────────────────────────────

def test_drop_table_blocked():
    result = validate_sql("DROP TABLE customers")
    assert not result.is_safe
    assert "DROP" in result.reason


def test_delete_blocked():
    result = validate_sql("DELETE FROM customers WHERE id = 1")
    assert not result.is_safe


def test_update_blocked():
    result = validate_sql("UPDATE customers SET name = 'x' WHERE id = 1")
    assert not result.is_safe


def test_insert_blocked():
    result = validate_sql("INSERT INTO customers (name) VALUES ('hacker')")
    assert not result.is_safe


def test_truncate_blocked():
    result = validate_sql("TRUNCATE TABLE orders")
    assert not result.is_safe


def test_alter_blocked():
    result = validate_sql("ALTER TABLE customers ADD COLUMN phone TEXT")
    assert not result.is_safe


def test_multiple_statements_blocked():
    result = validate_sql("SELECT 1; DROP TABLE customers")
    assert not result.is_safe
    assert "Multiple" in result.reason


def test_empty_string_blocked():
    result = validate_sql("")
    assert not result.is_safe


def test_non_select_blocked():
    result = validate_sql("SHOW TABLES")
    assert not result.is_safe


def test_create_blocked():
    result = validate_sql("CREATE TABLE evil (id INTEGER)")
    assert not result.is_safe
