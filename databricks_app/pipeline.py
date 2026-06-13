"""
pipeline.py — Thin wrapper that binds the generic core pipeline to this app's
Databricks data layer, prompts, and extended safety rules.

Teaching note:
    The core orchestration lives in core/pipeline.py. This file supplies
    three things specific to the Databricks app:

        get_schema / run_query  ← Databricks SQL connector via connector.py
        SYSTEM_PROMPT           ← Databricks SQL + Unity Catalog prompt
        build_user_prompt       ← schema with FQN grouping from connector.py
        extra_forbidden         ← Delta maintenance commands blocked on top of
                                  the base set (OPTIMIZE, VACUUM, ZORDER, COPY)
"""

from __future__ import annotations

import config
from connector import get_schema, run_query
from core.models import LLMConfig, PipelineOutput
from core.pipeline import run_pipeline as _run
from prompts import SYSTEM_PROMPT, build_user_prompt

_DATABRICKS_EXTRA: frozenset[str] = frozenset({"OPTIMIZE", "VACUUM", "ZORDER", "COPY"})


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
        extra_forbidden=_DATABRICKS_EXTRA,
    )
