"""
config.py — Environment configuration for the Databricks App.

Teaching note:
    This config module is Databricks-aware. When DATABRICKS_HOST is present
    (i.e. we're running inside a Databricks App or pointed at a workspace),
    the LLM defaults to Databricks Model Serving — so the entire agent
    (data + AI model) runs inside the customer's Databricks workspace.
    No external API keys required.

    Students can override at any time by setting LLM_BASE_URL + LLM_API_KEY
    to use Claude (Anthropic), Azure OpenAI, or any OpenAI-compatible endpoint.

Local dev (.env file):
    DATABRICKS_HOST=adb-xxxx.azuredatabricks.net
    DATABRICKS_TOKEN=dapi...
    DATABRICKS_CATALOG=main
    DATABRICKS_SCHEMA=default
    # Optional — leave blank to auto-discover SQL Warehouse
    DATABRICKS_HTTP_PATH=

    # LLM — defaults to Databricks Model Serving when DATABRICKS_HOST is set
    # Override to use Claude, OpenAI, Azure OpenAI, etc:
    # LLM_BASE_URL=https://api.anthropic.com/v1
    # LLM_API_KEY=sk-ant-...
    # LLM_MODEL=claude-3-5-haiku-20241022

Databricks App secrets:
    databricks secrets create-scope db-agent
    databricks secrets put-secret db-agent llm-api-key --string-value "..."
"""

import os
from dotenv import load_dotenv

# .env is used for local dev only; env vars set by Databricks Apps always win
load_dotenv(override=False)

# Inside a Databricks App, OAuth service principal is injected via
# DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET. Any leftover PAT from .env
# would clash with the SDK auth resolver ("more than one authorization method"),
# so prefer OAuth and discard the PAT when both are present.
if os.environ.get("DATABRICKS_CLIENT_ID") and os.environ.get("DATABRICKS_CLIENT_SECRET"):
    os.environ.pop("DATABRICKS_TOKEN", None)

# ── Databricks workspace ──────────────────────────────────────────────────────
DATABRICKS_HOST      = os.environ.get("DATABRICKS_HOST", "").strip().removeprefix("https://").removesuffix("/")
DATABRICKS_TOKEN     = os.environ.get("DATABRICKS_TOKEN", "").strip()
DATABRICKS_HTTP_PATH = os.environ.get("DATABRICKS_HTTP_PATH", "").strip()
DATABRICKS_CATALOG   = os.environ.get("DATABRICKS_CATALOG", "").strip()
DATABRICKS_SCHEMA    = os.environ.get("DATABRICKS_SCHEMA",  "").strip()

# True when running inside a Databricks workspace (App or local dev with DATABRICKS_HOST set)
IS_DATABRICKS_APP = bool(DATABRICKS_HOST)

# ── LLM settings ──────────────────────────────────────────────────────────────
# Default: Databricks Model Serving when inside a workspace (no external key needed)
# Override: set LLM_BASE_URL + LLM_MODEL to use Claude, OpenAI, Azure OpenAI, etc.

_default_llm_url   = f"https://{DATABRICKS_HOST}/serving-endpoints" if IS_DATABRICKS_APP else "https://api.openai.com/v1"
_default_llm_model = "databricks-meta-llama-3-3-70b-instruct"       if IS_DATABRICKS_APP else "gpt-4o-mini"

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", _default_llm_url)
LLM_MODEL    = os.environ.get("LLM_MODEL",    _default_llm_model)
# When using Databricks Model Serving, the workspace token doubles as the API key
LLM_API_KEY  = os.environ.get("LLM_API_KEY",  DATABRICKS_TOKEN).strip()

# If LLM_API_KEY still isn't set (env-var injection via `valueFrom` failed),
# fall back to reading the secret directly using the Databricks SDK.
# Requires DATABRICKS_SECRET_SCOPE + DATABRICKS_SECRET_KEY env vars.
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

APP_TITLE = "DB Agent · Databricks"
