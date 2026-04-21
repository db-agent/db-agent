"""
config.py — Load all configuration from environment variables.

Teaching note:
    Centralizing config here means every other module imports from one place.
    No magic strings scattered across the codebase.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).parent.parent

load_dotenv(_REPO_ROOT / ".env", override=True)


def _resolve_db_url(url: str) -> str:
    """Convert relative SQLite paths to absolute so CWD doesn't matter."""
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return url
    path = Path(url[len(prefix):])
    if path.is_absolute():
        return url
    return f"{prefix}{(_REPO_ROOT / path).resolve()}"


# ── Database ──────────────────────────────────────────────────────────────────
DB_URL: str = _resolve_db_url(
    os.getenv("DB_URL", f"sqlite:///{_REPO_ROOT / 'data/demo.db'}")
)

# ── LLM ──────────────────────────────────────────────────────────────────────
# Any OpenAI-compatible endpoint works: OpenAI, Ollama, LM Studio, Groq …
LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY: str  = os.getenv("LLM_API_KEY", "")
LLM_MODEL: str    = os.getenv("LLM_MODEL", "gpt-4o-mini")

# ── Misc ──────────────────────────────────────────────────────────────────────
APP_TITLE: str = "DB Agent"
