"""
pipeline.py — Thin wrapper that binds the core pipeline to the active backend.

The active backend (SQLAlchemy or Databricks) is selected automatically from
the environment via the db package. Databricks mode also adds extra forbidden
keywords to the SQL safety check.
"""

from __future__ import annotations

import threading

import config
from core.memory import write_memory
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
    output = _run(
        question,
        active_config,
        get_schema=get_schema,
        run_query=run_query,
        system_prompt=SYSTEM_PROMPT,
        build_user_prompt=build_user_prompt,
        extra_forbidden=_EXTRA,
        model_chain=config.LLM_MODEL_CHAIN,
    )

    if config.MEMORY_ENABLED:
        # Fire-and-forget: memory is cross-platform context, not a critical
        # path — never block the UI on a second LLM call + store write.
        threading.Thread(
            target=write_memory,
            args=(output, active_config, config),
            daemon=True,
        ).start()

    return output
