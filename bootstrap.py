"""
bootstrap.py — One-time setup that runs at app startup.

Checks whether the demo SQLite database exists and seeds it if not.
Wrapped in @st.cache_resource so the seeder runs at most once per
container lifetime regardless of Streamlit reruns.

No-op for non-SQLite databases — never mutates a production Postgres/MySQL DB.
"""

from pathlib import Path

import streamlit as st

import config


@st.cache_resource(show_spinner="Seeding demo database…")
def ensure_demo_db_seeded() -> str:
    """
    Seed the SQLite demo DB if it doesn't exist yet.

    Returns a short status string so the caller can show it in the sidebar.
    Never raises — failures are returned as the status message so the rest of
    the UI can still render (with an empty schema).
    """
    if not config.IS_SQLITE:
        return "skipped (non-sqlite DB)"

    db_path = Path(config.DB_URL.removeprefix("sqlite:///"))
    if db_path.exists() and db_path.stat().st_size > 0:
        return f"ready ({db_path.name})"

    default_path = (Path(__file__).parent / "data" / "demo.db").resolve()
    if db_path.resolve() != default_path:
        return f"skipped (custom path {db_path})"

    db_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent / "data"))
        import seed_demo_data  # type: ignore[import-not-found]
        seed_demo_data.seed()
        return f"seeded ({db_path.name})"
    except Exception as exc:
        return f"seed failed: {exc}"
