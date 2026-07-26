"""
router.py — Ordered failover across a chain of LLM models.

All models in the chain share the same base_url and api_key from llm_config.
Models are tried left-to-right; the first successful response wins.

Configure via DBAGENT_MODEL_CHAIN env var (parsed in config.py):
    DBAGENT_MODEL_CHAIN=gpt-4o,gpt-4o-mini,gpt-3.5-turbo

Single-model deploys: leave DBAGENT_MODEL_CHAIN unset. config.py falls back
to [LLM_MODEL], so call_llm_with_failover behaves identically to call_llm
with zero overhead.
"""

from __future__ import annotations

import logging
from typing import Optional

from core.llm import call_llm
from core.models import LLMConfig

logger = logging.getLogger(__name__)


def call_llm_with_failover(
    system_prompt: str,
    user_prompt: str,
    llm_config: LLMConfig,
    chain: list[str],
) -> tuple[str, str]:
    """
    Try each model in chain until one returns a response.

    Args:
        system_prompt  — the system-turn message
        user_prompt    — the user-turn message
        llm_config     — connection settings (base_url, api_key);
                         model field is overridden per attempt
        chain          — ordered list of model IDs to try

    Returns:
        (raw_response, model_name) — the raw text and the model that answered

    Raises:
        The last exception raised if every model in the chain fails.
    """
    if not chain:
        chain = [llm_config.model]

    last_exc: Optional[BaseException] = None

    for model in chain:
        attempt = LLMConfig(
            base_url=llm_config.base_url,
            api_key=llm_config.api_key,
            model=model,
        )
        try:
            raw = call_llm(system_prompt, user_prompt, attempt)
            if len(chain) > 1:
                logger.info("[router] %s responded", model)
            return raw, model
        except Exception as exc:
            logger.warning("[router] %s failed: %s", model, exc)
            last_exc = exc

    raise last_exc or RuntimeError("model chain is empty")
