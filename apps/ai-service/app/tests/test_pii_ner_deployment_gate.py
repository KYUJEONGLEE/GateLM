from __future__ import annotations

import tempfile
import unittest
from contextlib import contextmanager
from collections.abc import Iterator
from pathlib import Path

from app.domain.ai_safety_training.koelectra_training import sha256_file
from app.services.pii_ner_deployment_gate_cli import (
    evaluate_deployment_gate,
    render_candidate_env,
    render_rollback_env,
    validate_runtime_model_path,
)


class PiiNerDeploymentGateTests(unittest.TestCase):
    def test_failed_candidate_is_blocked_without_requesting_more_evidence(self) -> None:
        with model_directory() as (model_dir, digest):
            candidate = candidate_report(digest, passed=False)

            result = evaluate_deployment_gate(
                candidate=candidate,
                promotion=None,
                model_dir=model_dir,
            )

        self.assertEqual(result["decision"], "blocked")
        self.assertEqual(
            result["reasonCodes"],
            ["candidate_engineering_gate_failed"],
        )
        self.assertTrue(result["rulesOnlyRollbackRequired"])

    def test_passed_candidate_still_requires_production_promotion_evidence(self) -> None:
        with model_directory() as (model_dir, digest):
            result = evaluate_deployment_gate(
                candidate=candidate_report(digest, passed=True),
                promotion=None,
                model_dir=model_dir,
            )

        self.assertEqual(result["decision"], "blocked")
        self.assertIn("production_promotion_evidence_missing", result["reasonCodes"])

    def test_complete_candidate_and_production_evidence_allow_activation(self) -> None:
        with model_directory() as (model_dir, digest):
            result = evaluate_deployment_gate(
                candidate=candidate_report(digest, passed=True),
                promotion=ready_promotion_report(),
                model_dir=model_dir,
            )

        self.assertEqual(result["decision"], "ready")
        self.assertTrue(result["candidateActivationAllowed"])
        self.assertEqual(result["reasonCodes"], [])

    def test_env_contract_has_explicit_activation_and_rules_only_rollback(self) -> None:
        candidate_env = render_candidate_env(
            ".cache/onnx/gatelm--koelectra-small-v3-pii-ner-quantized"
        )

        self.assertIn("GATEWAY_AI_SAFETY_SIDECAR_ENABLED=true", candidate_env)
        self.assertIn("GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY=true", candidate_env)
        self.assertIn("AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE=1", candidate_env)
        self.assertIn(
            "AI_SERVICE_AI_SAFETY_ML_DETECTOR_THRESHOLDS="
            "email=0.99,organization_name=0.90,person_name=0.90,"
            "phone_number=0.99,postal_address=0.90,"
            "resident_registration_number=0.99",
            candidate_env,
        )
        self.assertIn("AI_SERVICE_AI_SAFETY_PERSON_NAME_MODEL_ONLY=true", candidate_env)
        self.assertEqual(
            render_rollback_env(),
            "GATEWAY_AI_SAFETY_SIDECAR_ENABLED=false\n"
            "GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY=false\n"
            "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=\n"
            "AI_SERVICE_AI_SAFETY_PERSON_NAME_MODEL_ONLY=false\n",
        )

    def test_runtime_model_path_rejects_env_injection(self) -> None:
        with self.assertRaises(ValueError):
            validate_runtime_model_path(
                ".cache/onnx/gatelm--koelectra-small-v3-pii-ner-quantized\nBAD=true"
            )


@contextmanager
def model_directory() -> Iterator[tuple[Path, str]]:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        (root / "model.onnx").write_bytes(b"model")
        yield root, sha256_file(root / "model.onnx")


def candidate_report(digest: str, *, passed: bool) -> dict:
    return {
        "reportVersion": "gatelm.pii-ner-candidate-evaluation.v1",
        "status": "complete",
        "customerPromptUsed": False,
        "artifact": {"modelSha256": digest},
        "candidateGate": {
            "decision": "pass" if passed else "fail",
            "stage6DeploymentAllowed": passed,
            "failedChecks": [] if passed else ["holdoutMicroF1"],
        },
    }


def ready_promotion_report() -> dict:
    checks = [
        {"name": name, "status": "passed", "reasonCodes": []}
        for name in (
            "owner_policy",
            "artifact_integrity",
            "quality",
            "warm_runtime",
            "cold_runtime",
            "tenant_chat_e2e",
        )
    ]
    return {
        "schemaVersion": "pii-production-promotion-evidence.v1",
        "aggregateOnly": True,
        "decision": "ready",
        "readyForProduction": True,
        "gateCounts": {"passed": 6, "blocked": 0},
        "checks": checks,
    }


if __name__ == "__main__":
    unittest.main()
