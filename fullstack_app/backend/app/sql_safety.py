"""
sql_safety.py — SQL validation guardrails.

This is the security boundary between the LLM output and the database.
Every query passes through here before execution — no exceptions.

Design principle: fail closed. If validation is uncertain, reject.
"""

from __future__ import annotations
import re
from .models import ValidationResult

# Keywords that should never appear in a read-only query
FORBIDDEN_KEYWORDS = {
    "DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE",
    "CREATE", "REPLACE", "MERGE", "EXEC", "EXECUTE",
    "GRANT", "REVOKE", "ATTACH", "DETACH", "PRAGMA",
}


def validate_sql(sql: str) -> ValidationResult:
    """
    Validate a SQL string against the read-only ruleset.

    Returns ValidationResult(is_valid, errors).
    Validation is intentionally strict — this is a teaching safety boundary.
    """
    errors: list[str] = []

    if not sql or not sql.strip():
        errors.append("SQL is empty.")
        return ValidationResult(is_valid=False, errors=errors)

    normalized = sql.strip()

    # Rule 1: Must be a single statement
    # Strip trailing semicolon, then look for any remaining ones
    stripped = normalized.rstrip(";").strip()
    if ";" in stripped:
        errors.append("Multiple SQL statements are not allowed.")

    # Rule 2: Must start with SELECT
    first_token = stripped.split()[0].upper() if stripped else ""
    if first_token != "SELECT":
        errors.append(f"Only SELECT statements are allowed. Got: {first_token!r}.")

    # Rule 3: No forbidden keywords
    # Tokenize to avoid substring matches (e.g. "created_at" should not match "CREATE")
    tokens = set(re.findall(r"\b[A-Za-z_]+\b", normalized))
    found_forbidden = tokens & FORBIDDEN_KEYWORDS
    if found_forbidden:
        errors.append(
            f"Forbidden keyword(s) detected: {', '.join(sorted(found_forbidden))}."
        )

    return ValidationResult(is_valid=len(errors) == 0, errors=errors)
