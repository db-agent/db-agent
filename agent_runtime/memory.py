"""Conversation memory primitives."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass
class MemoryRecord:
    """Representation of a single interaction."""

    nl_query: str
    sql: str


class ConversationMemory:
    """Simple in-memory store of NL/SQL pairs."""

    def __init__(self) -> None:
        self._history: List[MemoryRecord] = []

    def add(self, record: MemoryRecord) -> None:
        self._history.append(record)

    def add_interaction(self, nl_query: str, sql: str) -> None:
        self.add(MemoryRecord(nl_query=nl_query, sql=sql))

    def get_history(self) -> List[MemoryRecord]:
        return list(self._history)
