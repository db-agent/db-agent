"""
sql_safety.py — Validate SQL before it touches the database.

Teaching note:
    This is the guardrail layer. It answers one question:
    "Is it safe to execute this SQL?"

    Rules (ordered from cheapest to most informative):
      1. Must not be blank.
      2. Must be a single statement (no semicolons mid-string).
      3. Must start with SELECT.
      4. Must not contain any write/admin keywords.

    Returning a ValidationResult (not raising) keeps the pipeline clean
    and lets the UI display a friendly message instead of a stack trace.
"""

import re
from streamlit_app.models import ValidationResult

# Keywords that must never appear in a safe read-only query.
_FORBIDDEN = {
    "DROP", "DELETE", "UPDATE", "INSERT", "ALTER",
    "TRUNCATE", "CREATE", "REPLACE", "MERGE", "EXEC",
    "EXECUTE", "GRANT", "REVOKE", "ATTACH", "DETACH",
}


def validate_sql(sql: str) -> ValidationResult:
    """Return a ValidationResult describing whether the SQL is safe to run."""

    stripped = sql.strip()

    # ── Rule 1: not empty ────────────────────────────────────────────────────
    if not stripped:
        return ValidationResult(is_safe=False, reason="SQL is empty.")

    # ── Rule 2: single statement ─────────────────────────────────────────────
    # Remove any trailing semicolon, then check there are no more semicolons.
    cleaned = stripped.rstrip(";")
    if ";" in cleaned:
        return ValidationResult(
            is_safe=False,
            reason="Multiple SQL statements detected. Only a single SELECT is allowed.",
        )

    # ── Rule 3: must start with SELECT ───────────────────────────────────────
    first_word = cleaned.split()[0].upper()
    if first_word != "SELECT":
        return ValidationResult(
            is_safe=False,
            reason=f"Query must start with SELECT, got '{first_word}'.",
        )

    # ── Rule 4: no forbidden keywords ────────────────────────────────────────
    # Use word-boundary regex so e.g. "UPDATES" column name doesn't trigger.
    upper_sql = cleaned.upper()
    for keyword in _FORBIDDEN:
        pattern = rf"\b{keyword}\b"
        if re.search(pattern, upper_sql):
            return ValidationResult(
                is_safe=False,
                reason=f"Forbidden keyword detected: {keyword}.",
            )

    return ValidationResult(is_safe=True, reason="SQL passed all safety checks.")
