"""
pipeline.py — Thin wrapper that binds the core pipeline to the active backend.

The active backend (SQLAlchemy or Databricks) is selected automatically from
the environment via the db package. Databricks mode also adds extra forbidden
keywords to the SQL safety check.
"""

from __future__ import annotations

import config
from core.models import LLMConfig, PipelineOutput
from core.pipeline import run_pipeline as _run
from db import IS_DATABRICKS_APP, get_schema, run_query
from prompts import SYSTEM_PROMPT, build_user_prompt

_EXTRA: frozenset[str] = (
    frozenset({"OPTIMIZE", "VACUUM", "ZORDER", "COPY"})
    if IS_DATABRICKS_APP else frozenset()
)


def run_pipeline(question: str, llm_config: LLMConfig | None = None) -> PipelineOutput:
    active_config = llm_config or LLMConfig(
        base_url=config.LLM_BASE_URL,
        api_key=config.LLM_API_KEY,
        model=config.LLM_MODEL,
    )
    return _run(
        question,
        active_config,
        get_schema=get_schema,
        run_query=run_query,
        system_prompt=SYSTEM_PROMPT,
        build_user_prompt=build_user_prompt,
        extra_forbidden=_EXTRA,
    )
