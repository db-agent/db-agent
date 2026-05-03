"""
config.py — Environment + secrets for the Streamlit app.

Teaching note:
    Centralizing config here means every other module imports from one place.
    Resolution order, highest priority first:

      1. Streamlit Community Cloud secrets   (st.secrets — secrets.toml UI)
      2. Process environment variables       (os.environ — Docker, shells)
      3. Local .env file at the repo root    (python-dotenv — local dev)
      4. Hard-coded defaults below           (last-resort fallback)

    The same module works in three deploy targets without code changes:
      • Local laptop      → reads .env
      • Docker / server   → reads container env vars
      • Streamlit Cloud   → reads st.secrets

    The sidebar in streamlit_app.py also lets the user override LLM settings
    interactively at runtime — useful when you want to swap models without
    redeploying.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).parent.parent

# .env is for local dev only; never present in production deploys.
# override=False means real environment variables win — important on Cloud.
load_dotenv(_REPO_ROOT / ".env", override=False)


# ── Secrets resolver ──────────────────────────────────────────────────────────
def _secret(name: str, default: str = "") -> str:
    """
    Read a setting from Streamlit secrets, then env vars, then default.

    Why this exists:
        Streamlit Community Cloud injects secrets via st.secrets only —
        they are NOT auto-exported as environment variables. Without this
        helper, every os.getenv() call on Cloud would silently return "".

    The import is local because importing streamlit at module load time
    breaks pytest collection (no ScriptRunContext outside a streamlit run).
    """
    try:
        import streamlit as st  # local import — see docstring
        if name in st.secrets:
            return str(st.secrets[name]).strip()
    except Exception:
        pass  # not running under streamlit, or secrets.toml not configured
    return os.environ.get(name, default).strip()


# ── Database ──────────────────────────────────────────────────────────────────
def _resolve_db_url(url: str) -> str:
    """Convert a relative SQLite path to an absolute one so CWD doesn't matter."""
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return url
    path = Path(url[len(prefix):])
    if path.is_absolute():
        return url
    return f"{prefix}{(_REPO_ROOT / path).resolve()}"


DB_URL: str = _resolve_db_url(
    _secret("DB_URL", f"sqlite:///{_REPO_ROOT / 'data' / 'demo.db'}")
)

# True when DB_URL points at SQLite — used by the auto-seed bootstrap so that
# Postgres / MySQL deployments don't trigger a SQLite-only seeder.
IS_SQLITE: bool = DB_URL.startswith("sqlite:///")


# ── LLM ───────────────────────────────────────────────────────────────────────
# Any OpenAI-compatible endpoint works: OpenAI, GitHub Models, Groq, Ollama, …
LLM_BASE_URL: str = _secret("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY:  str = _secret("LLM_API_KEY",  "")
LLM_MODEL:    str = _secret("LLM_MODEL",    "gpt-4o-mini")


# ── Misc ──────────────────────────────────────────────────────────────────────
APP_TITLE: str = "DB Agent"
