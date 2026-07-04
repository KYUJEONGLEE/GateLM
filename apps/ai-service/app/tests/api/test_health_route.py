from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.adapters.safety.privacy_filter_adapter import KOELECTRA_PRIVACY_NER_MODEL
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
            ai_safety_additional_detector_model_ids=(
                ".cache/onnx/amoeba04--koelectra-small-v3-privacy-ner-quantized",
            ),
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
        self.assertEqual(
            detector["additionalModels"],
            [
                {
                    "modelId": KOELECTRA_PRIVACY_NER_MODEL,
                    "source": "koelectra_privacy_ner",
                    "runtime": "onnx",
                    "loadState": "configured",
                }
            ],
        )
        body_text = str(response.json())
        self.assertNotIn(".cache", body_text)
        self.assertNotIn("quantized", body_text)


if __name__ == "__main__":
    unittest.main()
