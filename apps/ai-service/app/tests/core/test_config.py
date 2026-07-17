from __future__ import annotations

import os
import tempfile
import unittest
from dataclasses import fields
from pathlib import Path
from unittest.mock import patch

from app.adapters.safety.privacy_filter_adapter import KOELECTRA_PRIVACY_NER_MODEL
from app.core.config import (
    DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID,
    DEFAULT_AI_SAFETY_DETECTOR_RUNTIME,
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

        self.assertEqual(
            settings.ai_safety_detector_model_id, KOELECTRA_PRIVACY_NER_MODEL
        )

    def test_settings_rejects_blank_or_whitespace_model_id(self) -> None:
        env = {
            "AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID": "bad model id",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()

        self.assertEqual(
            settings.ai_safety_detector_model_id, DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID
        )

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
        with patch.dict(
            os.environ, {"AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME": "onnx"}, clear=True
        ):
            settings = load_settings()

        self.assertEqual(settings.ai_safety_detector_runtime, "onnx")

    def test_settings_defaults_ai_safety_detector_runtime_to_onnx(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_settings()

        self.assertEqual(DEFAULT_AI_SAFETY_DETECTOR_RUNTIME, "onnx")
        self.assertEqual(settings.ai_safety_detector_runtime, "onnx")

    def test_settings_rejects_unknown_ai_safety_detector_runtime(self) -> None:
        with patch.dict(
            os.environ, {"AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME": "bad"}, clear=True
        ):
            settings = load_settings()

        self.assertEqual(
            settings.ai_safety_detector_runtime, DEFAULT_AI_SAFETY_DETECTOR_RUNTIME
        )

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
                "ai_safety_detector_runtime",
                "deployment_mode",
                "rag_enabled",
                "rag_service_token",
                "rag_max_input_bytes",
                "rag_max_pdf_pages",
                "rag_max_extracted_chars",
                "rag_pdf_parse_timeout_seconds",
                "rag_min_pdf_text_chars",
                "rag_max_chunks",
                "rag_chunk_target_tokens",
                "rag_chunk_overlap_tokens",
                "rag_chunk_max_tokens",
                "rag_temp_dir",
                "rag_max_concurrent_extractions",
                "rag_pdf_memory_limit_bytes",
                "rag_pdf_cpu_limit_seconds",
            },
        )

    def test_rag_chunk_defaults_match_profile_v1(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_settings()

        self.assertEqual(settings.rag_chunk_target_tokens, 600)
        self.assertEqual(settings.rag_chunk_overlap_tokens, 100)
        self.assertEqual(settings.rag_chunk_max_tokens, 900)

    def test_production_like_environment_requires_strong_rag_service_token(
        self,
    ) -> None:
        for token in (
            "",
            "replace-me-with-a-random-32-character-token",
            "local-" + "x" * 40,
        ):
            with (
                self.subTest(token=token),
                patch.dict(
                    os.environ,
                    {
                        "DEPLOYMENT_MODE": "production",
                        "TENANT_CHAT_RAG_ENABLED": "true",
                        "AI_SERVICE_RAG_SERVICE_TOKEN": token,
                        "AI_SERVICE_RAG_TEMP_DIR": self._dedicated_temp_dir(),
                    },
                    clear=True,
                ),
            ):
                with self.assertRaisesRegex(ValueError, "AI_SERVICE_RAG_SERVICE_TOKEN"):
                    load_settings()

    def test_production_like_environment_accepts_distinct_strong_token(self) -> None:
        token = "prod-rag-service-8f3e6a17c29b4d50981234567890"
        with patch.dict(
            os.environ,
            {
                "DEPLOYMENT_MODE": "staging",
                "TENANT_CHAT_RAG_ENABLED": "true",
                "AI_SERVICE_RAG_SERVICE_TOKEN": token,
                "AI_SERVICE_RAG_TEMP_DIR": self._dedicated_temp_dir(),
            },
            clear=True,
        ):
            settings = load_settings()

        self.assertEqual(settings.rag_service_token, token)
        self.assertNotIn(token, repr(settings))

    def test_non_local_environment_requires_dedicated_absolute_temp_dir(self) -> None:
        base = {
            "DEPLOYMENT_MODE": "production",
            "TENANT_CHAT_RAG_ENABLED": "true",
            "AI_SERVICE_RAG_SERVICE_TOKEN": (
                "prod-rag-service-8f3e6a17c29b4d50981234567890"
            ),
        }
        for configured in (None, "relative/rag-temp"):
            env = dict(base)
            if configured is not None:
                env["AI_SERVICE_RAG_TEMP_DIR"] = configured
            with (
                self.subTest(configured=configured),
                patch.dict(os.environ, env, clear=True),
            ):
                with self.assertRaisesRegex(ValueError, "AI_SERVICE_RAG_TEMP_DIR"):
                    load_settings()

    def test_production_like_rag_disabled_does_not_require_token_or_temp_dir(
        self,
    ) -> None:
        with patch.dict(
            os.environ,
            {
                "DEPLOYMENT_MODE": "production",
                "TENANT_CHAT_RAG_ENABLED": "false",
            },
            clear=True,
        ):
            settings = load_settings()

        self.assertFalse(settings.rag_enabled)
        self.assertEqual(settings.rag_service_token, "")
        self.assertEqual(settings.rag_temp_dir, tempfile.gettempdir())

    def test_invalid_rag_feature_flag_fails_startup(self) -> None:
        with patch.dict(
            os.environ,
            {"TENANT_CHAT_RAG_ENABLED": "enabled"},
            clear=True,
        ):
            with self.assertRaisesRegex(ValueError, "TENANT_CHAT_RAG_ENABLED"):
                load_settings()

    def test_invalid_rag_resource_limits_fail_startup(self) -> None:
        cases = {
            "AI_SERVICE_RAG_MAX_CONCURRENT_EXTRACTIONS": "17",
            "AI_SERVICE_RAG_PDF_MEMORY_LIMIT_BYTES": "67108863",
            "AI_SERVICE_RAG_PDF_CPU_LIMIT_SECONDS": "121",
        }
        for key, value in cases.items():
            with (
                self.subTest(key=key),
                patch.dict(os.environ, {key: value}, clear=True),
            ):
                with self.assertRaisesRegex(ValueError, key):
                    load_settings()

    def test_invalid_chunk_configuration_fails_startup(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_SERVICE_RAG_CHUNK_TARGET_TOKENS": "100",
                "AI_SERVICE_RAG_CHUNK_OVERLAP_TOKENS": "100",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(ValueError, "overlap"):
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
        self.assertEqual(uvicorn_run.call_args.kwargs["host"], "127.0.0.9")
        self.assertEqual(uvicorn_run.call_args.kwargs["port"], 8011)
        self.assertEqual(uvicorn_run.call_args.kwargs["log_level"], "debug")
        self.assertTrue(uvicorn_run.call_args.kwargs["access_log"])

    @staticmethod
    def _dedicated_temp_dir() -> str:
        return str(Path(tempfile.gettempdir()) / "gatelm-rag-dedicated")


if __name__ == "__main__":
    unittest.main()
