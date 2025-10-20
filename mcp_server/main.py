"""Stdio MCP server exposing db-agent runtime tools."""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from typing import IO, Any, Dict, Optional

from agent_runtime import ConfigService, ToolRegistry, register_default_tools

LOGGER = logging.getLogger(__name__)


class MCPServer:
    """Minimal JSON-RPC 2.0 server that follows the MCP stdio transport."""

    def __init__(
        self,
        input_stream: IO[bytes],
        output_stream: IO[bytes],
        *,
        tool_registry: ToolRegistry,
    ) -> None:
        self._input = input_stream
        self._output = output_stream
        self._tool_registry = tool_registry
        self._initialized = False

    def serve(self) -> None:
        """Process JSON-RPC requests until the input stream is exhausted."""

        while True:
            try:
                payload = self._read_message()
            except Exception as exc:  # pragma: no cover - defensive error path
                LOGGER.exception("Failed to read MCP request")
                self._write_message(self._error_response(None, -32700, f"Parse error: {exc}"))
                break

            if payload is None:
                break

            try:
                response = asyncio.run(self._handle_request(payload))
            except Exception as exc:  # pragma: no cover - defensive error path
                LOGGER.exception("Unhandled error while processing MCP request")
                response = self._error_response(payload.get("id"), -32603, str(exc))

            if response is not None:
                self._write_message(response)

    async def _handle_request(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return self._error_response(None, -32600, "Invalid request.")

        request_id = payload.get("id")
        method = payload.get("method")
        params = payload.get("params") or {}
        jsonrpc = payload.get("jsonrpc")

        if jsonrpc != "2.0":
            return self._error_response(request_id, -32600, "Invalid JSON-RPC version.")

        if method == "initialize":
            self._initialized = True
            result = {
                "protocolVersion": "0.1",
                "serverInfo": {"name": "db-agent", "version": "0.1.0"},
                "capabilities": {
                    "tools": {"list": True, "call": True},
                },
            }
            return self._success_response(request_id, result)

        if method in {"shutdown", "exit"}:
            # Shutdown is best-effort; respond once and terminate.
            self._initialized = False
            return self._success_response(request_id, None)

        if request_id is None:
            # Notifications are acknowledged silently.
            return None

        if not self._initialized:
            return self._error_response(request_id, -32002, "Server is not initialized.")

        if method in {"tools/list", "list_tools"}:
            tools = [definition.to_protocol_dict() for definition in self._tool_registry.definitions()]
            return self._success_response(request_id, {"tools": tools})

        if method in {"tools/call", "call_tool"}:
            name = params.get("name")
            if not isinstance(name, str) or not name:
                return self._error_response(request_id, -32602, "Tool name must be provided.")
            try:
                definition = self._tool_registry.get_definition(name)
            except KeyError as exc:
                return self._error_response(request_id, -32601, str(exc))

            arguments = params.get("arguments") or {}
            if not isinstance(arguments, dict):
                return self._error_response(request_id, -32602, "Tool arguments must be an object.")

            try:
                result = await definition.invoke(arguments)
            except Exception as exc:
                LOGGER.exception("Tool '%s' raised an exception", name)
                return self._error_response(request_id, -32603, f"Tool '{name}' failed: {exc}")

            return self._success_response(request_id, {"content": result})

        return self._error_response(request_id, -32601, f"Unknown method: {method}")

    def _read_message(self) -> Optional[Dict[str, Any]]:
        header_lines = []
        while True:
            line = self._input.readline()
            if not line:
                return None
            if line == b"\r\n":
                break
            header_lines.append(line.decode("utf-8").rstrip("\r\n"))

        headers: Dict[str, str] = {}
        for header_line in header_lines:
            if ":" not in header_line:
                continue
            key, value = header_line.split(":", 1)
            headers[key.strip().lower()] = value.strip()

        content_length_raw = headers.get("content-length")
        if not content_length_raw:
            raise ValueError("Missing Content-Length header.")
        try:
            content_length = int(content_length_raw)
        except ValueError as exc:
            raise ValueError("Invalid Content-Length header.") from exc

        body = self._input.read(content_length)
        if len(body) < content_length:
            raise ValueError("Incomplete message body.")

        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON payload.") from exc

    def _write_message(self, message: Dict[str, Any]) -> None:
        payload = json.dumps(message).encode("utf-8")
        header = f"Content-Length: {len(payload)}\r\n\r\n".encode("ascii")
        self._output.write(header)
        self._output.write(payload)
        self._output.flush()

    @staticmethod
    def _success_response(request_id: Any, result: Any) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _error_response(request_id: Any, code: int, message: str) -> Dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config_service = ConfigService()
    registry = ToolRegistry()
    register_default_tools(config_service=config_service, registry=registry)

    server = MCPServer(
        sys.stdin.buffer,
        sys.stdout.buffer,
        tool_registry=registry,
    )
    server.serve()


if __name__ == "__main__":  # pragma: no cover - CLI entrypoint
    main()
