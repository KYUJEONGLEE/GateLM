from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core.config import load_settings


class RoutingLightGBMShadowConfigTests(unittest.TestCase):
    def test_profile_is_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            settings = load_settings()
        self.assertFalse(settings.routing_lightgbm_shadow_enabled)
        self.assertEqual(settings.routing_lightgbm_shadow_max_concurrent, 4)

    def test_profile_loads_only_in_its_own_process(self) -> None:
        root = str(Path(tempfile.gettempdir()).resolve())
        env = {
            "DEPLOYMENT_MODE": "local",
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_ENABLED": "true",
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_SERVICE_TOKEN": "unit-token",
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_ARTIFACT_ROOT": root,
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_PROFILE_MANIFEST": str(
                Path(root, "profile.json")
            ),
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_PROFILE_MANIFEST_SHA256": "a" * 64,
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()
        self.assertTrue(settings.routing_lightgbm_shadow_enabled)
        self.assertFalse(settings.routing_difficulty_enabled)

    def test_lr_and_lightgbm_profiles_are_mutually_exclusive(self) -> None:
        root = str(Path(tempfile.gettempdir()).resolve())
        env = {
            "DEPLOYMENT_MODE": "local",
            "AI_SERVICE_ROUTING_DIFFICULTY_ENABLED": "true",
            "AI_SERVICE_ROUTING_DIFFICULTY_SERVICE_TOKEN": "unit-token",
            "AI_SERVICE_ROUTING_DIFFICULTY_ARTIFACT_ROOT": root,
            "AI_SERVICE_ROUTING_DIFFICULTY_ENCODER_MANIFEST": str(Path(root, "e5.json")),
            "AI_SERVICE_ROUTING_DIFFICULTY_MODEL_ARTIFACT": str(Path(root, "lr.json")),
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_ENABLED": "true",
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_SERVICE_TOKEN": "unit-token",
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_ARTIFACT_ROOT": root,
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_PROFILE_MANIFEST": str(
                Path(root, "profile.json")
            ),
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_PROFILE_MANIFEST_SHA256": "a" * 64,
        }
        with patch.dict(os.environ, env, clear=True), self.assertRaisesRegex(
            ValueError,
            "separate AI Service processes",
        ):
            load_settings()

    def test_profile_manifest_must_stay_within_artifact_root(self) -> None:
        root = Path(tempfile.gettempdir()).resolve() / "lightgbm-root"
        env = {
            "DEPLOYMENT_MODE": "local",
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_ENABLED": "true",
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_SERVICE_TOKEN": "unit-token",
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_ARTIFACT_ROOT": str(root),
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_PROFILE_MANIFEST": str(
                root.parent / "outside-profile.json"
            ),
            "AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_PROFILE_MANIFEST_SHA256": "a" * 64,
        }
        with patch.dict(os.environ, env, clear=True), self.assertRaisesRegex(
            ValueError,
            "within ARTIFACT_ROOT",
        ):
            load_settings()


if __name__ == "__main__":
    unittest.main()
