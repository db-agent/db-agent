"""Google Gemini adapter implementation."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterable, List, Optional, Sequence

from .base import LLMAdapter, PLAN_JSON_SCHEMA, SQL_JSON_SCHEMA
from .interfaces import PlanStep, SQLDraft

try:  # pragma: no cover - optional dependency at runtime
    import google.generativeai as genai
    from google.generativeai.types import GenerationConfig
except Exception:  # pragma: no cover - defensive import
    genai = None  # type: ignore[assignment]
    GenerationConfig = Any  # type: ignore[misc]

logger = logging.getLogger(__name__)


class GeminiAdapter(LLMAdapter):
    """Adapter that relies on the Google Generative AI Python SDK."""

    def __init__(self, endpoint: Optional[str], model: str, api_key: Optional[str] = None, timeout: float = 60.0) -> None:
        super().__init__(endpoint, model, api_key, timeout)
        if genai is None:
            raise RuntimeError("google-generativeai package is required for GeminiAdapter")
        if api_key:
            genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(model_name=model)

    # ------------------------------------------------------------------
    # Abstract implementations (unused by Gemini, but required by ABC)
    # ------------------------------------------------------------------
    def _normalize_endpoint(self, endpoint: Optional[str]) -> Optional[str]:
        return endpoint

    def _build_chat_payload(self, messages: Sequence[Dict[str, Any]], **kwargs: Any) -> Dict[str, Any]:  # pragma: no cover
        raise NotImplementedError("GeminiAdapter does not use HTTP chat payloads")

    def _build_plan_payload(self, question: str, schema: Optional[str]) -> Dict[str, Any]:  # pragma: no cover
        raise NotImplementedError("GeminiAdapter does not use HTTP plan payloads")

    def _build_sql_payload(
        self,
        question: str,
        schema: str,
        plan_steps: Optional[List[PlanStep]] = None,
    ) -> Dict[str, Any]:  # pragma: no cover
        raise NotImplementedError("GeminiAdapter does not use HTTP sql payloads")

    # ------------------------------------------------------------------
    # Gemini specific overrides
    # ------------------------------------------------------------------
    def plan(self, question: str, schema: Optional[str] = None) -> List[PlanStep]:
        prompt = "Plan the steps necessary to answer the question before writing SQL."
        payload = {"question": question, "schema": schema}
        generation_config = GenerationConfig(  # type: ignore[call-arg]
            temperature=0,
            response_mime_type="application/json",
            response_schema=PLAN_JSON_SCHEMA,
        )
        logger.debug("Gemini plan prompt payload=%s", payload)
        response = self._model.generate_content(
            [prompt, json.dumps(payload)],
            generation_config=generation_config,
        )
        data = self._parse_json_text(response)
        steps: List[PlanStep] = []
        for index, raw_step in enumerate(data.get("steps", []), start=1):
            step_id = int(raw_step.get("id", index))
            steps.append(
                PlanStep(
                    id=step_id,
                    summary=str(raw_step.get("summary", "")).strip(),
                    details=raw_step.get("details"),
                )
            )
        return steps

    def draft_sql(
        self,
        question: str,
        schema: str,
        plan_steps: Optional[List[PlanStep]] = None,
    ) -> SQLDraft:
        payload = {
            "question": question,
            "schema": schema,
            "plan": [
                {"id": step.id, "summary": step.summary, "details": step.details}
                for step in plan_steps or []
            ],
        }
        generation_config = GenerationConfig(  # type: ignore[call-arg]
            temperature=0,
            response_mime_type="application/json",
            response_schema=SQL_JSON_SCHEMA,
        )
        logger.debug("Gemini sql prompt payload=%s", payload)
        response = self._model.generate_content(
            [
                "Produce a SQL draft for the provided question and schema in JSON format.",
                json.dumps(payload),
            ],
            generation_config=generation_config,
        )
        data = self._parse_json_text(response)
        statement = str(data.get("statement", "")).strip()
        rationale = data.get("rationale")
        if not statement:
            raise ValueError("Gemini response did not contain a SQL statement")
        return SQLDraft(statement=statement, rationale=rationale)

    def generate_sql(self, question: str, schema: str) -> str:
        try:
            steps = self.plan(question, schema)
            draft = self.draft_sql(question, schema, steps)
            return draft.statement
        except Exception:  # pragma: no cover - defensive fallback
            logger.exception("Gemini structured SQL generation failed; using legacy path.")
            legacy = self.legacy_generate_sql(question, schema)
            if legacy is None:
                raise
            return legacy

    def stream(self, messages: Sequence[Dict[str, Any]], **kwargs: Any) -> Iterable[str]:
        logger.debug("Gemini streaming with %d messages", len(messages))
        stream = self._model.generate_content(messages, stream=True, **kwargs)
        for chunk in stream:
            text = getattr(chunk, "text", None) or "".join(
                getattr(part, "text", "") for part in getattr(chunk, "parts", [])
            )
            if text:
                yield text

    # ------------------------------------------------------------------
    # Legacy fallback
    # ------------------------------------------------------------------
    def legacy_generate_sql(self, question: str, schema: str) -> Optional[str]:
        prompt = (
            f"Generate a SQL query only to answer this question without explanation: `{question}`\n"
            f"DDL statements:\n{schema}\n"
        )
        try:
            response = self._model.generate_content(prompt)
            text = getattr(response, "text", None)
            if not text and getattr(response, "candidates", None):
                text = "".join(
                    getattr(part, "text", "")
                    for candidate in response.candidates
                    for part in getattr(candidate.content, "parts", [])
                )
            if not text:
                return None
            return self.extract_sql_statement(text)
        except Exception:  # pragma: no cover - defensive fallback
            logger.exception("Gemini legacy SQL generation failed.")
            return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _parse_json_text(self, response: Any) -> Dict[str, Any]:
        text = getattr(response, "text", None)
        if not text and getattr(response, "candidates", None):
            text = "".join(
                getattr(part, "text", "")
                for candidate in response.candidates
                for part in getattr(candidate.content, "parts", [])
            )
        if not text:
            return {}
        return json.loads(text)
