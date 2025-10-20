"""Backward compatible import for HuggingFace adapter."""

from agent_runtime.llm.huggingface import HuggingFaceAdapter as HuggingFaceClient

__all__ = ["HuggingFaceClient"]
