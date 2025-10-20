"""Ollama chat completions adapter."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Sequence

from .base import LLMAdapter, PLAN_JSON_SCHEMA, SQL_JSON_SCHEMA
from .interfaces import PlanStep

logger = logging.getLogger(__name__)


class OllamaAdapter(LLMAdapter):
    """Adapter for the Ollama HTTP API."""

    def _normalize_endpoint(self, endpoint: Optional[str]) -> Optional[str]:
        if endpoint is None:
            return None
        endpoint = endpoint.rstrip("/")
        if not endpoint.startswith("http"):
            endpoint = f"http://{endpoint}"
        if not endpoint.endswith("/api/chat"):
            endpoint = f"{endpoint}/api/chat"
        return endpoint

    def _build_chat_payload(self, messages: Sequence[Dict[str, Any]], **kwargs: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": list(messages),
            "stream": False,
        }
        payload.update(kwargs)
        return payload

    def _build_plan_payload(self, question: str, schema: Optional[str]) -> Dict[str, Any]:
        user_payload = {
            "question": question,
            "schema": schema,
        }
        system_prompt = "Plan the answer in JSON before writing SQL."
        return {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload)},
            ],
            "stream": False,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "plan_response", "schema": PLAN_JSON_SCHEMA},
            },
        }

    def _build_sql_payload(
        self,
        question: str,
        schema: str,
        plan_steps: Optional[List[PlanStep]] = None,
    ) -> Dict[str, Any]:
        payload = {
            "question": question,
            "schema": schema,
            "plan": [
                {"id": step.id, "summary": step.summary, "details": step.details}
                for step in plan_steps or []
            ],
        }
        return {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": "Return JSON with a SQL statement under the 'statement' key.",
                },
                {"role": "user", "content": json.dumps(payload)},
            ],
            "stream": False,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "sql_draft", "schema": SQL_JSON_SCHEMA},
            },
        }

    def legacy_generate_sql(self, question: str, schema: str) -> Optional[str]:
        prompt = (
            "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n"
            f"Generate a SQL query only to answer this question without explanation: `{question}`\n"
            "considering values like true,TRUE,yes,Yes,YES in a case-insensitive manner.\n"
            "considering values like false,FALSE,no,No,NO in a case-insensitive manner.\n"
            "DDL statements:\n"
            f"{schema}<|start_header_id|>assistant<|end_header_id|>\n\n"
        )
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "temperature": 0,
        }
        try:
            response = self._post_json(payload)
            message = (response or {}).get("message", {})
            text = message.get("content") or self._extract_message_content(response) or ""
            return self.extract_sql_statement(text)
        except Exception:  # pragma: no cover - defensive fallback
            logger.exception("Legacy SQL generation failed for Ollama adapter.")
            return None
