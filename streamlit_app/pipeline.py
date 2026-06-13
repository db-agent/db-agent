"""
pipeline.py — Thin wrapper that binds the generic core pipeline to this app's
database layer and prompts.

Teaching note:
    The core orchestration lives in core/pipeline.py. This file only supplies
    the three things that are specific to the streamlit_app:

        get_schema / run_query  ← SQLAlchemy via db.py
        SYSTEM_PROMPT           ← generic ANSI SQL prompt
        build_user_prompt       ← schema injected from db.py
"""

from __future__ import annotations

import config
from core.models import LLMConfig, PipelineOutput
from core.pipeline import run_pipeline as _run
from db import get_schema, run_query
from prompts import SYSTEM_PROMPT, build_user_prompt


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
    )
