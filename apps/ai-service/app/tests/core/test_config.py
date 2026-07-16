from __future__ import annotations

import os
import unittest
from dataclasses import fields
from unittest.mock import patch

from app.adapters.safety.privacy_filter_adapter import KOELECTRA_PRIVACY_NER_MODEL
from app.core.config import (
    DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID,
    DEFAULT_AI_SAFETY_DETECTOR_RUNTIME,
    DEFAULT_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES,
    DEFAULT_AZURE_PII_ALLOWED_DETECTOR_TYPES,
    Settings,
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

    def test_settings_defaults_to_selected_ml_detector_types(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_settings()

        self.assertEqual(
            settings.ai_safety_ml_allowed_detector_types,
            DEFAULT_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES,
        )

    def test_settings_loads_bounded_ml_detector_type_allowlist(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES": (
                    "secret, phone_number,secret"
                )
            },
            clear=True,
        ):
            settings = load_settings()

        self.assertEqual(
            settings.ai_safety_ml_allowed_detector_types,
            ("secret", "phone_number"),
        )

    def test_settings_rejects_empty_or_unknown_ml_detector_type_allowlist(self) -> None:
        for configured_value in ("", "phone_number,unknown_detector"):
            with self.subTest(configured_value=configured_value), patch.dict(
                os.environ,
                {"AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES": configured_value},
                clear=True,
            ):
                with self.assertRaises(ValueError):
                    load_settings()

    def test_settings_loads_ai_safety_detector_runtime(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME": "onnx"}, clear=True):
            settings = load_settings()

        self.assertEqual(settings.ai_safety_detector_runtime, "onnx")

    def test_settings_defaults_ai_safety_detector_runtime_to_onnx(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_settings()

        self.assertEqual(DEFAULT_AI_SAFETY_DETECTOR_RUNTIME, "onnx")
        self.assertEqual(settings.ai_safety_detector_runtime, "onnx")

    def test_settings_rejects_unknown_ai_safety_detector_runtime(self) -> None:
        with patch.dict(os.environ, {"AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME": "bad"}, clear=True):
            settings = load_settings()

        self.assertEqual(settings.ai_safety_detector_runtime, DEFAULT_AI_SAFETY_DETECTOR_RUNTIME)

    def test_settings_has_no_shadow_classifier_configuration(self) -> None:
        self.assertEqual(
            {field.name for field in fields(Settings)},
            {
                "host",
                "port",
                "log_level",
                "remote_safety_mode",
                "access_log_enabled",
                "ai_safety_detector_model_id",
                "ai_safety_additional_detector_model_ids",
                "ai_safety_ml_allowed_detector_types",
                "ai_safety_detector_runtime",
                "ai_safety_preload_enabled",
                "ai_safety_local_model_enabled",
                "azure_pii_enabled",
                "azure_pii_endpoint",
                "azure_pii_api_key",
                "azure_pii_api_version",
                "azure_pii_language",
                "azure_pii_timeout_ms",
                "azure_pii_allowed_detector_types",
            },
        )

    def test_settings_loads_ai_safety_preload_flag(self) -> None:
        with patch.dict(
            os.environ,
            {"AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED": "true"},
            clear=True,
        ):
            settings = load_settings()

        self.assertTrue(settings.ai_safety_preload_enabled)

    def test_settings_loads_azure_pii_configuration_without_exposing_api_key(self) -> None:
        env = {
            "AI_SERVICE_AI_SAFETY_LOCAL_MODEL_ENABLED": "false",
            "AI_SERVICE_AZURE_PII_ENABLED": "true",
            "AI_SERVICE_AZURE_PII_ENDPOINT": "http://localhost:5000",
            "AI_SERVICE_AZURE_PII_API_KEY": "secret-api-key",
            "AI_SERVICE_AZURE_PII_LANGUAGE": "ko-KR",
            "AI_SERVICE_AZURE_PII_TIMEOUT_MS": "1250",
            "AI_SERVICE_AZURE_PII_ALLOWED_DETECTOR_TYPES": "person_name,email,person_name",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()

        self.assertFalse(settings.ai_safety_local_model_enabled)
        self.assertTrue(settings.azure_pii_enabled)
        self.assertEqual(settings.azure_pii_endpoint, "http://localhost:5000")
        self.assertEqual(settings.azure_pii_language, "ko-KR")
        self.assertEqual(settings.azure_pii_timeout_ms, 1250)
        self.assertEqual(settings.azure_pii_allowed_detector_types, ("person_name", "email"))
        self.assertNotIn("secret-api-key", repr(settings))

    def test_settings_defaults_azure_pii_detector_type_allowlist(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_settings()

        self.assertEqual(
            settings.azure_pii_allowed_detector_types,
            DEFAULT_AZURE_PII_ALLOWED_DETECTOR_TYPES,
        )

    def test_settings_rejects_incomplete_or_disabled_model_backends(self) -> None:
        invalid_envs = (
            {
                "AI_SERVICE_AZURE_PII_ENABLED": "true",
            },
            {
                "AI_SERVICE_AI_SAFETY_LOCAL_MODEL_ENABLED": "false",
                "AI_SERVICE_AZURE_PII_ENABLED": "false",
            },
        )
        for env in invalid_envs:
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                with self.assertRaises(ValueError):
                    load_settings()

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
        self.assertNotIsInstance(uvicorn_run.call_args.args[0], str)
        self.assertEqual(uvicorn_run.call_args.kwargs["host"], "127.0.0.9")
        self.assertEqual(uvicorn_run.call_args.kwargs["port"], 8011)
        self.assertEqual(uvicorn_run.call_args.kwargs["log_level"], "debug")
        self.assertTrue(uvicorn_run.call_args.kwargs["access_log"])


if __name__ == "__main__":
    unittest.main()
