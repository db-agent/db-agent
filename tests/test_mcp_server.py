from __future__ import annotations

import io
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from agent_runtime import ConfigService, ToolRegistry, register_default_tools
from mcp_server.main import MCPServer


class _FakeSQLTool:
    def get_schema(self, config):
        return "table users (id int)"

    def run_query(self, config, query):
        return [
            {"id": 1, "name": "Ada"},
            {"id": 2, "name": "Linus"},
        ]


def _encode_message(payload: dict) -> bytes:
    body = json.dumps(payload).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
    return header + body


def _read_messages(stream: io.BytesIO) -> list[dict]:
    messages: list[dict] = []
    while True:
        header_line = stream.readline()
        if not header_line:
            break
        headers: dict[str, str] = {}
        while header_line not in (b"", b"\r\n"):
            key, value = header_line.decode("utf-8").split(":", 1)
            headers[key.strip().lower()] = value.strip()
            header_line = stream.readline()
        length = int(headers["content-length"])
        body = stream.read(length)
        messages.append(json.loads(body.decode("utf-8")))
    return messages


def test_mcp_server_round_trip() -> None:
    config_service = ConfigService({"DB_DRIVER": "postgres"})
    registry = ToolRegistry()
    register_default_tools(
        config_service=config_service,
        registry=registry,
        sql_tool=_FakeSQLTool(),
    )

    initialize = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"clientInfo": {"name": "test", "version": "0"}},
    }
    list_tools = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
    call_schema = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "schema_inspection", "arguments": {}},
    }
    call_query = {
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": {"name": "run_sql", "arguments": {"sql": "select * from users"}},
    }

    input_stream = io.BytesIO(
        _encode_message(initialize)
        + _encode_message(list_tools)
        + _encode_message(call_schema)
        + _encode_message(call_query)
    )
    output_stream = io.BytesIO()

    server = MCPServer(
        input_stream,
        output_stream,
        tool_registry=registry,
    )
    server.serve()

    output_stream.seek(0)
    responses = _read_messages(output_stream)
    assert len(responses) == 4

    assert responses[0]["result"]["protocolVersion"] == "0.1"
    assert len(responses[1]["result"]["tools"]) >= 3

    schema_payload = responses[2]["result"]["content"]
    assert schema_payload == {"schema": "table users (id int)"}

    query_payload = responses[3]["result"]["content"]
    assert query_payload["columns"] == ["id", "name"]
    assert query_payload["rows"][1]["name"] == "Linus"
