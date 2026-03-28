"""
prompts.py — Prompt templates and schema-aware prompt builder.

Teaching note:
    The system prompt is the most important LLM guardrail.
    It tells the model:
      • what it's allowed to do (read-only SELECT)
      • what schema it can reference
      • what format to return

    Keeping prompts in one file makes them easy to iterate and test.
"""

from streamlit_app.db import get_schema


# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are a SQL assistant. Your only job is to generate a single, safe, read-only SELECT query.

Rules you must follow:
- Only use tables and columns that exist in the schema provided.
- Never use DROP, DELETE, UPDATE, INSERT, ALTER, TRUNCATE, or any write operation.
- Write exactly one SELECT statement. No semicolons in the middle.
- If the question cannot be answered from the schema, say so in the explanation and set sql to an empty string.

Always respond with valid JSON in this exact format:
{
  "sql": "<your SELECT statement or empty string>",
  "explanation": "<one sentence explaining what the query does>"
}

Do not include any text outside the JSON object.
"""


def build_user_prompt(question: str) -> str:
    """
    Build the user-turn message: schema + question.

    The schema is injected here (not in the system prompt) so it stays
    fresh on every call — important when the DB schema can change.
    """
    schema = get_schema()
    schema_text = _format_schema(schema)

    return f"""Database schema:
{schema_text}

User question: {question}

Return only the JSON object described above."""


def _format_schema(schema: dict) -> str:
    """Convert the schema dict to a readable text block for the prompt."""
    lines: list[str] = []
    for table, columns in schema.items():
        col_defs = ", ".join(f"{c['name']} ({c['type']})" for c in columns)
        lines.append(f"  {table}: {col_defs}")
    return "\n".join(lines)
