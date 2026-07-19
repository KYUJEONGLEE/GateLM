from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.dependencies import RoutingDifficultyConcurrencyGate
from app.core.config import Settings
from app.domain.routing_difficulty.runtime import RoutingDifficultyPrediction
from app.main import create_app
from app.schemas.routing_difficulty import (
    CONTRACT_VERSION,
    MODEL_CONTENT_HASH,
    MODEL_VERSION,
    RULE_VECTOR_DIMENSION,
    RULE_VECTOR_VERSION,
)
from app.services.routing_difficulty import RoutingDifficultyService


SERVICE_TOKEN = "0123456789abcdef0123456789abcdef"


class RoutingDifficultyRouteTests(unittest.TestCase):
    def test_authenticated_request_returns_only_pinned_decision_metadata(self) -> None:
        client = _routing_client(_FakeRuntime("complex"))

        response = client.post(
            "/internal/routing/difficulty/v1/classify",
            headers={"X-GateLM-AI-Service-Token": SERVICE_TOKEN},
            json=_request_payload("private instruction must not be returned"),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "contractVersion": CONTRACT_VERSION,
                "status": "ready",
                "difficulty": "complex",
                "modelVersion": MODEL_VERSION,
                "modelContentHash": MODEL_CONTENT_HASH,
            },
        )
        self.assertNotIn("private instruction", response.text)

    def test_missing_or_wrong_token_is_rejected(self) -> None:
        client = _routing_client(_FakeRuntime("simple"))

        for headers in ({}, {"X-GateLM-AI-Service-Token": "wrong"}):
            response = client.post(
                "/internal/routing/difficulty/v1/classify",
                headers=headers,
                json=_request_payload("private instruction"),
            )
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("private instruction", response.text)

    def test_runtime_failure_returns_sanitized_unavailable(self) -> None:
        client = _routing_client(_FailingRuntime())

        response = client.post(
            "/internal/routing/difficulty/v1/classify",
            headers={"X-GateLM-AI-Service-Token": SERVICE_TOKEN},
            json=_request_payload("secret prompt fragment"),
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json()["detail"]["code"],
            "routing_difficulty_unavailable",
        )
        self.assertNotIn("secret prompt fragment", response.text)


def _routing_client(runtime: object) -> TestClient:
    app = create_app(Settings())
    root = str(Path(tempfile.gettempdir()).resolve())
    app.state.settings = Settings(
        deployment_mode="local",
        routing_difficulty_enabled=True,
        routing_difficulty_service_token=SERVICE_TOKEN,
        routing_difficulty_artifact_root=root,
        routing_difficulty_encoder_manifest=str(Path(root, "manifest.json")),
        routing_difficulty_model_artifact=str(Path(root, "model.json")),
        routing_difficulty_max_concurrent=2,
    )
    app.state.routing_difficulty_service = RoutingDifficultyService(runtime)  # type: ignore[arg-type]
    app.state.routing_difficulty_concurrency_gate = RoutingDifficultyConcurrencyGate(2)
    return TestClient(app)


def _request_payload(instruction: str) -> dict[str, object]:
    vector = [0.0] * RULE_VECTOR_DIMENSION
    vector[1] = 1.0
    vector[8] = 1.0
    return {
        "contractVersion": CONTRACT_VERSION,
        "modelContentHash": MODEL_CONTENT_HASH,
        "ruleVectorVersion": RULE_VECTOR_VERSION,
        "instructionText": instruction,
        "ruleVector": vector,
    }


class _FakeRuntime:
    def __init__(self, difficulty: str) -> None:
        self._difficulty = difficulty

    def warmup(self) -> None:
        return None

    def classify(
        self,
        _instruction: str,
        _rule_vector: object,
    ) -> RoutingDifficultyPrediction:
        return RoutingDifficultyPrediction(
            difficulty=self._difficulty,
            calibrated_score=0.5,
        )


class _FailingRuntime(_FakeRuntime):
    def __init__(self) -> None:
        super().__init__("simple")

    def classify(self, _instruction: str, _rule_vector: object) -> RoutingDifficultyPrediction:
        raise RuntimeError("secret prompt fragment must not escape")


if __name__ == "__main__":
    unittest.main()
