from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.adapters.safety.privacy_filter_adapter import KOELECTRA_PRIVACY_NER_MODEL
from app.core.config import (
    DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID,
    DEFAULT_AI_SAFETY_DETECTOR_RUNTIME,
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
