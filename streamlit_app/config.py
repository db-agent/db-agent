"""
config.py — Unified environment config for the DB Agent app.

Resolution order (highest priority first):
  1. Streamlit Community Cloud secrets  (st.secrets)
  2. Process environment variables      (os.environ)
  3. Local .env file at the repo root   (python-dotenv)
  4. Hard-coded defaults

When DATABRICKS_HOST is set the app connects to Databricks SQL and defaults
the LLM to Databricks Model Serving. Leave it unset for generic SQLAlchemy
mode (SQLite / Postgres / MySQL) with any OpenAI-compatible LLM.
"""

import json as _json
import os
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).parent.parent

# .env is for local dev only; real env vars (Databricks Apps, Docker) always win.
load_dotenv(_REPO_ROOT / ".env", override=False)

# Inside a Databricks App, OAuth credentials are injected as DATABRICKS_CLIENT_ID
# + DATABRICKS_CLIENT_SECRET. A leftover DATABRICKS_TOKEN from .env would clash
# ("more than one authorization method configured"), so we discard it.
if os.environ.get("DATABRICKS_CLIENT_ID") and os.environ.get("DATABRICKS_CLIENT_SECRET"):
    os.environ.pop("DATABRICKS_TOKEN", None)


# ── Secrets resolver ──────────────────────────────────────────────────────────
def _secret(name: str, default: str = "") -> str:
    """
    Read a setting from Streamlit secrets → env vars → default.

    Streamlit Community Cloud injects secrets via st.secrets only — they are
    NOT exported as environment variables. Without this helper, os.getenv()
    calls on Cloud silently return "".
    """
    try:
        import streamlit as st  # local import — avoids import errors outside streamlit
        if name in st.secrets:
            return str(st.secrets[name]).strip()
    except Exception:
        pass
    return os.environ.get(name, default).strip()


# ── Databricks workspace ──────────────────────────────────────────────────────
DATABRICKS_HOST      = os.environ.get("DATABRICKS_HOST", "").strip().removeprefix("https://").removesuffix("/")
DATABRICKS_TOKEN     = os.environ.get("DATABRICKS_TOKEN", "").strip()
DATABRICKS_HTTP_PATH = os.environ.get("DATABRICKS_HTTP_PATH", "").strip()
DATABRICKS_CATALOG   = os.environ.get("DATABRICKS_CATALOG", "").strip()
DATABRICKS_SCHEMA    = os.environ.get("DATABRICKS_SCHEMA",  "").strip()

# True when running inside or pointed at a Databricks workspace.
IS_DATABRICKS_APP: bool = bool(DATABRICKS_HOST)


# ── Multi-scope schema introspection (Databricks mode) ────────────────────────
# DATABRICKS_SCOPES enables cross-catalog joins:
#   DATABRICKS_SCOPES=lakebase_olist.public,db_agent.olap
# Unset → falls back to the single DATABRICKS_CATALOG + DATABRICKS_SCHEMA pair.

def _parse_scopes(raw: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = chunk.split(".")
        if len(parts) != 2:
            raise ValueError(
                f"DATABRICKS_SCOPES entry must be '<catalog>.<schema>', got '{chunk}'"
            )
        out.append((parts[0].strip(), parts[1].strip()))
    return out


_raw_scopes = os.environ.get("DATABRICKS_SCOPES", "").strip()
if _raw_scopes:
    DATABRICKS_SCOPES: list[tuple[str, str]] = _parse_scopes(_raw_scopes)
elif DATABRICKS_CATALOG and DATABRICKS_SCHEMA:
    DATABRICKS_SCOPES = [(DATABRICKS_CATALOG, DATABRICKS_SCHEMA)]
else:
    DATABRICKS_SCOPES = []

# Per-scope hints injected into the LLM prompt (JSON keyed by "catalog" or "catalog.schema").
_raw_hints = os.environ.get("DATABRICKS_SCOPE_HINTS", "").strip()
DATABRICKS_SCOPE_HINTS: dict[str, str] = {}
if _raw_hints:
    try:
        DATABRICKS_SCOPE_HINTS = _json.loads(_raw_hints)
    except _json.JSONDecodeError as _exc:
        print(f"[config] DATABRICKS_SCOPE_HINTS is not valid JSON: {_exc}")


# ── LLM ───────────────────────────────────────────────────────────────────────
# When IS_DATABRICKS_APP: default to Databricks Model Serving (no external key needed).
# Otherwise: default to OpenAI-compatible endpoint.
_default_llm_url   = f"https://{DATABRICKS_HOST}/serving-endpoints" if IS_DATABRICKS_APP else "https://api.openai.com/v1"
_default_llm_model = "databricks-meta-llama-3-3-70b-instruct"       if IS_DATABRICKS_APP else "gpt-4o-mini"

LLM_BASE_URL: str = _secret("LLM_BASE_URL", _default_llm_url)
LLM_MODEL:    str = _secret("LLM_MODEL",    _default_llm_model)
# Databricks token doubles as the LLM API key when using Model Serving.
LLM_API_KEY:  str = _secret("LLM_API_KEY",  DATABRICKS_TOKEN)

# SDK secret fallback: if LLM_API_KEY still isn't set, read it from a Databricks
# Secret Scope. Set DATABRICKS_SECRET_SCOPE + DATABRICKS_SECRET_KEY to configure.
if not LLM_API_KEY and IS_DATABRICKS_APP:
    _scope = os.environ.get("DATABRICKS_SECRET_SCOPE", "db-agent")
    _key   = os.environ.get("DATABRICKS_SECRET_KEY",   "github-token")
    try:
        import base64
        from databricks.sdk import WorkspaceClient
        _resp = WorkspaceClient().secrets.get_secret(scope=_scope, key=_key)
        LLM_API_KEY = base64.b64decode(_resp.value).decode().strip()
    except Exception as _exc:
        print(f"[config] could not load LLM_API_KEY from secret {_scope}/{_key}: {_exc}")


# ── Database (SQLAlchemy mode only) ───────────────────────────────────────────
def _resolve_db_url(url: str) -> str:
    """Convert a relative SQLite path to absolute so CWD doesn't matter."""
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
IS_SQLITE: bool = DB_URL.startswith("sqlite:///")


# ── Misc ──────────────────────────────────────────────────────────────────────
APP_TITLE: str = "DB Agent · Databricks" if IS_DATABRICKS_APP else "DB Agent"
