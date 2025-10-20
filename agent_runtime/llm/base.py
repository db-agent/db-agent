"""Base utilities for LLM provider adapters."""

from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, Iterable, List, Optional, Sequence

import requests

from .interfaces import PlanStep, SQLDraft, PlanningInterface, StreamingInterface, ToolCallFormattingInterface

logger = logging.getLogger(__name__)


PLAN_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "summary": {"type": "string"},
                    "details": {"type": "string"},
                },
                "required": ["id", "summary"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["steps"],
    "additionalProperties": False,
}

SQL_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "statement": {"type": "string"},
        "rationale": {"type": "string"},
    },
    "required": ["statement"],
    "additionalProperties": False,
}


class LLMAdapter(PlanningInterface, ToolCallFormattingInterface, StreamingInterface, ABC):
    """Base class providing utilities for provider specific adapters."""

    def __init__(
        self,
        endpoint: Optional[str],
        model: str,
        api_key: Optional[str] = None,
        timeout: float = 60.0,
    ) -> None:
        self.endpoint = self._normalize_endpoint(endpoint)
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self._session = requests.Session()
        logger.debug("Initialised %s for model=%s", self.__class__.__name__, self.model)

    # ------------------------------------------------------------------
    # Abstract hooks
    # ------------------------------------------------------------------
    @abstractmethod
    def _normalize_endpoint(self, endpoint: Optional[str]) -> Optional[str]:
        """Return a provider specific endpoint from the configured value."""

    @abstractmethod
    def _build_chat_payload(self, messages: Sequence[Dict[str, Any]], **kwargs: Any) -> Dict[str, Any]:
        """Return a payload suitable for a standard chat completion call."""

    @abstractmethod
    def _build_plan_payload(self, question: str, schema: Optional[str]) -> Dict[str, Any]:
        """Return the payload used to request planning steps."""

    @abstractmethod
    def _build_sql_payload(
        self,
        question: str,
        schema: str,
        plan_steps: Optional[List[PlanStep]] = None,
    ) -> Dict[str, Any]:
        """Return the payload used to request a structured SQL draft."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def plan(self, question: str, schema: Optional[str] = None) -> List[PlanStep]:
        payload = self._build_plan_payload(question, schema)
        response = self._post_json(payload)
        data = self._extract_json_object(response)
        steps: List[PlanStep] = []
        for index, raw_step in enumerate(data.get("steps", []), start=1):
            step_id = int(raw_step.get("id", index))
            summary = str(raw_step.get("summary", "")).strip()
            details = raw_step.get("details")
            steps.append(PlanStep(id=step_id, summary=summary, details=details))
        return steps

    def draft_sql(
        self,
        question: str,
        schema: str,
        plan_steps: Optional[List[PlanStep]] = None,
    ) -> SQLDraft:
        payload = self._build_sql_payload(question, schema, plan_steps)
        response = self._post_json(payload)
        data = self._extract_json_object(response)
        statement = str(data.get("statement", "")).strip()
        rationale = data.get("rationale")
        if not statement:
            raise ValueError("Model did not return a SQL statement in the structured response.")
        return SQLDraft(statement=statement, rationale=rationale)

    def generate_sql(self, question: str, schema: str) -> str:
        """Compatibility wrapper for legacy callers expecting a SQL string."""

        try:
            plan_steps = self.plan(question, schema)
            draft = self.draft_sql(question, schema, plan_steps)
            return draft.statement
        except Exception:  # pragma: no cover - defensive fallback
            logger.exception("Structured SQL generation failed, using legacy pathway.")
            legacy_sql = self.legacy_generate_sql(question, schema)
            if legacy_sql is None:
                raise
            return legacy_sql

    def format_tool_call(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        return {"type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}

    def stream(self, messages: Sequence[Dict[str, Any]], **kwargs: Any) -> Iterable[str]:
        payload = self._build_chat_payload(messages, **kwargs)
        response = self._post_json(payload)
        content = self._extract_message_content(response)
        if content:
            yield content

    # ------------------------------------------------------------------
    # Fallback hooks
    # ------------------------------------------------------------------
    def legacy_generate_sql(self, question: str, schema: str) -> Optional[str]:
        """Override to provide a provider specific legacy SQL path."""

        return None

    # ------------------------------------------------------------------
    # Networking helpers
    # ------------------------------------------------------------------
    def _post_json(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.endpoint:
            raise RuntimeError("No endpoint configured for HTTP based provider.")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        logger.debug("POST %s payload=%s", self.endpoint, payload)
        response = self._session.post(
            self.endpoint,
            headers=headers,
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    # ------------------------------------------------------------------
    # Parsing helpers
    # ------------------------------------------------------------------
    def _extract_message_content(self, payload: Dict[str, Any]) -> Optional[str]:
        choice = (payload or {}).get("choices", [{}])[0]
        message = choice.get("message", {})
        content = message.get("content")
        if isinstance(content, list):  # OpenAI style content array
            return "".join(
                part.get("text", "") if isinstance(part, dict) else str(part) for part in content
            )
        return content

    def _extract_json_object(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_content = self._extract_message_content(payload)
        if isinstance(raw_content, dict):
            return raw_content
        if not raw_content:
            return {}
        try:
            return json.loads(raw_content)
        except json.JSONDecodeError as exc:  # pragma: no cover - depends on provider outputs
            raise ValueError("Expected JSON object in response content") from exc

    @staticmethod
    def extract_sql_statement(text: str) -> Optional[str]:
        sql_pattern = re.compile(r"(?is)\bselect\b.*?\bfrom\b.*?(?:;|$)")
        match = sql_pattern.search(text)
        return match.group(0).strip() if match else None


class LegacySQLWrapper:
    """Wrap an adapter to expose the legacy :py:meth:`generate_sql` API."""

    def __init__(self, adapter: LLMAdapter, fallback: Optional[Any] = None) -> None:
        self._adapter = adapter
        self._fallback = fallback

    def __getattr__(self, item: str) -> Any:  # pragma: no cover - passthrough
        return getattr(self._adapter, item)

    def generate_sql(self, question: str, schema: str) -> str:
        try:
            return self._adapter.generate_sql(question, schema)
        except Exception:  # pragma: no cover - defensive fallback
            if self._fallback is None:
                raise
            logger.exception("Adapter generate_sql failed; using supplied fallback callable.")
            return self._fallback(question, schema)
