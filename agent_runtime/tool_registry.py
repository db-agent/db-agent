"""Tool registry and database execution tools."""
from __future__ import annotations

import inspect
import os
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Iterable, Optional, cast

from connectors.sql_alchemy import SqlAlchemy


@dataclass
class ToolDefinition:
    """Description and runtime hook for a tool exposed to MCP clients."""

    name: str
    description: str
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]
    handler: Callable[[Dict[str, Any]], Any | Awaitable[Any]]

    async def invoke(self, arguments: Optional[Dict[str, Any]] = None) -> Any:
        """Execute the tool handler with optional arguments."""

        payload = arguments or {}
        result = self.handler(payload)
        if inspect.isawaitable(result):
            result = await cast(Awaitable[Any], result)
        return result

    def to_protocol_dict(self) -> Dict[str, Any]:
        """Return the MCP protocol representation of the tool."""

        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
            "outputSchema": self.output_schema,
        }


class ToolRegistry:
    """Registry for orchestrator tools and MCP tool definitions."""

    def __init__(self) -> None:
        self._tools: Dict[str, Any] = {}
        self._definitions: Dict[str, ToolDefinition] = {}

    def register(self, name: str, tool: Any) -> None:
        self._tools[name] = tool

    def register_definition(self, definition: ToolDefinition) -> None:
        self._definitions[definition.name] = definition

    def get(self, name: str) -> Any:
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' is not registered")
        return self._tools[name]

    def get_definition(self, name: str) -> ToolDefinition:
        if name not in self._definitions:
            raise KeyError(f"Tool definition '{name}' is not registered")
        return self._definitions[name]

    def definitions(self) -> Iterable[ToolDefinition]:
        return self._definitions.values()


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
