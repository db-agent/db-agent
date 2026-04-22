"""
llm.py — LLM client supporting any OpenAI-compatible endpoint.

Compatible endpoints:
  • Databricks Model Serving  — https://{workspace}/serving-endpoints
  • OpenAI                    — https://api.openai.com/v1
  • Azure OpenAI              — https://{resource}.openai.azure.com/openai/deployments/{model}
  • Anthropic (via proxy)     — configure LLM_BASE_URL to any compatible proxy
  • Ollama / LM Studio        — http://localhost:11434/v1 (local dev)

Teaching note:
    The LLM is intentionally decoupled from the data layer. Swapping from
    Databricks Model Serving to Claude or GPT-4 is a one-line env var change.
    This is the "bring your own model" pattern used in enterprise deployments.
"""

import json
import re

from openai import OpenAI
from models import LLMConfig, SQLResponse


def call_llm(system_prompt: str, user_prompt: str, config: LLMConfig) -> str:
    """
    Send a chat completion request and return the raw response string.

    A fresh client is created per call — Streamlit re-runs on every
    interaction, so session state handles the config; the client is cheap.
    """
    client = OpenAI(
        base_url=config.base_url,
        api_key=config.api_key or "no-key",   # Ollama / local models need any non-empty string
    )
    response = client.chat.completions.create(
        model=config.model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=0,   # deterministic — important for a data query agent
    )
    return response.choices[0].message.content or ""


def parse_sql_response(raw: str) -> SQLResponse:
    """
    Parse the LLM's text output into a structured SQLResponse.

    Handles common model failure modes:
      1. Clean JSON               — json.loads() directly
      2. Fenced JSON (```json…```) — strip fences first
      3. JSON embedded in prose   — regex scan for first {...} block
    """
    text = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()

    try:
        data = json.loads(text)
        return SQLResponse(
            sql=data.get("sql", "").strip(),
            explanation=data.get("explanation", "").strip(),
        )
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object found in LLM response:\n{raw}")

    data = json.loads(match.group())
    return SQLResponse(
        sql=data.get("sql", "").strip(),
        explanation=data.get("explanation", "").strip(),
    )
