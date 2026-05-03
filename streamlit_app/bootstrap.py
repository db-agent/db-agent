"""
bootstrap.py — One-time setup that runs at app startup.

Teaching note:
    Streamlit Community Cloud gives you an ephemeral filesystem — every cold
    start begins from a clean clone of the repo. The demo SQLite database
    (data/demo.db) is gitignored, so it doesn't exist when the app first boots.

    This module checks for that case and seeds the DB by re-using the same
    script that local developers run by hand:

        python scripts/seed_demo_data.py

    Wrapping it in @st.cache_resource means the seeder runs at most once per
    container lifetime, even though Streamlit re-executes the script on every
    user interaction.

    The function is a no-op for non-SQLite databases (Postgres, MySQL …) —
    we never want to mutate someone's production database from a UI bootstrap.
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

    # The seeder script writes to <repo>/data/demo.db. Only auto-seed when
    # the configured path matches — for any other custom sqlite path we'd be
    # silently writing the wrong file.
    default_path = (Path(__file__).parent.parent / "data" / "demo.db").resolve()
    if db_path.resolve() != default_path:
        return f"skipped (custom path {db_path})"

    db_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # Imported lazily so this module stays importable even if the script
        # is missing (e.g. someone trimmed the repo for a minimal deploy).
        import sys
        scripts_dir = Path(__file__).parent.parent / "scripts"
        sys.path.insert(0, str(scripts_dir))
        import seed_demo_data  # type: ignore[import-not-found]
        seed_demo_data.seed()
        return f"seeded ({db_path.name})"
    except Exception as exc:
        return f"seed failed: {exc}"
