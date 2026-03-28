"""
config.py — Load all configuration from environment variables.

Teaching note:
    Centralizing config here means every other module imports from one place.
    No magic strings scattered across the codebase.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env", override=True)

# ── Database ──────────────────────────────────────────────────────────────────
# Default to a local SQLite file so the demo runs with zero infrastructure.
DB_URL: str = os.getenv("DB_URL", "sqlite:///./data/demo.db")

# ── LLM ──────────────────────────────────────────────────────────────────────
# Any OpenAI-compatible endpoint works: OpenAI, Ollama, LM Studio, Groq …
LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY: str  = os.getenv("LLM_API_KEY", "")
LLM_MODEL: str    = os.getenv("LLM_MODEL", "gpt-4o-mini")

# ── Misc ──────────────────────────────────────────────────────────────────────
APP_TITLE: str = "DB Agent"
