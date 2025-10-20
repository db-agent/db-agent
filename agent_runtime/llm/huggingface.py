"""HuggingFace Text Generation Inference adapter."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Sequence

from .base import LLMAdapter, PLAN_JSON_SCHEMA, SQL_JSON_SCHEMA
from .interfaces import PlanStep

logger = logging.getLogger(__name__)


class HuggingFaceAdapter(LLMAdapter):
    """Adapter for HuggingFace Text Generation Inference deployments."""

    def _normalize_endpoint(self, endpoint: Optional[str]) -> Optional[str]:
        if endpoint is None:
            return None
        endpoint = endpoint.rstrip("/")
        if not endpoint.startswith("http"):
            endpoint = f"http://{endpoint}"
        if not endpoint.endswith("/v1/chat/completions"):
            endpoint = f"{endpoint}/v1/chat/completions"
        return endpoint

    def _build_chat_payload(self, messages: Sequence[Dict[str, Any]], **kwargs: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": list(messages),
            "temperature": kwargs.get("temperature", 0.7),
            "max_new_tokens": kwargs.get("max_new_tokens", 512),
        }
        payload.update({k: v for k, v in kwargs.items() if k not in payload})
        return payload

    def _build_plan_payload(self, question: str, schema: Optional[str]) -> Dict[str, Any]:
        system_prompt = "Plan the work before writing SQL. Return JSON only."
        user_payload = {
            "question": question,
            "schema": schema,
        }
        return {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload)},
            ],
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "plan_response",
                    "schema": PLAN_JSON_SCHEMA,
                },
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
                    "content": "Only return valid JSON describing the SQL draft.",
                },
                {"role": "user", "content": json.dumps(payload)},
            ],
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "sql_draft", "schema": SQL_JSON_SCHEMA},
            },
        }

    def legacy_generate_sql(self, question: str, schema: str) -> Optional[str]:
        prompt = (
            "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\n"
            f"Generate a SQL query only to answer this question without explanation: `{question}`\n"
            "DDL statements:\n"
            f"{schema}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"
        )
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "stream": False,
        }
        try:
            response = self._post_json(payload)
            text = self._extract_message_content(response) or ""
            return self.extract_sql_statement(text)
        except Exception:  # pragma: no cover - defensive fallback
            logger.exception("Legacy SQL generation failed for HuggingFace adapter.")
            return None
