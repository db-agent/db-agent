"""Agent orchestrator and runtime client."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any, AsyncGenerator, Generator, List, Optional
import threading
import queue

from textgen.factory import LLMClientFactory

from .config_service import ConfigService
from .memory import ConversationMemory
from .tool_registry import ToolRegistry

logger = logging.getLogger(__name__)


class OrchestratorEventType(str, Enum):
    STATUS = "status"
    SQL = "sql"
    RESULT = "result"
    ERROR = "error"


@dataclass
class OrchestratorEvent:
    type: OrchestratorEventType
    payload: Any


class AgentOrchestrator:
    """Coordinates LLM and tool interactions for NL -> SQL execution."""

    def __init__(
        self,
        config_service: ConfigService,
        tool_registry: ToolRegistry,
        llm_client_factory: Any = LLMClientFactory,
        memory: Optional[ConversationMemory] = None,
        sql_tool_name: str = "sql",
    ) -> None:
        self.config_service = config_service
        self.tool_registry = tool_registry
        self.llm_client_factory = llm_client_factory
        self.memory = memory or ConversationMemory()
        self.sql_tool_name = sql_tool_name

    async def run_nl_query_async(self, nl_query: str) -> AsyncGenerator[OrchestratorEvent, None]:
        if not nl_query or not nl_query.strip():
            yield OrchestratorEvent(OrchestratorEventType.ERROR, "Natural language query cannot be empty.")
            return

        try:
            tool = self.tool_registry.get(self.sql_tool_name)
        except KeyError as exc:
            message = str(exc)
            logger.error("SQL tool missing: %s", message)
            yield OrchestratorEvent(OrchestratorEventType.ERROR, message)
            return

        config = self.config_service.get_config()
        if not config:
            msg = "Runtime configuration is empty."
            logger.error(msg)
            yield OrchestratorEvent(OrchestratorEventType.ERROR, msg)
            return

        yield OrchestratorEvent(OrchestratorEventType.STATUS, "Retrieving database schema...")

        try:
            schema = await asyncio.to_thread(tool.get_schema, config)
        except Exception as exc:  # pragma: no cover - defensive logging path
            logger.exception("Failed to fetch schema")
            yield OrchestratorEvent(OrchestratorEventType.ERROR, f"Failed to fetch schema: {exc}")
            return

        if not schema:
            message = "Database schema is empty; cannot generate SQL."
            logger.error(message)
            yield OrchestratorEvent(OrchestratorEventType.ERROR, message)
            return

        yield OrchestratorEvent(OrchestratorEventType.STATUS, "Generating SQL using LLM...")

        try:
            llm_client = self._build_llm_client(config)
            sql_query = await asyncio.to_thread(llm_client.generate_sql, nl_query, schema)
        except Exception as exc:
            logger.exception("Failed to generate SQL")
            yield OrchestratorEvent(OrchestratorEventType.ERROR, f"Failed to generate SQL: {exc}")
            return

        self.memory.add_interaction(nl_query=nl_query, sql=sql_query)
        yield OrchestratorEvent(OrchestratorEventType.SQL, sql_query)

        yield OrchestratorEvent(OrchestratorEventType.STATUS, "Executing SQL query...")

        try:
            result = await asyncio.to_thread(tool.run_query, config, sql_query)
        except Exception as exc:  # pragma: no cover - defensive logging path
            logger.exception("Failed to execute SQL")
            yield OrchestratorEvent(OrchestratorEventType.ERROR, f"Failed to execute SQL: {exc}")
            return

        if isinstance(result, str):
            yield OrchestratorEvent(OrchestratorEventType.ERROR, result)
            return

        yield OrchestratorEvent(OrchestratorEventType.RESULT, result)

    def run_nl_query(self, nl_query: str) -> List[OrchestratorEvent]:
        """Synchronous helper to collect orchestrator events."""

        async def collect() -> List[OrchestratorEvent]:
            return [event async for event in self.run_nl_query_async(nl_query)]

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(collect())
        finally:
            loop.close()

    def _build_llm_client(self, config: Any) -> Any:
        backend = (config.get("LLM_BACKEND") or config.get("LLM") or "").strip()
        if not backend:
            raise ValueError("LLM backend is not configured.")
        model_name = config.get("MODEL")
        server_url = config.get("LLM_ENDPOINT")
        api_key = config.get("LLM_API_KEY")
        return self.llm_client_factory.get_client(
            backend=backend,
            server_url=server_url,
            model_name=model_name,
            api_key=api_key,
        )


class AgentRuntimeClient:
    """Facade that exposes sync streaming APIs for the Streamlit app."""

    def __init__(self, orchestrator: AgentOrchestrator) -> None:
        self._orchestrator = orchestrator

    def stream_query(self, nl_query: str) -> Generator[OrchestratorEvent, None, None]:
        """Yield orchestrator events as they become available."""
        event_queue: "queue.Queue[Any]" = queue.Queue()
        sentinel = object()

        def runner() -> None:
            async def produce() -> None:
                try:
                    async for event in self._orchestrator.run_nl_query_async(nl_query):
                        event_queue.put(event)
                except Exception as exc:  # pragma: no cover - defensive logging path
                    logger.exception("Error while streaming orchestrator events")
                    event_queue.put(exc)
                finally:
                    event_queue.put(sentinel)

            loop = asyncio.new_event_loop()
            try:
                loop.run_until_complete(produce())
            finally:
                loop.close()

        thread = threading.Thread(target=runner, daemon=True)
        thread.start()

        while True:
            item = event_queue.get()
            if item is sentinel:
                break
            if isinstance(item, Exception):
                raise item
            yield item

    def run_query(self, nl_query: str) -> List[OrchestratorEvent]:
        return self._orchestrator.run_nl_query(nl_query)
