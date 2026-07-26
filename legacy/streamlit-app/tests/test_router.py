"""
test_router.py — Unit tests for the LLM failover router.

Run:  pytest tests/test_router.py -v
"""

from unittest.mock import patch

import pytest

from core.models import LLMConfig
from core.router import call_llm_with_failover


@pytest.fixture
def cfg():
    return LLMConfig(base_url="http://localhost/v1", api_key="test-key", model="model-a")


# ── Single-model (no failover) ────────────────────────────────────────────────

def test_single_model_returns_response(cfg):
    with patch("core.router.call_llm", return_value='{"sql":"SELECT 1","explanation":"test"}') as mock:
        raw, model = call_llm_with_failover("sys", "user", cfg, ["model-a"])
    assert raw == '{"sql":"SELECT 1","explanation":"test"}'
    assert model == "model-a"
    mock.assert_called_once()


def test_empty_chain_falls_back_to_config_model(cfg):
    with patch("core.router.call_llm", return_value="ok"):
        raw, model = call_llm_with_failover("sys", "user", cfg, [])
    assert model == cfg.model
    assert raw == "ok"


# ── Failover behaviour ────────────────────────────────────────────────────────

def test_failover_skips_to_second_model_on_failure(cfg):
    call_log = []

    def fake_llm(sys, user, attempt_cfg):
        call_log.append(attempt_cfg.model)
        if attempt_cfg.model == "model-a":
            raise RuntimeError("model-a is down")
        return "fallback response"

    with patch("core.router.call_llm", side_effect=fake_llm):
        raw, model = call_llm_with_failover("sys", "user", cfg, ["model-a", "model-b"])

    assert raw == "fallback response"
    assert model == "model-b"
    assert call_log == ["model-a", "model-b"]


def test_first_success_short_circuits_chain(cfg):
    """When the first model succeeds, the rest are never called."""
    call_log = []

    def fake_llm(sys, user, attempt_cfg):
        call_log.append(attempt_cfg.model)
        return "first response"

    with patch("core.router.call_llm", side_effect=fake_llm):
        raw, model = call_llm_with_failover("sys", "user", cfg, ["model-a", "model-b", "model-c"])

    assert model == "model-a"
    assert call_log == ["model-a"]


def test_all_models_fail_raises_last_exception(cfg):
    def fake_llm(sys, user, attempt_cfg):
        raise RuntimeError(f"{attempt_cfg.model} failed")

    with patch("core.router.call_llm", side_effect=fake_llm):
        with pytest.raises(RuntimeError, match="model-b failed"):
            call_llm_with_failover("sys", "user", cfg, ["model-a", "model-b"])


def test_attempt_config_uses_correct_model(cfg):
    """Router must override the model field, not reuse llm_config.model."""
    seen_models = []

    def fake_llm(sys, user, attempt_cfg):
        seen_models.append(attempt_cfg.model)
        if attempt_cfg.model != "model-c":
            raise RuntimeError("not c")
        return "ok"

    with patch("core.router.call_llm", side_effect=fake_llm):
        _, model = call_llm_with_failover("sys", "user", cfg, ["model-a", "model-b", "model-c"])

    assert seen_models == ["model-a", "model-b", "model-c"]
    assert model == "model-c"


def test_attempt_inherits_base_url_and_api_key(cfg):
    """Each attempt must carry the original base_url and api_key."""
    captured = []

    def fake_llm(sys, user, attempt_cfg):
        captured.append((attempt_cfg.base_url, attempt_cfg.api_key))
        return "ok"

    with patch("core.router.call_llm", side_effect=fake_llm):
        call_llm_with_failover("sys", "user", cfg, ["model-x"])

    assert captured == [(cfg.base_url, cfg.api_key)]
