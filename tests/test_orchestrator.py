import pathlib
import sys

import pandas as pd
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from agent_runtime import (
    AgentOrchestrator,
    AgentRuntimeClient,
    ConfigService,
    OrchestratorEventType,
    ToolRegistry,
)


class DummyLLMClient:
    def __init__(self, sql_text: str) -> None:
        self.sql_text = sql_text
        self.calls = []

    def generate_sql(self, nl_query: str, schema: str) -> str:
        self.calls.append((nl_query, schema))
        return self.sql_text


class DummyFactory:
    def __init__(self, client: DummyLLMClient) -> None:
        self.client = client

    def get_client(self, **_: str) -> DummyLLMClient:  # type: ignore[override]
        return self.client


class RecordingTool:
    def __init__(self, result):
        self.result = result
        self.schema_calls = 0
        self.run_calls = []

    def get_schema(self, config):
        self.schema_calls += 1
        self.last_config = config
        return "table schema"

    def run_query(self, config, query):
        self.run_calls.append((config, query))
        return self.result


@pytest.fixture()
def base_config():
    return {
        "LLM_BACKEND": "openai",
        "MODEL": "gpt-4",
        "LLM_ENDPOINT": "http://example",
        "LLM_API_KEY": "token",
        "DB_DRIVER": "postgres",
        "DB_HOST": "localhost",
    }


def test_orchestrator_success_flow(base_config):
    tool = RecordingTool(pd.DataFrame({"id": [1]}))
    client = DummyLLMClient("SELECT * FROM table")
    factory = DummyFactory(client)

    registry = ToolRegistry()
    registry.register("sql", tool)
    orchestrator = AgentOrchestrator(
        config_service=ConfigService(base_config),
        tool_registry=registry,
        llm_client_factory=factory,
    )

    events = orchestrator.run_nl_query("show records")

    assert [event.type for event in events] == [
        OrchestratorEventType.STATUS,
        OrchestratorEventType.STATUS,
        OrchestratorEventType.SQL,
        OrchestratorEventType.STATUS,
        OrchestratorEventType.RESULT,
    ]
    assert tool.schema_calls == 1
    assert tool.run_calls[0][1] == "SELECT * FROM table"
    assert orchestrator.memory.get_history()[0].sql == "SELECT * FROM table"


def test_orchestrator_missing_tool_reports_error(base_config):
    orchestrator = AgentOrchestrator(
        config_service=ConfigService(base_config),
        tool_registry=ToolRegistry(),
        llm_client_factory=DummyFactory(DummyLLMClient("")),
    )

    events = orchestrator.run_nl_query("anything")

    assert len(events) == 1
    assert events[0].type == OrchestratorEventType.ERROR
    assert "Tool" in events[0].payload


def test_orchestrator_tool_error_surfaces_to_client(base_config):
    tool = RecordingTool("Database error")
    client = DummyLLMClient("SELECT 1")
    factory = DummyFactory(client)

    registry = ToolRegistry()
    registry.register("sql", tool)

    orchestrator = AgentOrchestrator(
        config_service=ConfigService(base_config),
        tool_registry=registry,
        llm_client_factory=factory,
    )

    events = orchestrator.run_nl_query("show records")

    assert events[-1].type == OrchestratorEventType.ERROR
    assert events[-1].payload == "Database error"


def test_runtime_client_streams_events_in_order(base_config):
    tool = RecordingTool([{"value": 1}])
    client = DummyLLMClient("SELECT value FROM table")
    factory = DummyFactory(client)

    registry = ToolRegistry()
    registry.register("sql", tool)
    orchestrator = AgentOrchestrator(
        config_service=ConfigService(base_config),
        tool_registry=registry,
        llm_client_factory=factory,
    )
    runtime_client = AgentRuntimeClient(orchestrator)

    streamed_types = [event.type for event in runtime_client.stream_query("give me value")]

    assert streamed_types == [
        OrchestratorEventType.STATUS,
        OrchestratorEventType.STATUS,
        OrchestratorEventType.SQL,
        OrchestratorEventType.STATUS,
        OrchestratorEventType.RESULT,
    ]
