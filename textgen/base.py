"""Legacy interfaces retained for backward compatibility."""

from __future__ import annotations

from agent_runtime.llm.base import LLMAdapter


class TextGenBase(LLMAdapter):
    """Deprecated alias of :class:`agent_runtime.llm.base.LLMAdapter`."""

    def __init__(self, server_url, model_name, api_key=None, timeout: float = 60.0):
        super().__init__(server_url, model_name, api_key, timeout)

    # LLMAdapter already implements the required behaviour.
