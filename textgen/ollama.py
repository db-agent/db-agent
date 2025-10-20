"""Backward compatible import for Ollama adapter."""

from agent_runtime.llm.ollama import OllamaAdapter as OllamaClient

__all__ = ["OllamaClient"]
