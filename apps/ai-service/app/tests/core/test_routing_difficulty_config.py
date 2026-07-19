from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core.config import load_settings


class RoutingDifficultyConfigTests(unittest.TestCase):
    def test_remote_routing_is_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_settings()

        self.assertFalse(settings.routing_difficulty_enabled)
        self.assertEqual(settings.routing_difficulty_max_concurrent, 16)
        self.assertEqual(settings.routing_difficulty_onnx_intra_op_threads, 1)

    def test_local_mode_loads_explicit_remote_routing_settings(self) -> None:
        root = str(Path(tempfile.gettempdir()).resolve())
        env = {
            "DEPLOYMENT_MODE": "local",
            "AI_SERVICE_ROUTING_DIFFICULTY_ENABLED": "true",
            "AI_SERVICE_ROUTING_DIFFICULTY_SERVICE_TOKEN": "unit-routing-token",
            "AI_SERVICE_ROUTING_DIFFICULTY_ARTIFACT_ROOT": root,
            "AI_SERVICE_ROUTING_DIFFICULTY_ENCODER_MANIFEST": str(
                Path(root, "manifest.json")
            ),
            "AI_SERVICE_ROUTING_DIFFICULTY_MODEL_ARTIFACT": str(
                Path(root, "model.json")
            ),
            "AI_SERVICE_ROUTING_DIFFICULTY_MAX_CONCURRENT": "8",
            "AI_SERVICE_ROUTING_DIFFICULTY_ONNX_INTRA_OP_THREADS": "2",
            "AI_SERVICE_ROUTING_DIFFICULTY_ONNX_INTER_OP_THREADS": "1",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()

        self.assertTrue(settings.routing_difficulty_enabled)
        self.assertEqual(
            settings.routing_difficulty_service_token,
            "unit-routing-token",
        )
        self.assertEqual(settings.routing_difficulty_max_concurrent, 8)
        self.assertEqual(settings.routing_difficulty_onnx_intra_op_threads, 2)

    def test_production_mode_rejects_weak_remote_routing_token(self) -> None:
        root = str(Path(tempfile.gettempdir()).resolve())
        env = {
            "DEPLOYMENT_MODE": "aws",
            "AI_SERVICE_ROUTING_DIFFICULTY_ENABLED": "true",
            "AI_SERVICE_ROUTING_DIFFICULTY_SERVICE_TOKEN": "replace-me",
            "AI_SERVICE_ROUTING_DIFFICULTY_ARTIFACT_ROOT": root,
            "AI_SERVICE_ROUTING_DIFFICULTY_ENCODER_MANIFEST": str(
                Path(root, "manifest.json")
            ),
            "AI_SERVICE_ROUTING_DIFFICULTY_MODEL_ARTIFACT": str(
                Path(root, "model.json")
            ),
        }
        with patch.dict(os.environ, env, clear=True), self.assertRaisesRegex(
            ValueError,
            "AI_SERVICE_ROUTING_DIFFICULTY_SERVICE_TOKEN",
        ):
            load_settings()

    def test_remote_routing_concurrency_is_bounded(self) -> None:
        with patch.dict(
            os.environ,
            {"AI_SERVICE_ROUTING_DIFFICULTY_MAX_CONCURRENT": "65"},
            clear=True,
        ), self.assertRaisesRegex(ValueError, "MAX_CONCURRENT"):
            load_settings()


if __name__ == "__main__":
    unittest.main()
