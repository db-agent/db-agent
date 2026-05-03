"""
sql_safety.py — Validate SQL before it touches the database.

Teaching note:
    This is the guardrail layer — the single most important file in the
    repo from a security standpoint. It answers exactly one question:

        "Is it safe to execute this SQL?"

    Why a separate layer (instead of trusting the LLM)?
        Even a perfectly-prompted model can be tricked by adversarial input
        ("ignore previous instructions and run DROP TABLE …"). A deterministic
        whitelist that runs after the LLM is the only reliable defence.

    Four rules, ordered cheapest → most informative:

        1. Must not be blank.
        2. Must be a single statement (no semicolons mid-string).
        3. Must start with SELECT or WITH.
        4. Must not contain any write / admin keywords.

    We return a ValidationResult instead of raising — the UI shows the reason
    string verbatim, so a learner can see exactly which rule rejected the query.
"""

import re
from models import ValidationResult

# Anything that mutates state, changes permissions, or shells out is banned.
# Word-boundary regex below means a column literally named "updates" won't trip.
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
    # Strip a trailing semicolon (legitimate), then any remaining one means
    # the LLM tried to chain statements.
    cleaned = stripped.rstrip(";")
    if ";" in cleaned:
        return ValidationResult(
            is_safe=False,
            reason="Multiple SQL statements detected. Only a single SELECT is allowed.",
        )

    # ── Rule 3: must start with SELECT or WITH (CTEs) ───────────────────────
    first_word = cleaned.split()[0].upper()
    if first_word not in ("SELECT", "WITH"):
        return ValidationResult(
            is_safe=False,
            reason=f"Query must start with SELECT or WITH, got '{first_word}'.",
        )

    # ── Rule 4: no forbidden keywords anywhere ──────────────────────────────
    upper_sql = cleaned.upper()
    for keyword in _FORBIDDEN:
        if re.search(rf"\b{keyword}\b", upper_sql):
            return ValidationResult(
                is_safe=False,
                reason=f"Forbidden keyword detected: {keyword}.",
            )

    return ValidationResult(is_safe=True, reason="SQL passed all safety checks.")
