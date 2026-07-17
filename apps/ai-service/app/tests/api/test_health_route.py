from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import REMOTE_SAFETY_MODE_DISABLED, Settings
from app.main import create_app


class HealthRouteTests(unittest.TestCase):
    def test_healthz_reports_process_alive(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_DISABLED)))

        response = client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["service"], "ai-service")

    def test_readyz_does_not_require_remote_safety(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_DISABLED)))

        response = client.get("/readyz")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ready")
        self.assertFalse(body["dependencies"]["remoteSafety"]["required"])
        self.assertEqual(body["dependencies"]["remoteSafety"]["mode"], "disabled")

    def test_readyz_reports_sanitized_ai_safety_detector_state(self) -> None:
        settings = Settings(
            ai_safety_detector_runtime="onnx",
            ai_safety_detector_model_id=".cache/onnx/openai--privacy-filter",
            ai_safety_additional_detector_model_ids=(),
            ai_safety_ml_allowed_detector_types=("phone_number", "secret"),
        )
        client = TestClient(create_app(settings))

        response = client.get("/readyz")

        self.assertEqual(response.status_code, 200)
        detector = response.json()["dependencies"]["aiSafetyDetector"]
        self.assertEqual(detector["status"], "configured")
        self.assertFalse(detector["required"])
        self.assertEqual(detector["runtime"], "onnx")
        self.assertEqual(
            detector["primaryModel"],
            {
                "modelId": "openai/privacy-filter",
                "source": "openai_privacy_filter",
                "runtime": "onnx",
                "loadState": "configured",
            },
        )
        self.assertEqual(detector["additionalModels"], [])
        self.assertEqual(
            detector["mlAllowedDetectorTypes"],
            ["phone_number", "secret"],
        )
        body_text = str(response.json())
        self.assertNotIn(".cache", body_text)
        self.assertNotIn("quantized", body_text)

    def test_readyz_marks_preloaded_detector_as_required(self) -> None:
        settings = Settings(ai_safety_preload_enabled=True)
        app = create_app(Settings())
        app.state.settings = settings
        app.state.ai_safety_detector_service = _loaded_detector_service()
        client = TestClient(app)

        response = client.get("/readyz")

        self.assertEqual(response.status_code, 200)
        detector = response.json()["dependencies"]["aiSafetyDetector"]
        self.assertTrue(detector["required"])
        self.assertEqual(detector["status"], "loaded")
        self.assertEqual(
            detector["mlAllowedDetectorTypes"],
            ["phone_number", "secret"],
        )

    def test_startup_rejects_detector_type_unsupported_by_selected_model(self) -> None:
        with self.assertRaisesRegex(ValueError, "does not support"):
            create_app(
                Settings(ai_safety_ml_allowed_detector_types=("person_name",))
            )

    def test_preload_failure_stops_startup(self) -> None:
        with patch(
            "app.adapters.safety.privacy_filter_adapter.PrivacyFilterAdapter.warmup",
            side_effect=RuntimeError("synthetic preload failure"),
        ), self.assertRaisesRegex(RuntimeError, "synthetic preload failure"):
            create_app(Settings(ai_safety_preload_enabled=True))

    def test_readyz_returns_not_ready_when_required_detector_is_not_loaded(self) -> None:
        settings = Settings(ai_safety_preload_enabled=True)
        app = create_app(Settings())
        app.state.settings = settings
        client = TestClient(app)

        response = client.get("/readyz")

        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body["status"], "not_ready")
        detector = body["dependencies"]["aiSafetyDetector"]
        self.assertTrue(detector["required"])
        self.assertEqual(detector["status"], "configured")
        body_text = str(body)
        self.assertNotIn(".cache", body_text)
        self.assertNotIn("model_quantized", body_text)


def _loaded_detector_service():
    from app.adapters.safety.privacy_filter_adapter import PrivacyFilterAdapter
    from app.services.ai_safety_detector import AiSafetyDetectorService

    return AiSafetyDetectorService(
        adapter=PrivacyFilterAdapter(classifier=lambda _text: []),
        ml_allowed_detector_types=("phone_number", "secret"),
    )


if __name__ == "__main__":
    unittest.main()
