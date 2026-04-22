"""
sql_safety.py — Validate SQL before it touches the database.

Teaching note:
    This is the guardrail layer. It answers one question:
    "Is it safe to execute this SQL?"

    Four rules (cheapest to most informative):
      1. Must not be blank.
      2. Must be a single statement (no semicolons mid-string).
      3. Must start with SELECT.
      4. Must not contain any write / admin keywords.

    Databricks-specific additions vs. generic SQL:
      - OPTIMIZE, VACUUM, ZORDER are Databricks Delta maintenance commands — blocked.
      - COPY INTO is a Databricks bulk-load command — blocked.
"""

import re
from models import ValidationResult

_FORBIDDEN = {
    # Standard write / DDL
    "DROP", "DELETE", "UPDATE", "INSERT", "ALTER",
    "TRUNCATE", "CREATE", "REPLACE", "MERGE", "EXEC", "EXECUTE",
    "GRANT", "REVOKE", "ATTACH", "DETACH",
    # Databricks / Delta-specific maintenance
    "OPTIMIZE", "VACUUM", "ZORDER", "COPY",
}


def validate_sql(sql: str) -> ValidationResult:
    """Return a ValidationResult describing whether the SQL is safe to run."""

    stripped = sql.strip()

    if not stripped:
        return ValidationResult(is_safe=False, reason="SQL is empty.")

    cleaned = stripped.rstrip(";")
    if ";" in cleaned:
        return ValidationResult(
            is_safe=False,
            reason="Multiple SQL statements detected. Only a single SELECT is allowed.",
        )

    first_word = cleaned.split()[0].upper()
    if first_word not in ("SELECT", "WITH"):
        return ValidationResult(
            is_safe=False,
            reason=f"Query must start with SELECT or WITH, got '{first_word}'.",
        )

    upper_sql = cleaned.upper()
    for keyword in _FORBIDDEN:
        if re.search(rf"\b{keyword}\b", upper_sql):
            return ValidationResult(
                is_safe=False,
                reason=f"Forbidden keyword detected: {keyword}.",
            )

    return ValidationResult(is_safe=True, reason="SQL passed all safety checks.")
