from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.adapters.safety.privacy_filter_adapter import KOELECTRA_PRIVACY_NER_MODEL
from app.core.config import (
    DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID,
    DEFAULT_AI_SAFETY_DETECTOR_RUNTIME,
    DEFAULT_LLM_CLASSIFIER_BASE_URL,
    DEFAULT_LLM_CLASSIFIER_MAX_TOKENS,
    DEFAULT_LLM_CLASSIFIER_MODEL,
    DEFAULT_LLM_CLASSIFIER_TEMPERATURE,
    DEFAULT_LLM_CLASSIFIER_TIMEOUT_MS,
    DEFAULT_LLM_CLASSIFIER_TOTAL_TIMEOUT_MS,
    DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_CHARS,
    DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_COUNT,
    load_settings,
)
from app.main import run


class AiServiceLauncherConfigTests(unittest.TestCase):
    def test_settings_loads_configured_ai_safety_detector_model_id(self) -> None:
        env = {
            "AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID": KOELECTRA_PRIVACY_NER_MODEL,
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()

        self.assertEqual(settings.ai_safety_detector_model_id, KOELECTRA_PRIVACY_NER_MODEL)

    def test_settings_rejects_blank_or_whitespace_model_id(self) -> None:
        env = {
            "AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID": "bad model id",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()

        self.assertEqual(settings.ai_safety_detector_model_id, DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID)

    def test_settings_loads_additional_ai_safety_detector_model_ids(self) -> None:
        env = {
            "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS": (
                f"{KOELECTRA_PRIVACY_NER_MODEL}, custom/example-token-classifier,"
                f"{KOELECTRA_PRIVACY_NER_MODEL}, bad model id"
            ),
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()

        self.assertEqual(
            settings.ai_safety_additional_detector_model_ids,
            (KOELECTRA_PRIVACY_NER_MODEL, "custom/example-token-classifier"),
        )

    def test_settings_loads_ai_safety_detector_runtime(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME": "onnx"}, clear=True):
            settings = load_settings()

        self.assertEqual(settings.ai_safety_detector_runtime, "onnx")

    def test_settings_rejects_unknown_ai_safety_detector_runtime(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME": "bad"}, clear=True):
            settings = load_settings()

        self.assertEqual(settings.ai_safety_detector_runtime, DEFAULT_AI_SAFETY_DETECTOR_RUNTIME)

    def test_settings_defaults_llm_classifier_to_disabled_local_vllm_config(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_settings()

        self.assertFalse(settings.llm_classifier_enabled)
        self.assertEqual(settings.llm_classifier_base_url, DEFAULT_LLM_CLASSIFIER_BASE_URL)
        self.assertEqual(settings.llm_classifier_model, DEFAULT_LLM_CLASSIFIER_MODEL)
        self.assertEqual(settings.llm_classifier_timeout_ms, DEFAULT_LLM_CLASSIFIER_TIMEOUT_MS)
        self.assertEqual(settings.llm_classifier_total_timeout_ms, DEFAULT_LLM_CLASSIFIER_TOTAL_TIMEOUT_MS)
        self.assertEqual(settings.llm_classifier_window_max_chars, DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_CHARS)
        self.assertEqual(settings.llm_classifier_window_max_count, DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_COUNT)
        self.assertEqual(settings.llm_classifier_temperature, DEFAULT_LLM_CLASSIFIER_TEMPERATURE)
        self.assertEqual(settings.llm_classifier_max_tokens, DEFAULT_LLM_CLASSIFIER_MAX_TOKENS)

    def test_settings_loads_llm_classifier_env_overrides(self) -> None:
        env = {
            "AI_SERVICE_LLM_CLASSIFIER_ENABLED": "true",
            "AI_SERVICE_LLM_CLASSIFIER_BASE_URL": "http://127.0.0.1:9002/v1",
            "AI_SERVICE_LLM_CLASSIFIER_MODEL": "kakaocorp/kanana-1.5-8b-instruct-2505",
            "AI_SERVICE_LLM_CLASSIFIER_TIMEOUT_MS": "1200",
            "AI_SERVICE_LLM_CLASSIFIER_TOTAL_TIMEOUT_MS": "2200",
            "AI_SERVICE_LLM_CLASSIFIER_WINDOW_MAX_CHARS": "900",
            "AI_SERVICE_LLM_CLASSIFIER_WINDOW_MAX_COUNT": "2",
            "AI_SERVICE_LLM_CLASSIFIER_TEMPERATURE": "0",
            "AI_SERVICE_LLM_CLASSIFIER_MAX_TOKENS": "128",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()

        self.assertTrue(settings.llm_classifier_enabled)
        self.assertEqual(settings.llm_classifier_base_url, "http://127.0.0.1:9002/v1")
        self.assertEqual(settings.llm_classifier_model, "kakaocorp/kanana-1.5-8b-instruct-2505")
        self.assertEqual(settings.llm_classifier_timeout_ms, 1200)
        self.assertEqual(settings.llm_classifier_total_timeout_ms, 2200)
        self.assertEqual(settings.llm_classifier_window_max_chars, 900)
        self.assertEqual(settings.llm_classifier_window_max_count, 2)
        self.assertEqual(settings.llm_classifier_temperature, 0)
        self.assertEqual(settings.llm_classifier_max_tokens, 128)

    def test_launcher_passes_access_log_setting_to_uvicorn(self) -> None:
        env = {
            "AI_SERVICE_HOST": "127.0.0.9",
            "AI_SERVICE_PORT": "8011",
            "AI_SERVICE_LOG_LEVEL": "debug",
            "AI_SERVICE_ACCESS_LOG_ENABLED": "true",
        }
        with patch.dict(os.environ, env), patch("uvicorn.run") as uvicorn_run:
            run()

        uvicorn_run.assert_called_once()
        self.assertEqual(uvicorn_run.call_args.kwargs["host"], "127.0.0.9")
        self.assertEqual(uvicorn_run.call_args.kwargs["port"], 8011)
        self.assertEqual(uvicorn_run.call_args.kwargs["log_level"], "debug")
        self.assertTrue(uvicorn_run.call_args.kwargs["access_log"])


if __name__ == "__main__":
    unittest.main()
