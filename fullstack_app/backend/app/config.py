"""
config.py — Environment configuration loader.

All settings are read from environment variables (or a .env file during local dev).
In Lambda, these are set via template.yaml environment variables or AWS SSM/Secrets Manager.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# Database connection — SQLite for demo, swap for PostgreSQL/MySQL in production
DB_URL: str = os.getenv("DB_URL", "sqlite:///./data/demo.db")

# LLM settings — compatible with OpenAI, Groq, Ollama, LM Studio, etc.
LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
LLM_MODEL: str = os.getenv("LLM_MODEL", "gpt-4o-mini")

# CORS — set to your frontend domain in production
ALLOWED_ORIGINS: list[str] = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000"
).split(",")
