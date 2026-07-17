from __future__ import annotations

import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from app.domain.ai_safety_promotion import (
    PromotionEvidenceError,
    build_promotion_evidence,
    scan_promotion_output,
)
from app.services import ai_safety_promotion_gate


REPO_ROOT = Path(__file__).resolve().parents[4]
CURRENT_MANIFEST = REPO_ROOT / "docs" / "ai-safety-lab" / "pii-model-manifest-20260715.json"
CURRENT_QUALITY = REPO_ROOT / "docs" / "ai-safety-lab" / "pii-model-evaluation-summary-20260715.json"
PROMOTION_PII_TYPES = (
    "email",
    "phone_number",
    "resident_registration_number",
    "account_number",
    "postal_address",
    "private_date",
    "private_url",
    "secret",
    "person_name",
    "organization_name",
)


class AiSafetyPromotionGateTests(unittest.TestCase):
    def test_current_656_percent_evidence_is_explicitly_blocked(self) -> None:
        manifest = load_json(CURRENT_MANIFEST)
        quality = load_json(CURRENT_QUALITY)

        evidence = build_promotion_evidence(manifest=manifest, quality=quality)

        self.assertEqual(quality["overall"]["passRate"], 0.656)
        self.assertFalse(evidence["readyForProduction"])
        self.assertEqual(evidence["decision"], "blocked")
        reason_codes = all_reason_codes(evidence)
        self.assertIn("owner_policy_missing", reason_codes)
        self.assertIn("untouched_holdout_missing", reason_codes)
        self.assertIn("span_level_metrics_missing", reason_codes)
        self.assertIn("rules_hybrid_ablation_missing", reason_codes)
        self.assertIn("quality_self_assessment_blocked", reason_codes)
        self.assertIn("warm_runtime_evidence_missing", reason_codes)
        self.assertIn("cold_runtime_evidence_missing", reason_codes)
        self.assertIn("tenant_chat_e2e_evidence_missing", reason_codes)

    def test_complete_owner_approved_aggregate_evidence_can_pass(self) -> None:
        fixtures = passing_fixtures()

        evidence = build_promotion_evidence(**fixtures)

        self.assertTrue(evidence["readyForProduction"])
        self.assertEqual(evidence["decision"], "ready")
        self.assertEqual(evidence["gateCounts"], {"passed": 6, "blocked": 0})
        self.assertTrue(all(check["reasonCodes"] == [] for check in evidence["checks"]))
        serialized = json.dumps(evidence, ensure_ascii=False)
        self.assertNotIn("synthetic/model", serialized)
        self.assertNotIn("revision-a", serialized)
        self.assertNotIn("a" * 64, serialized)

    def test_owner_threshold_failure_uses_bounded_reason_without_copying_values(self) -> None:
        fixtures = passing_fixtures()
        fixtures["quality"]["overall"]["passRate"] = 0.5

        evidence = build_promotion_evidence(**fixtures)

        self.assertFalse(evidence["readyForProduction"])
        self.assertIn("overall_quality_below_owner_threshold", all_reason_codes(evidence))
        self.assertNotIn("0.5", json.dumps(evidence))

    def test_mismatched_source_revision_is_blocked_without_echoing_revision(self) -> None:
        fixtures = passing_fixtures()
        fixtures["benchmark"]["evidenceBinding"]["gitRevision"] = "b" * 40

        evidence = build_promotion_evidence(**fixtures)

        self.assertIn("git_revision_mismatch", all_reason_codes(evidence))
        self.assertNotIn("b" * 40, json.dumps(evidence))

    def test_invalid_owner_policy_shapes_and_scalars_fail_closed(self) -> None:
        cases = {
            "extra_threshold": lambda policy: policy["thresholds"].__setitem__("unexpected", 1),
            "missing_threshold": lambda policy: policy["thresholds"].pop("maximumColdP95Ms"),
            "pass_rate_over_one": lambda policy: policy["thresholds"].__setitem__(
                "minimumOverallPassRate", 1.1
            ),
            "failure_rate_over_one": lambda policy: policy["thresholds"].__setitem__(
                "maximumStartupFailureRate", 1.1
            ),
            "zero_latency": lambda policy: policy["thresholds"].__setitem__(
                "maximumWarmSidecarP95Ms", 0
            ),
            "boolean_run_count": lambda policy: policy["thresholds"].__setitem__(
                "minimumColdStartRuns", True
            ),
            "invalid_type_key": lambda policy: policy["thresholds"][
                "minimumPrecisionByPiiType"
            ].__setitem__("Email", 0.8),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                fixtures = passing_fixtures()
                policy = copy.deepcopy(fixtures["owner_policy"])
                mutate(policy)
                fixtures["owner_policy"] = policy

                evidence = build_promotion_evidence(**fixtures)

                owner_check = next(
                    check for check in evidence["checks"] if check["name"] == "owner_policy"
                )
                self.assertEqual(owner_check["status"], "blocked")
                self.assertFalse(evidence["readyForProduction"])

    def test_owner_cannot_promote_an_implicit_one_type_scope(self) -> None:
        fixtures = passing_fixtures()
        fixtures["owner_policy"]["scope"]["requiredPiiTypes"] = ["email"]
        fixtures["owner_policy"]["thresholds"]["minimumPrecisionByPiiType"] = {
            "email": 0.8
        }
        fixtures["owner_policy"]["thresholds"]["minimumRecallByPiiType"] = {
            "email": 0.8
        }

        evidence = build_promotion_evidence(**fixtures)

        self.assertFalse(evidence["readyForProduction"])
        self.assertIn("owner_scope_incomplete", all_reason_codes(evidence))

    def test_owner_cannot_promote_a_single_locale_scope(self) -> None:
        fixtures = passing_fixtures()
        fixtures["owner_policy"]["scope"]["requiredLocales"] = ["ko-KR"]

        evidence = build_promotion_evidence(**fixtures)

        self.assertFalse(evidence["readyForProduction"])
        self.assertIn("owner_locale_scope_incomplete", all_reason_codes(evidence))

    def test_invalid_binding_shape_and_non_full_git_oid_fail_closed(self) -> None:
        cases = {
            "extra_field": lambda binding: binding.__setitem__("unexpected", True),
            "short_git_oid": lambda binding: binding.__setitem__("gitRevision", "abc123"),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                fixtures = passing_fixtures()
                mutate(fixtures["quality"]["evidenceBinding"])

                evidence = build_promotion_evidence(**fixtures)

                self.assertFalse(evidence["readyForProduction"])
                self.assertIn("provenance_binding_invalid", all_reason_codes(evidence))

    def test_input_versions_and_cold_aggregate_consistency_are_enforced(self) -> None:
        mutations = {
            "artifact_version": (
                "artifact_verification",
                lambda value: value.__setitem__("schemaVersion", "wrong"),
                "artifact_verification_version_invalid",
            ),
            "benchmark_version": (
                "benchmark",
                lambda value: value["metadata"].__setitem__("reportVersion", "wrong"),
                "warm_runtime_evidence_version_invalid",
            ),
            "benchmark_git_revision": (
                "benchmark",
                lambda value: value["metadata"].__setitem__("gitSha", "b" * 40),
                "warm_runtime_git_revision_mismatch",
            ),
            "cold_counts": (
                "cold_start",
                lambda value: value.__setitem__("successfulRuns", 4),
                "cold_run_counts_inconsistent",
            ),
            "cold_failure_rate": (
                "cold_start",
                lambda value: value.__setitem__("startupFailureRate", 0.5),
                "cold_failure_rate_inconsistent",
            ),
            "cold_percentiles": (
                "cold_start",
                lambda value: value.__setitem__("coldP50Ms", 11000),
                "cold_percentiles_inconsistent",
            ),
            "e2e_version": (
                "tenant_chat_e2e",
                lambda value: value.__setitem__("schemaVersion", "wrong"),
                "tenant_chat_e2e_version_invalid",
            ),
        }
        for name, (fixture_name, mutate, expected_reason) in mutations.items():
            with self.subTest(name=name):
                fixtures = passing_fixtures()
                mutate(fixtures[fixture_name])

                evidence = build_promotion_evidence(**fixtures)

                self.assertFalse(evidence["readyForProduction"])
                self.assertIn(expected_reason, all_reason_codes(evidence))

    def test_no_timeout_warm_run_can_pass_when_e2e_fallback_is_verified(self) -> None:
        fixtures = passing_fixtures()
        fixtures["benchmark"]["decisionSummary"]["timeoutFallbackGate"] = "not_exercised"

        evidence = build_promotion_evidence(**fixtures)

        self.assertTrue(evidence["readyForProduction"])

    def test_v2_warm_runtime_evidence_remains_backward_compatible(self) -> None:
        fixtures = passing_fixtures()
        fixtures["benchmark"]["metadata"]["reportVersion"] = (
            "ai-safety-resource-latency-benchmark.v2"
        )
        runtime = fixtures["benchmark"]["runtimeResults"][0]
        for field_name in (
            "modelActiveRequestCount",
            "modelInvocationCount",
            "acceptedModelDetectionCount",
            "p50ModelActiveSidecarLatencyMs",
            "p95ModelActiveSidecarLatencyMs",
            "executionModeCounts",
        ):
            runtime.pop(field_name)

        evidence = build_promotion_evidence(**fixtures)

        self.assertTrue(evidence["readyForProduction"])

    def test_v3_warm_runtime_requires_consistent_model_active_evidence(self) -> None:
        mutations = {
            "missing": lambda runtime: runtime.pop("modelActiveRequestCount"),
            "no_active_requests": lambda runtime: runtime.__setitem__(
                "modelActiveRequestCount", 0
            ),
            "mode_mismatch": lambda runtime: runtime.__setitem__(
                "executionModeCounts", {"rules_only": 90, "hybrid": 10}
            ),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                fixtures = passing_fixtures()
                mutate(fixtures["benchmark"]["runtimeResults"][0])

                evidence = build_promotion_evidence(**fixtures)

                self.assertFalse(evidence["readyForProduction"])
                self.assertTrue(
                    {
                        "warm_runtime_model_active_evidence_missing",
                        "warm_runtime_model_active_evidence_invalid",
                    }.intersection(all_reason_codes(evidence))
                )

    def test_output_scanner_rejects_raw_content_field(self) -> None:
        evidence = build_promotion_evidence(
            manifest=load_json(CURRENT_MANIFEST),
            quality=load_json(CURRENT_QUALITY),
        )
        unsafe = dict(evidence)
        unsafe["rawPrompt"] = "synthetic"

        with self.assertRaises(PromotionEvidenceError):
            scan_promotion_output(unsafe)

    def test_output_scanner_rejects_raw_pii_and_endpoint_location(self) -> None:
        evidence = build_promotion_evidence(
            manifest=load_json(CURRENT_MANIFEST),
            quality=load_json(CURRENT_QUALITY),
        )
        unsafe_pii = dict(evidence)
        unsafe_pii["note"] = "synthetic.person@example.test"
        unsafe_location = dict(evidence)
        unsafe_location["note"] = "https://internal.invalid/detect"

        with self.assertRaises(PromotionEvidenceError):
            scan_promotion_output(unsafe_pii)
        with self.assertRaises(PromotionEvidenceError):
            scan_promotion_output(unsafe_location)

    def test_cli_expect_blocked_writes_only_aggregate_current_decision(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "promotion.json"
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = ai_safety_promotion_gate.run(
                    [
                        "--manifest",
                        str(CURRENT_MANIFEST),
                        "--quality",
                        str(CURRENT_QUALITY),
                        "--out",
                        str(output_path),
                        "--expect-blocked",
                    ]
                )

            self.assertEqual(exit_code, 0)
            evidence = load_json(output_path)
            self.assertEqual(evidence["decision"], "blocked")
            output_text = output_path.read_text(encoding="utf-8")
            self.assertNotIn("0.656", output_text)
            self.assertNotIn("openai/privacy-filter", output_text)
            self.assertNotIn(str(output_path), stdout.getvalue())

    def test_versioned_json_schemas_are_valid_json_objects(self) -> None:
        for name in (
            "pii-artifact-verification.schema.json",
            "pii-promotion-evidence-binding.schema.json",
            "pii-promotion-evidence.schema.json",
            "pii-promotion-owner-policy.schema.json",
            "pii-repeated-cold-evidence.schema.json",
            "pii-tenant-chat-model-e2e.schema.json",
        ):
            schema = load_json(REPO_ROOT / "docs" / "ai-safety-lab" / "schemas" / name)
            self.assertEqual(schema["type"], "object")


def passing_fixtures() -> dict:
    manifest = {
        "manifestVersion": "tenant-chat-pii-models.v1",
        "models": [
            {
                "modelId": "synthetic/model",
                "revision": "revision-a",
                "files": [
                    {"path": "model.bin", "bytes": 10, "sha256": "a" * 64},
                ],
            }
        ],
    }
    binding = {
        "schemaVersion": "pii-promotion-evidence-binding.v1",
        "manifestVersion": "tenant-chat-pii-models.v1",
        "modelRevisions": {"synthetic/model": "revision-a"},
        "artifactChecksumsVerified": True,
        "gitRevision": "a" * 40,
    }
    owner_policy = {
        "policyVersion": "pii-promotion-owner-policy.v1",
        "approvedForProduction": True,
        "scope": {
            "requiredPiiTypes": list(PROMOTION_PII_TYPES),
            "requiredLocales": ["ko-KR", "en-US"],
        },
        "thresholds": {
            "minimumOverallPassRate": 0.8,
            "minimumPrecisionByPiiType": {
                pii_type: 0.8 for pii_type in PROMOTION_PII_TYPES
            },
            "minimumRecallByPiiType": {
                pii_type: 0.8 for pii_type in PROMOTION_PII_TYPES
            },
            "maximumWarmSidecarP95Ms": 300,
            "maximumColdP95Ms": 20000,
            "maximumPeakRssMb": 1024,
            "maximumStartupFailureRate": 0.01,
            "minimumColdStartRuns": 5,
        },
    }
    quality = {
        "metricUnit": "span-level detector metrics",
        "scope": {
            "piiTypes": list(PROMOTION_PII_TYPES),
            "locales": ["ko-KR", "en-US"],
        },
        "corpus": {"untouchedHoldout": True, "governanceApproved": True},
        "overall": {"passRate": 0.9},
        "byPiiType": {
            pii_type: {"precision": 0.9, "recall": 0.9}
            for pii_type in PROMOTION_PII_TYPES
        },
        "ablation": {
            "rulesOnlyMeasured": True,
            "hybridMeasured": True,
            "incrementalBenefitMeasured": True,
        },
        "promotionDecision": "candidate",
        "evidenceBinding": dict(binding),
    }
    artifact_verification = {
        "schemaVersion": "pii-artifact-verification.v1",
        "aggregateOnly": True,
        "filesExpected": 1,
        "filesVerified": 1,
        "checksumFailures": 0,
        "evidenceBinding": dict(binding),
    }
    benchmark = {
        "metadata": {
            "reportVersion": "ai-safety-resource-latency-benchmark.v3",
            "gitSha": "a" * 40,
        },
        "runtimeResults": [
            {
                "status": "pass",
                "requests": 100,
                "p95SidecarLatencyMs": 100,
                "modelActiveRequestCount": 20,
                "modelInvocationCount": 20,
                "acceptedModelDetectionCount": 10,
                "p50ModelActiveSidecarLatencyMs": 80,
                "p95ModelActiveSidecarLatencyMs": 100,
                "executionModeCounts": {"rules_only": 80, "hybrid": 20},
                "resource": {"peakRssMb": 100},
            }
        ],
        "decisionSummary": {
            "sidecarLatencyGate": "pass",
            "targetLatencyGate": "pass",
            "timeoutFallbackGate": "pass",
            "evidenceCompletenessGate": "pass",
            "rawValueExposureGate": "pass",
        },
        "evidenceBinding": dict(binding),
    }
    cold_start = {
        "schemaVersion": "pii-repeated-cold-evidence.v1",
        "aggregateOnly": True,
        "runs": 5,
        "successfulRuns": 5,
        "failedRuns": 0,
        "startupFailureRate": 0,
        "coldP50Ms": 9000,
        "coldP95Ms": 10000,
        "peakRssMb": 500,
        "evidenceBinding": dict(binding),
        "contentSafety": {
            "rawContentIncluded": False,
            "requestIdentifiersIncluded": False,
            "endpointLocationsIncluded": False,
            "artifactDigestsIncluded": False,
            "childErrorDetailIncluded": False,
        },
    }
    tenant_chat_e2e = {
        "schemaVersion": "pii-tenant-chat-model-e2e.v1",
        "aggregateOnly": True,
        "tenantChatPathVerified": True,
        "modelInvocationObserved": True,
        "enforceRedactionVerified": True,
        "blockProviderSuppressionVerified": True,
        "fallbackObserved": True,
        "noRawPersistenceVerified": True,
        "evidenceBinding": dict(binding),
    }
    return {
        "manifest": manifest,
        "quality": quality,
        "owner_policy": owner_policy,
        "artifact_verification": artifact_verification,
        "benchmark": benchmark,
        "cold_start": cold_start,
        "tenant_chat_e2e": tenant_chat_e2e,
    }


def all_reason_codes(evidence: dict) -> set[str]:
    return {
        reason
        for check in evidence["checks"]
        for reason in check["reasonCodes"]
    }


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"expected JSON object: {path.name}")
    return value


if __name__ == "__main__":
    unittest.main()
