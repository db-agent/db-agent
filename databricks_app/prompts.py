"""
prompts.py — Prompt templates and schema-aware prompt builder.

Teaching note:
    The system prompt is the most critical guardrail in a data agent.
    It defines: what the model can do, what schema it knows about,
    and the exact JSON contract it must return.

    Databricks-specific additions vs. generic SQL:
      - Delta Lake table functions (e.g. table_changes) are mentioned
      - Unity Catalog three-part names (catalog.schema.table) are supported
      - OPTIMIZE / VACUUM / ZORDER are explicitly forbidden (write ops)
"""

from connector import get_schema


SYSTEM_PROMPT = """\
You are a Databricks SQL assistant. Your only job is to generate a single, safe, \
read-only SELECT (or WITH…SELECT) query against Databricks SQL.

Rules you must follow:
- Only use tables and columns present in the schema provided.
- Support Unity Catalog three-part names: catalog.schema.table when shown.
- Never use DROP, DELETE, UPDATE, INSERT, ALTER, TRUNCATE, MERGE, CREATE, REPLACE,
  OPTIMIZE, VACUUM, ZORDER, COPY INTO, or any write / maintenance operation.
- Write exactly one SELECT statement. No semicolons in the middle.
- Use Databricks SQL syntax (ANSI SQL + Spark extensions are fine).
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
    Build the user-turn message: current schema + user question.

    Teaching note:
        Schema is injected into the user turn (not baked into the system prompt)
        so it stays fresh — important when tables are added/dropped in Unity Catalog
        without restarting the app.
    """
    schema = get_schema()
    schema_text = _format_schema(schema)

    return f"""Databricks schema:
{schema_text}

User question: {question}

Return only the JSON object described above."""


def _format_schema(schema: dict) -> str:
    """Convert the schema dict to a compact text block for the prompt."""
    lines: list[str] = []
    for table, columns in schema.items():
        col_defs = ", ".join(f"{c['name']} ({c['type']})" for c in columns)
        lines.append(f"  {table}: {col_defs}")
    return "\n".join(lines)
