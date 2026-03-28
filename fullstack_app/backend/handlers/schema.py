"""
handlers/schema.py — GET /schema

Returns the database schema for display in the frontend schema browser.
Safe to call frequently — no LLM involved.
"""

from __future__ import annotations
from app.db import get_schema, get_row_counts
from app.models import SchemaResponse, SchemaTable
from app import config


def handle(event: dict, context: object) -> dict:
    try:
        schema = get_schema()
        counts = get_row_counts()

        tables = [
            SchemaTable(
                name=table,
                columns=columns,
                row_count=counts.get(table),
            )
            for table, columns in schema.items()
        ]

        # Sanitise the DB URL for display — never expose credentials
        db_display = config.DB_URL.split("@")[-1] if "@" in config.DB_URL else config.DB_URL

        response = SchemaResponse(tables=tables, db_url_display=db_display)
        return {
            "statusCode": 200,
            "body": response.model_dump_json(),
            "headers": {"Content-Type": "application/json"},
        }
    except Exception as exc:
        return {
            "statusCode": 500,
            "body": f'{{"error": "Schema inspection failed: {exc}"}}',
            "headers": {"Content-Type": "application/json"},
        }
