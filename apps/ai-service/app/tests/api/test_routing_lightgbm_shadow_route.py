from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.dependencies import RoutingDifficultyConcurrencyGate
from app.core.config import Settings
from app.domain.routing_lightgbm_shadow.runtime import (
    RoutingLightGBMShadowIdentity,
    RoutingLightGBMShadowPrediction,
)
from app.main import create_app
from app.schemas.routing_difficulty import RULE_VECTOR_DIMENSION, RULE_VECTOR_VERSION
from app.schemas.routing_lightgbm_shadow import CONTRACT_VERSION
from app.services.routing_difficulty_batcher import RoutingDifficultyBatcher
from app.services.routing_lightgbm_shadow import RoutingLightGBMShadowService


SERVICE_TOKEN = "0123456789abcdef0123456789abcdef"
MODEL_VERSION = "difficulty-lightgbm-shadow.unit.v1"
MODEL_HASH = "sha256:" + "a" * 64


class RoutingLightGBMShadowRouteTests(unittest.TestCase):
    def test_authenticated_request_returns_only_bounded_identity(self) -> None:
        client, batcher = _client(_FakeRuntime("complex"))
        try:
            response = client.post(
                "/internal/routing/difficulty/lightgbm-shadow/v1/classify",
                headers={"X-GateLM-AI-Service-Token": SERVICE_TOKEN},
                json=_payload("private instruction must not be returned"),
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json(),
                {
                    "contractVersion": CONTRACT_VERSION,
                    "status": "ready",
                    "difficulty": "complex",
                    "modelVersion": MODEL_VERSION,
                    "modelContentHash": MODEL_HASH,
                },
            )
            self.assertNotIn("private instruction", response.text)
        finally:
            batcher.close()

    def test_identity_mismatch_fails_before_inference(self) -> None:
        runtime = _FakeRuntime("simple")
        client, batcher = _client(runtime)
        try:
            payload = _payload("private instruction")
            payload["modelContentHash"] = "sha256:" + "b" * 64
            response = client.post(
                "/internal/routing/difficulty/lightgbm-shadow/v1/classify",
                headers={"X-GateLM-AI-Service-Token": SERVICE_TOKEN},
                json=payload,
            )
            self.assertEqual(response.status_code, 409)
            self.assertEqual(runtime.calls, 0)
        finally:
            batcher.close()

    def test_runtime_failure_is_sanitized(self) -> None:
        client, batcher = _client(_FailingRuntime("simple"))
        try:
            response = client.post(
                "/internal/routing/difficulty/lightgbm-shadow/v1/classify",
                headers={"X-GateLM-AI-Service-Token": SERVICE_TOKEN},
                json=_payload("secret prompt fragment"),
            )
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("secret prompt fragment", response.text)
        finally:
            batcher.close()

    def test_rule_vector_outside_contract_range_is_rejected(self) -> None:
        runtime = _FakeRuntime("simple")
        client, batcher = _client(runtime)
        try:
            payload = _payload("private instruction")
            payload["ruleVector"][0] = 1.01  # type: ignore[index]
            response = client.post(
                "/internal/routing/difficulty/lightgbm-shadow/v1/classify",
                headers={"X-GateLM-AI-Service-Token": SERVICE_TOKEN},
                json=payload,
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(runtime.calls, 0)
        finally:
            batcher.close()


def _client(runtime: object) -> tuple[TestClient, RoutingDifficultyBatcher]:
    app = create_app(Settings())
    root = str(Path(tempfile.gettempdir()).resolve())
    app.state.settings = Settings(
        deployment_mode="local",
        routing_lightgbm_shadow_enabled=True,
        routing_lightgbm_shadow_service_token=SERVICE_TOKEN,
        routing_lightgbm_shadow_artifact_root=root,
        routing_lightgbm_shadow_profile_manifest=str(Path(root, "profile.json")),
        routing_lightgbm_shadow_profile_manifest_sha256="a" * 64,
        routing_lightgbm_shadow_max_concurrent=2,
        routing_lightgbm_shadow_worker_count=1,
    )
    service = RoutingLightGBMShadowService(runtime)  # type: ignore[arg-type]
    batcher = RoutingDifficultyBatcher(
        service,  # type: ignore[arg-type]
        maximum_batch_size=1,
        maximum_wait_ms=0,
        queue_capacity=2,
        worker_count=1,
    )
    app.state.routing_lightgbm_shadow_service = service
    app.state.routing_lightgbm_shadow_batcher = batcher
    app.state.routing_lightgbm_shadow_concurrency_gate = RoutingDifficultyConcurrencyGate(2)
    return TestClient(app), batcher


def _payload(instruction: str) -> dict[str, object]:
    vector = [0.0] * RULE_VECTOR_DIMENSION
    vector[1] = 1.0
    vector[8] = 1.0
    return {
        "contractVersion": CONTRACT_VERSION,
        "modelVersion": MODEL_VERSION,
        "modelContentHash": MODEL_HASH,
        "ruleVectorVersion": RULE_VECTOR_VERSION,
        "instructionText": instruction,
        "ruleVector": vector,
    }


class _FakeRuntime:
    def __init__(self, difficulty: str) -> None:
        self._difficulty = difficulty
        self.calls = 0
        self._identity = RoutingLightGBMShadowIdentity(
            profile_version="difficulty-lightgbm-shadow.e5-base-768.v1",
            model_version=MODEL_VERSION,
            model_content_hash=MODEL_HASH,
            encoder_mode="e5_base",
            semantic_mode="raw_768",
            semantic_dimension=768,
            total_dimension=810,
        )

    @property
    def identity(self) -> RoutingLightGBMShadowIdentity:
        return self._identity

    def warmup(self) -> None:
        return None

    def classify_many(
        self,
        instruction_texts: object,
        _rule_vectors: object,
    ) -> list[RoutingLightGBMShadowPrediction]:
        self.calls += 1
        count = len(instruction_texts)  # type: ignore[arg-type]
        return [
            RoutingLightGBMShadowPrediction(
                difficulty=self._difficulty,
                score=0.5,
            )
            for _ in range(count)
        ]

    def classify(
        self,
        _instruction: str,
        _rule_vector: object,
    ) -> RoutingLightGBMShadowPrediction:
        self.calls += 1
        return RoutingLightGBMShadowPrediction(
            difficulty=self._difficulty,
            score=0.5,
        )


class _FailingRuntime(_FakeRuntime):
    def classify_many(
        self,
        _instruction_texts: object,
        _rule_vectors: object,
    ) -> list[RoutingLightGBMShadowPrediction]:
        raise RuntimeError("secret prompt fragment must not escape")


if __name__ == "__main__":
    unittest.main()
