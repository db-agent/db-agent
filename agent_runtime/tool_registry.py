"""Tool registry and database execution tools."""
from __future__ import annotations

from typing import Any, Callable, Dict
import os

from connectors.sql_alchemy import SqlAlchemy


class ToolRegistry:
    """Registry for orchestrator tools."""

    def __init__(self) -> None:
        self._tools: Dict[str, Any] = {}

    def register(self, name: str, tool: Any) -> None:
        self._tools[name] = tool

    def get(self, name: str) -> Any:
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' is not registered")
        return self._tools[name]


class SQLExecutionTool:
    """Wrapper around a SQL connector used by the orchestrator."""

    def __init__(self, connector_factory: Callable[[Dict[str, Any]], SqlAlchemy]):
        self._connector_factory = connector_factory

    def get_schema(self, config: Dict[str, Any]) -> str:
        connector = self._connector_factory(config)
        return connector.get_db_schema()

    def run_query(self, config: Dict[str, Any], query: str) -> Any:
        connector = self._connector_factory(config)
        return connector.run_query(query)


def _apply_env(config: Dict[str, Any]) -> None:
    for key, value in config.items():
        if value is None:
            continue
        os.environ[key] = str(value)


def create_sqlalchemy_tool() -> SQLExecutionTool:
    """Create a SQL execution tool backed by :class:`SqlAlchemy`."""

    def factory(config: Dict[str, Any]) -> SqlAlchemy:
        _apply_env(config)
        return SqlAlchemy()

    return SQLExecutionTool(factory)
