"""Factory for instantiating provider specific LLM adapters."""

from __future__ import annotations

from agent_runtime.llm.base import LegacySQLWrapper
from agent_runtime.llm.huggingface import HuggingFaceAdapter
from agent_runtime.llm.ollama import OllamaAdapter
from agent_runtime.llm.openai import OpenAIAdapter
from agent_runtime.llm.gemini import GeminiAdapter


class LLMClientFactory:
    """Instantiate LLM adapters for the configured backend."""

    @staticmethod
    def get_client(backend, server_url, model_name, api_key):
        backend = (backend or "").lower()
        if backend == "huggingface":
            adapter = HuggingFaceAdapter(server_url, model_name, api_key)
        elif backend == "ollama":
            adapter = OllamaAdapter(server_url, model_name, api_key)
        elif backend == "openai":
            adapter = OpenAIAdapter(server_url, model_name, api_key)
        elif backend == "gemini":
            adapter = GeminiAdapter(server_url, model_name, api_key)
        else:
            raise ValueError(f"Unsupported LLM backend: {backend}")
        return LegacySQLWrapper(adapter)
