from __future__ import annotations

import asyncio
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from agent_runtime import ConfigService, ToolRegistry, register_default_tools


class _FakeSQLTool:
    def __init__(self) -> None:
        self.last_query: str | None = None

    def get_schema(self, config):  # pragma: no cover - config used indirectly
        assert config["DB_DRIVER"] == "postgres"
        return "table users (id int)"

    def run_query(self, config, query):
        self.last_query = query
        return [
            {"id": 1, "name": "Ada"},
            {"id": 2, "name": "Linus"},
        ]


@pytest.fixture
def registry_with_tools() -> ToolRegistry:
    config_service = ConfigService({"DB_DRIVER": "postgres"})
    registry = ToolRegistry()
    register_default_tools(
        config_service=config_service,
        registry=registry,
        sql_tool=_FakeSQLTool(),
    )
    return registry


def test_tool_definitions_registered(registry_with_tools: ToolRegistry) -> None:
    definitions = {definition.name: definition for definition in registry_with_tools.definitions()}
    assert {"schema_inspection", "run_sql", "summarize_results"} <= definitions.keys()

    schema_result = asyncio.run(definitions["schema_inspection"].invoke({}))
    assert schema_result == {"schema": "table users (id int)"}

    query_result = asyncio.run(definitions["run_sql"].invoke({"sql": "select * from users"}))
    assert registry_with_tools.get("sql").last_query == "select * from users"  # type: ignore[attr-defined]
    assert query_result["columns"] == ["id", "name"]
    assert query_result["rows"][0]["id"] == 1

    summary = asyncio.run(
        definitions["summarize_results"].invoke(
            {
                "rows": query_result["rows"],
                "columns": query_result["columns"],
            }
        )
    )
    assert "2 rows" in summary["summary"]
    assert "id" in summary["summary"]
