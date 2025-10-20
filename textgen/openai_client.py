"""Backward compatible import for OpenAI adapter."""

from agent_runtime.llm.openai import OpenAIAdapter as OpenAIClient

__all__ = ["OpenAIClient"]
