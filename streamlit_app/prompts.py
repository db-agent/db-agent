"""
prompts.py — System prompt + schema-aware user prompt builder.

Teaching note:
    The system prompt is the most important LLM guardrail. It defines:

        • the role           (read-only SQL assistant)
        • the constraints    (SELECT only, single statement, schema-bound)
        • the output format  (strict JSON the parser can rely on)

    We deliberately inject the live schema into the *user* turn (not the
    system prompt) so it stays fresh on every call. If you add or drop a
    table in the database, the next question sees the new schema with no
    restart and no caching gotchas.

    Keeping prompts in their own file makes them easy to diff, A/B test,
    and version — the prompt is product code, treat it that way.
"""

from db import get_schema


SYSTEM_PROMPT = """\
You are a SQL assistant. Your only job is to generate a single, safe, read-only \
SELECT (or WITH…SELECT) query against the database below.

Rules you must follow:
- Only use tables and columns that exist in the schema provided.
- Never use DROP, DELETE, UPDATE, INSERT, ALTER, TRUNCATE, MERGE, CREATE, REPLACE,
  GRANT, REVOKE, or any other write / admin operation.
- Write exactly one statement. No semicolons in the middle.
- Use standard ANSI SQL — the database may be SQLite, PostgreSQL, or MySQL.
- If the question cannot be answered from the schema, say so in the explanation
  and set sql to an empty string.

Always respond with valid JSON in this exact format:
{
  "sql": "<your SELECT statement or empty string>",
  "explanation": "<one sentence explaining what the query does>"
}

Do not include any text outside the JSON object.
"""


def build_user_prompt(question: str) -> str:
    """
    Compose the user-turn message: schema snapshot + the user's question.
    """
    schema = get_schema()
    schema_text = _format_schema(schema)

    return f"""Database schema:
{schema_text}

User question: {question}

Return only the JSON object described above."""


def _format_schema(schema: dict) -> str:
    """Render the schema dict as a compact, prompt-friendly text block."""
    lines: list[str] = []
    for table, columns in schema.items():
        col_defs = ", ".join(f"{c['name']} ({c['type']})" for c in columns)
        lines.append(f"  {table}: {col_defs}")
    return "\n".join(lines)
