"""
llm.py — Thin wrapper around any OpenAI-compatible LLM API.

Teaching note:
    We depend only on the OpenAI *protocol* (not the OpenAI *product*).
    The same code works with:
      • OpenAI (api.openai.com)
      • Ollama  (localhost:11434/v1)
      • LM Studio (localhost:1234/v1)
      • Groq, Together, Anyscale …

    parse_sql_response() handles the LLM's JSON output defensively —
    models sometimes wrap JSON in markdown fences or add extra text.
"""

import json
import re
from openai import OpenAI
from app.models import LLMConfig, SQLResponse


def call_llm(system_prompt: str, user_prompt: str, config: LLMConfig) -> str:
    """
    Send a chat completion request and return the raw response string.

    A fresh OpenAI client is created per call so the UI can switch
    endpoints/keys at any time without restarting the app.
    Keeping this separate from parse_sql_response() makes it easy to
    unit-test parsing logic without hitting the API.
    """
    client = OpenAI(base_url=config.base_url, api_key=config.api_key or "no-key")
    response = client.chat.completions.create(
        model=config.model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=0,       # deterministic for demos
    )
    return response.choices[0].message.content or ""


def parse_sql_response(raw: str) -> SQLResponse:
    """
    Parse the LLM's text output into a SQLResponse.

    Handles common failure modes in order:
      1. Clean JSON  — try json.loads() directly (fastest path).
      2. Fenced JSON — model wraps output in ```json ... ``` blocks.
      3. Embedded JSON — model adds prose before/after the JSON object.
    """
    # Strip markdown code fences if present
    text = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()

    # Fast path: the whole response is already valid JSON
    try:
        data = json.loads(text)
        return SQLResponse(
            sql=data.get("sql", "").strip(),
            explanation=data.get("explanation", "").strip(),
        )
    except json.JSONDecodeError:
        pass

    # Fallback: find the first complete {...} block inside surrounding text
    match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object found in LLM response:\n{raw}")

    data = json.loads(match.group())
    return SQLResponse(
        sql=data.get("sql", "").strip(),
        explanation=data.get("explanation", "").strip(),
    )
