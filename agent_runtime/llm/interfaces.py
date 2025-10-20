"""Core interfaces for large language model orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Protocol, Sequence


@dataclass
class PlanStep:
    """Represents a single planning step returned by a model."""

    id: int
    summary: str
    details: Optional[str] = None


@dataclass
class SQLDraft:
    """Represents a structured SQL draft returned by a model."""

    statement: str
    rationale: Optional[str] = None


class PlanningInterface(Protocol):
    """Interface for models capable of returning multi-step plans."""

    def plan(self, question: str, schema: Optional[str] = None) -> List[PlanStep]:
        """Return an ordered list of planning steps for the provided question."""


class ToolCallFormattingInterface(Protocol):
    """Interface for models that format tool calls."""

    def format_tool_call(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Format a tool invocation payload according to the provider contract."""


class StreamingInterface(Protocol):
    """Interface for models that support streaming responses."""

    def stream(
        self, messages: Sequence[Dict[str, Any]], **kwargs: Any
    ) -> Iterable[str]:
        """Yield chunks of assistant text for the provided chat messages."""
