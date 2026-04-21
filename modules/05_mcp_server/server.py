"""
Module 05 — MCP Server
======================
Teaching goal: expose the DB Agent's tools via the Model Context Protocol (MCP)
so any MCP-compatible client (Claude Desktop, Cursor, your own agents) can use them.

Key idea: you write the tool logic ONCE here.
Any client that speaks MCP can use it without you writing any agent code.

Run with the MCP inspector (browser UI for testing):
    mcp dev modules/05_mcp_server/server.py

Run directly (stdio transport, for Claude Desktop):
    python modules/05_mcp_server/server.py

See README.md for Claude Desktop configuration.

Install dependency:
    pip install "mcp[cli]"
"""

import sys
import json
from pathlib import Path

# Add repo root so we can reuse the existing db and safety modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import os
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from streamlit_app.db import get_schema as db_get_schema, run_query as db_run_query
from streamlit_app.sql_safety import validate_sql

load_dotenv(Path(__file__).parent.parent.parent / ".env")

# ── Create the MCP server ──────────────────────────────────────────────────────
# FastMCP is a high-level wrapper around the MCP protocol.
# You just decorate functions — no protocol boilerplate required.

mcp = FastMCP(
    "db-agent",
    instructions=(
        "You have access to a SQL database. "
        "Use list_tables to explore the schema, describe_table for column details, "
        "and run_query to answer questions with data. "
        "Only SELECT queries are allowed."
    ),
)


# ── Tool 1: list_tables ────────────────────────────────────────────────────────

@mcp.tool()
def list_tables() -> str:
    """
    List all tables in the database.

    Call this first to understand what data is available before writing any SQL.
    Returns a JSON array of table names.
    """
    schema = db_get_schema()
    return json.dumps(list(schema.keys()), indent=2)


# ── Tool 2: describe_table ─────────────────────────────────────────────────────

@mcp.tool()
def describe_table(table_name: str) -> str:
    """
    Get the column names and data types for a specific table.

    Use this after list_tables to understand a table's structure before querying it.
    Returns a JSON array of {name, type} objects.

    Args:
        table_name: Name of the table to describe (must be a valid table name).
    """
    schema = db_get_schema()

    if table_name not in schema:
        available = list(schema.keys())
        return json.dumps({
            "error": f"Table '{table_name}' not found.",
            "available_tables": available,
        })

    return json.dumps(schema[table_name], indent=2)


# ── Tool 3: run_query ──────────────────────────────────────────────────────────

@mcp.tool()
def run_query(sql: str) -> str:
    """
    Execute a read-only SELECT query against the database and return the results.

    The query is validated before execution:
      - Must be a single SELECT statement
      - Must not contain any write or admin keywords (DROP, DELETE, INSERT, etc.)

    If the query is blocked or fails, an error message is returned explaining why.
    Results are capped at 100 rows to keep responses manageable.

    Args:
        sql: A valid SELECT statement. Use only tables and columns from the schema.
    """
    # Safety check — reuses the same guardrail from streamlit_app/sql_safety.py
    validation = validate_sql(sql)
    if not validation.is_safe:
        return json.dumps({
            "error": "Query blocked by safety check.",
            "reason": validation.reason,
            "hint": "Only SELECT statements are allowed. Revise your query.",
        })

    try:
        columns, rows = db_run_query(sql)
        result = {
            "columns": columns,
            "row_count": len(rows),
            "rows": rows[:100],  # cap to avoid overwhelming the context window
        }
        if len(rows) > 100:
            result["truncated"] = True
            result["total_rows_hint"] = f"Showing 100 of {len(rows)}+ rows. Add a LIMIT clause for full control."
        return json.dumps(result, default=str)

    except Exception as exc:
        return json.dumps({
            "error": "Query execution failed.",
            "detail": str(exc),
            "hint": "Check your SQL syntax and ensure all referenced tables/columns exist.",
        })


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # mcp.run() starts the server on stdio (used by Claude Desktop and other clients).
    # When using `mcp dev server.py`, FastMCP handles the inspector transport automatically.
    mcp.run()
