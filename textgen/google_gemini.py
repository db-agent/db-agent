"""Backward compatible import for Google Gemini adapter."""

from agent_runtime.llm.gemini import GeminiAdapter as GoogleGeminiClient

__all__ = ["GoogleGeminiClient"]
