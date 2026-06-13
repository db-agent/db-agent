"""
prompts.py — System prompt and schema-aware user prompt builder.

The system prompt and schema label are selected based on the active backend
(IS_DATABRICKS_APP). The unified _format_schema() handles both bare table
names (SQLAlchemy) and fully-qualified names (Unity Catalog).
"""

import config
from db import IS_DATABRICKS_APP, get_schema

_GENERIC_SYSTEM_PROMPT = """\
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

_DATABRICKS_SYSTEM_PROMPT = """\
You are a Databricks SQL assistant. Your only job is to generate a single, safe, \
read-only SELECT (or WITH…SELECT) query against Databricks SQL.

Rules you must follow:
- Only use tables and columns present in the schema provided.
- Use fully-qualified names exactly as shown in the schema (catalog.schema.table).
- When the schema spans multiple catalogs (separated by `# <catalog>.<schema>`
  group headers), prefer cross-catalog joins when the question requires data
  from more than one store. The hint after each header tells you what each
  scope is best used for.
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

SYSTEM_PROMPT = _DATABRICKS_SYSTEM_PROMPT if IS_DATABRICKS_APP else _GENERIC_SYSTEM_PROMPT

_SCHEMA_LABEL = "Databricks schema" if IS_DATABRICKS_APP else "Database schema"


def build_user_prompt(question: str) -> str:
    """Compose the user-turn message: live schema snapshot + the user's question."""
    schema = get_schema()
    schema_text = _format_schema(schema)

    return f"""{_SCHEMA_LABEL}:
{schema_text}

User question: {question}

Return only the JSON object described above."""


def _format_schema(schema: dict) -> str:
    """
    Render the schema dict as a compact, prompt-friendly text block.

    Bare table names (SQLAlchemy):
        "  customers: id (INTEGER), name (TEXT), ..."

    Unity Catalog FQN keys (catalog.schema.table):
        Tables are grouped by catalog.schema with optional scope hints so the
        LLM can route cross-catalog joins.
    """
    is_fqn = any(k.count(".") >= 2 for k in schema)

    if not is_fqn:
        return "\n".join(
            f"  {table}: " + ", ".join(f"{c['name']} ({c['type']})" for c in cols)
            for table, cols in schema.items()
        )

    # Group by catalog.schema with optional per-scope hints.
    groups: dict[str, list[tuple[str, list]]] = {}
    for fqn, cols in schema.items():
        catalog, sch, _ = fqn.split(".", 2)
        groups.setdefault(f"{catalog}.{sch}", []).append((fqn, cols))

    lines: list[str] = []
    for scope, items in groups.items():
        catalog = scope.split(".", 1)[0]
        hint = config.DATABRICKS_SCOPE_HINTS.get(scope) or config.DATABRICKS_SCOPE_HINTS.get(catalog)
        lines.append(f"# {scope}" + (f" — {hint}" if hint else ""))
        for fqn, cols in items:
            col_defs = ", ".join(f"{c['name']} ({c['type']})" for c in cols)
            lines.append(f"  {fqn}: {col_defs}")
        lines.append("")
    return "\n".join(lines).rstrip()
