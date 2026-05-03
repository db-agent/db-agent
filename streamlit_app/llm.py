"""
llm.py — Thin wrapper around any OpenAI-compatible chat endpoint.

Teaching note:
    We depend on the OpenAI *protocol*, not the OpenAI *product*. Any service
    that speaks the same JSON-over-HTTP format works without code changes:

        OpenAI            https://api.openai.com/v1
        GitHub Models     https://models.github.ai/inference
        Groq              https://api.groq.com/openai/v1
        Together / Anyscale / Fireworks / OpenRouter / DeepInfra …
        Ollama   (local)  http://localhost:11434/v1
        LM Studio (local) http://localhost:1234/v1

    Two functions, intentionally split so they can be tested independently:

        call_llm()           — pure I/O: prompt in, raw text out
        parse_sql_response() — pure parsing: raw text in, SQLResponse out

    parse_sql_response() is defensive about real-world LLM output: models
    sometimes wrap JSON in markdown fences, prepend an explanation paragraph,
    or add a trailing comment. The three-stage fallback handles all of it.
"""

from __future__ import annotations

import json
import re

from openai import OpenAI

from models import LLMConfig, SQLResponse


def call_llm(system_prompt: str, user_prompt: str, llm_config: LLMConfig) -> str:
    """
    Send a chat completion request and return the raw assistant message.

    Teaching note:
        A fresh OpenAI client is created per call rather than cached at module
        scope. The cost is negligible (just an HTTP session) and it lets the
        sidebar swap base_url / api_key / model on the fly without restarting
        the app.
    """
    client = OpenAI(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key or "no-key",   # local models accept any non-empty string
    )
    response = client.chat.completions.create(
        model=llm_config.model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=0,   # deterministic output — important for a SQL agent
    )
    return response.choices[0].message.content or ""


def parse_sql_response(raw: str) -> SQLResponse:
    """
    Extract a SQLResponse from the LLM's raw text.

    Handles, in order:
        1. Clean JSON                — fastest path, json.loads() directly
        2. Fenced JSON (```json…```) — strip markdown fences, then loads
        3. Embedded JSON             — regex scan for the first {...} block

    Raises:
        ValueError if no JSON object can be found anywhere in the response.
    """
    # Strip any markdown code fences
    text = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()

    # Stage 1 + 2: maybe the whole thing is now valid JSON
    try:
        data = json.loads(text)
        return SQLResponse(
            sql=data.get("sql", "").strip(),
            explanation=data.get("explanation", "").strip(),
        )
    except json.JSONDecodeError:
        pass

    # Stage 3: find the first complete {...} block inside surrounding prose
    match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object found in LLM response:\n{raw}")

    data = json.loads(match.group())
    return SQLResponse(
        sql=data.get("sql", "").strip(),
        explanation=data.get("explanation", "").strip(),
    )
