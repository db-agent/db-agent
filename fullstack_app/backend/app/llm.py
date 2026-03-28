"""
llm.py — Thin wrapper around any OpenAI-compatible LLM API.

Works with: OpenAI, GitHub Models, Groq, Together AI, Ollama, LM Studio.
One client per request keeps Lambda cold starts clean.
"""

from __future__ import annotations
import json
import re
from openai import OpenAI
from .models import LLMConfig, SQLResponse


def call_llm(system_prompt: str, user_prompt: str, config: LLMConfig) -> str:
    """Send prompts to the configured LLM and return raw text."""
    client = OpenAI(
        base_url=config.base_url,
        api_key=config.api_key,
    )
    response = client.chat.completions.create(
        model=config.model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
    )
    return response.choices[0].message.content or ""


def parse_sql_response(raw_text: str) -> SQLResponse:
    """
    Extract the JSON payload from LLM output.

    LLMs sometimes wrap JSON in markdown fences or add surrounding text.
    This handles the common cases defensively.
    """
    # Strip markdown fences
    text = re.sub(r"```(?:json)?", "", raw_text).replace("```", "").strip()

    # Try direct parse
    try:
        data = json.loads(text)
        return SQLResponse(**data)
    except (json.JSONDecodeError, Exception):
        pass

    # Try finding first {...} block
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            return SQLResponse(**data)
        except Exception:
            pass

    # Fallback
    return SQLResponse(sql="", explanation=f"Could not parse LLM response: {raw_text[:200]}")
