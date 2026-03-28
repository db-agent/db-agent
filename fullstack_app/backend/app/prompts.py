"""
prompts.py — Prompt construction for the text-to-SQL pipeline.

Keeping prompts in one file makes it easy to iterate, A/B test, and teach
prompt engineering as a distinct discipline.
"""

from .db import get_schema

SYSTEM_PROMPT = """You are a precise and safe SQL assistant.

Your only job is to convert natural-language questions into valid, read-only SQL SELECT queries.

Rules you must always follow:
- Only generate SELECT statements. Never write INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, or any DDL/DML.
- Only reference tables and columns that exist in the provided schema.
- If a question cannot be answered from the available schema, return an empty sql string.
- Always return valid JSON in this exact format:

{
  "sql": "SELECT ... FROM ...",
  "explanation": "Plain English explanation of what this query does and why."
}

If you cannot answer the question return:
{
  "sql": "",
  "explanation": "Explanation of why the question cannot be answered."
}

Do not include markdown fences, extra commentary, or anything outside the JSON object."""


def build_user_prompt(question: str) -> str:
    """Build the user turn of the prompt by injecting live schema."""
    schema = get_schema()
    schema_lines = []
    for table, columns in schema.items():
        col_defs = ", ".join(f"{c['name']} ({c['type']})" for c in columns)
        schema_lines.append(f"  Table: {table}\n  Columns: {col_defs}")
    schema_text = "\n\n".join(schema_lines)

    return f"""Database schema:

{schema_text}

User question: {question}

Return only the JSON object described in the system prompt."""
