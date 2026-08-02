from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

from app.domain.ai_safety_benchmark.types import BenchmarkError
from app.domain.ai_safety_eval.master_corpus import (
    DetectorExpectation,
    GatewayExpectation,
    MasterEvalCase,
    TargetExpectations,
)
from app.services.pii_direct_inference_concurrency_benchmark_runner import (
    REQUIRED_MODEL_FILES,
)
from app.services.pii_model_error_curation_cli import (
    run as run_curation_cli,
    validate_canonical_model_directory,
)
from app.domain.ai_safety_training.pii_error_curation import (
    CURATED_HARD_NEGATIVE_VARIANTS_PER_CASE,
    CURATION_REPORT_VERSION,
    MODEL_SHA256,
    TARGET_THRESHOLDS,
    build_curated_training_records,
    build_review_template,
    evaluate_regression_guards,
    evaluate_screening_candidates,
    load_approved_review,
    load_regression_guard_fixture,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURE_PATH = (
    REPO_ROOT
    / "docs"
    / "ai-safety-lab"
    / "fixtures"
    / "pii-v0.1.1-regression-guards-v1.json"
)


@dataclass(frozen=True)
class FakeDetection:
    detector_type: str
    start: int
    end: int


class FixtureAdapter:
    def __init__(self, fixture: dict[str, object]) -> None:
        self.expected_by_text = {
            case["text"]: case
            for case in fixture["positiveCases"]  # type: ignore[index]
        }

    def detect(self, text: str) -> list[FakeDetection]:
        case = self.expected_by_text.get(text)
        if case is None:
            return []
        expected_value = case["expectedValue"]
        start = text.index(expected_value)
        return [
            FakeDetection(
                detector_type=case["expectedDetectorType"],
                start=start,
                end=start + len(expected_value),
            )
        ]


class ScreeningAdapter:
    def detect(self, text: str) -> list[FakeDetection]:
        if "account number" in text:
            return [FakeDetection("phone_number", 0, 1)]
        return []


class BoundaryOverreachAdapter:
    def detect(self, text: str) -> list[FakeDetection]:
        expected_value = "Synthetic Person"
        start = text.index(expected_value)
        return [
            FakeDetection(
                detector_type="person_name",
                start=start,
                end=start + len(expected_value) + 1,
            )
        ]


class FailingGuardAdapter:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def warmup(self) -> None:
        pass

    def detect(self, text: str) -> list[FakeDetection]:
        return []


class PiiErrorCurationTests(unittest.TestCase):
    def test_regression_fixture_freezes_positive_and_six_negative_guards(self) -> None:
        fixture = load_regression_guard_fixture(FIXTURE_PATH)

        self.assertEqual(fixture["modelSha256"], MODEL_SHA256)
        self.assertEqual(fixture["thresholds"], TARGET_THRESHOLDS)
        self.assertEqual(len(fixture["positiveCases"]), 7)
        self.assertEqual(len(fixture["negativeCases"]), 6)

    def test_regression_guard_evaluation_checks_boundaries_and_absence(self) -> None:
        fixture = load_regression_guard_fixture(FIXTURE_PATH)

        result = evaluate_regression_guards(FixtureAdapter(fixture), fixture)

        self.assertTrue(result["passed"])
        self.assertEqual(result["caseCount"], 13)
        self.assertEqual(result["failedCaseIds"], [])

    def test_screening_separates_mismatches_from_confusing_correct_cases(self) -> None:
        cases = [
            make_case(
                "hard_negative",
                template="Review account number {SYNTHETIC_ACCOUNT_NUMBER}.",
                binding=("SYNTHETIC_ACCOUNT_NUMBER", "account_number"),
                expected_types=(),
                expected_count=0,
                tags=("risk-false-positive",),
            ),
            make_case(
                "gen_positive_miss",
                template="Organization {SYNTHETIC_ORGANIZATION_NAME}.",
                binding=("SYNTHETIC_ORGANIZATION_NAME", "organization_name"),
                expected_types=("organization_name",),
                expected_count=1,
                tags=("risk-false-negative",),
            ),
            make_case(
                "confusing_correct",
                template="This sentence is intentionally safe.",
                binding=None,
                expected_types=(),
                expected_count=0,
                tags=("risk-false-positive",),
            ),
        ]

        result = evaluate_screening_candidates(ScreeningAdapter(), cases)

        self.assertEqual(result["mismatchCandidateCount"], 2)
        self.assertEqual(
            result["proposedTrainingDispositionCounts"],
            {"hard_negative": 1, "positive": 1},
        )
        self.assertEqual(
            result["reviewRecommendationCounts"],
            {"confirmed_model_error": 1, "excluded_fixture_artifact": 1},
        )
        self.assertEqual(result["riskFalsePositiveCorrectCount"], 1)
        candidates = {
            candidate["caseId"]: candidate
            for candidate in result["mismatchCandidates"]
        }
        self.assertEqual(
            candidates["hard_negative"]["proposedTrainingDisposition"],
            "hard_negative",
        )
        self.assertEqual(
            candidates["gen_positive_miss"]["proposedTrainingDisposition"],
            "positive",
        )
        self.assertEqual(
            candidates["hard_negative"]["recommendedDecision"],
            "confirmed_model_error",
        )
        self.assertEqual(
            candidates["gen_positive_miss"]["recommendedDecision"],
            "excluded_fixture_artifact",
        )

    def test_screening_rejects_same_type_and_count_with_overwide_span(self) -> None:
        case = make_case(
            "gen_person_boundary_overreach",
            template="Name {SYNTHETIC_PERSON_NAME}.",
            binding=("SYNTHETIC_PERSON_NAME", "person_name"),
            expected_types=("person_name",),
            expected_count=1,
            tags=("risk-false-positive",),
        )

        result = evaluate_screening_candidates(BoundaryOverreachAdapter(), [case])

        self.assertEqual(result["exactSpanMatchCaseCount"], 0)
        self.assertEqual(result["mismatchCandidateCount"], 1)
        self.assertEqual(result["boundaryMismatchCandidateCount"], 1)
        candidate = result["mismatchCandidates"][0]
        self.assertEqual(candidate["expectedTargetTypes"], ["person_name"])
        self.assertEqual(candidate["actualTargetTypes"], ["person_name"])
        self.assertEqual(candidate["expectedCount"], 1)
        self.assertEqual(candidate["actualCount"], 1)
        self.assertIn("span_boundary_mismatch", candidate["errorKinds"])
        self.assertNotIn("start", candidate)
        self.assertNotIn("end", candidate)

    def test_canonical_model_directory_rejects_tokenizer_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            model_dir = root / "model"
            model_dir.mkdir()
            registry_path = root / "registry.json"
            write_fake_canonical_registry(model_dir, registry_path)

            binding = validate_canonical_model_directory(
                model_dir=model_dir,
                registry_path=registry_path,
            )
            self.assertEqual(binding["artifactFileCount"], len(REQUIRED_MODEL_FILES))

            (model_dir / "tokenizer.json").write_text(
                "tampered-tokenizer",
                encoding="utf-8",
            )
            with self.assertRaises(BenchmarkError):
                validate_canonical_model_directory(
                    model_dir=model_dir,
                    registry_path=registry_path,
                )

    def test_failed_regression_guards_write_no_review_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir) / "curation"
            with (
                patch(
                    "app.services.pii_model_error_curation_cli."
                    "validate_canonical_model_directory",
                    return_value={"modelOnnxSha256": MODEL_SHA256},
                ),
                patch(
                    "app.services.pii_model_error_curation_cli.PrivacyFilterAdapter",
                    FailingGuardAdapter,
                ),
            ):
                exit_code = run_curation_cli(
                    [
                        "--model-dir",
                        str(Path(temp_dir) / "unused-model"),
                        "--out",
                        str(out_dir),
                    ]
                )

            self.assertEqual(exit_code, 1)
            self.assertFalse(out_dir.exists())

    def test_review_template_is_fail_closed_until_dataset_owner_review(self) -> None:
        screening = {
            "mismatchCandidates": [
                {
                    "caseId": "candidate_one",
                    "proposedTrainingDisposition": "hard_negative",
                    "recommendedDecision": "confirmed_model_error",
                    "recommendationReason": "non_target_fixture_detected_as_target",
                }
            ]
        }

        review = build_review_template(
            curation_report_sha256="a" * 64,
            screening=screening,
            corpus_sha256="b" * 64,
            subset_manifest_sha256="c" * 64,
        )

        self.assertEqual(review["status"], "pending")
        self.assertFalse(review["trainingEligible"])
        self.assertIsNone(review["reviewedAt"])
        self.assertEqual(review["approvalMechanism"], "manual_json_attestation")
        self.assertFalse(review["reviewerIdentityVerified"])
        self.assertTrue(review["repositoryApprovalEvidenceRequired"])
        self.assertEqual(review["decisions"][0]["decision"], "pending")

    def test_pending_review_cannot_be_loaded_as_training_input(self) -> None:
        report = make_curation_report(
            [
                {
                    "caseId": "candidate_one",
                    "proposedTrainingDisposition": "hard_negative",
                    "recommendedDecision": "confirmed_model_error",
                    "recommendationReason": "non_target_fixture_detected_as_target",
                }
            ]
        )
        report_text = json.dumps(report, sort_keys=True) + "\n"
        review = build_review_template(
            curation_report_sha256=hashlib.sha256(
                report_text.encode("utf-8")
            ).hexdigest(),
            screening=report["screening"],
            corpus_sha256="b" * 64,
            subset_manifest_sha256="c" * 64,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "report.json"
            review_path = Path(temp_dir) / "review.json"
            report_path.write_text(report_text, encoding="utf-8")
            review_path.write_text(
                json.dumps(review, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "not approved"):
                load_approved_review(
                    review_path,
                    curation_report_path=report_path,
                )

    def test_approved_review_requires_exact_report_binding_and_complete_decisions(self) -> None:
        report = make_curation_report(
            [
                {
                    "caseId": "candidate_one",
                    "proposedTrainingDisposition": "hard_negative",
                    "recommendedDecision": "confirmed_model_error",
                    "recommendationReason": "non_target_fixture_detected_as_target",
                },
                {
                    "caseId": "candidate_two",
                    "proposedTrainingDisposition": "positive",
                    "recommendedDecision": "excluded_fixture_artifact",
                    "recommendationReason": (
                        "master_renderer_uses_non_realistic_synthetic_value"
                    ),
                },
            ]
        )
        report_text = json.dumps(report, sort_keys=True) + "\n"
        review = {
            "schemaVersion": "gatelm.pii-v0.1.1-error-review.v1",
            "status": "approved",
            "trainingEligible": True,
            "reviewerRole": "dataset_owner",
            "reviewedAt": "2026-08-02T00:00:00Z",
            "approvalMechanism": "manual_json_attestation",
            "reviewerIdentityVerified": False,
            "repositoryApprovalEvidenceRequired": True,
            "syntheticOnly": True,
            "modelVersion": "v0.1.1",
            "modelSha256": MODEL_SHA256,
            "curationReportSha256": hashlib.sha256(
                report_text.encode("utf-8")
            ).hexdigest(),
            "sourceCorpusSha256": "b" * 64,
            "subsetManifestSha256": "c" * 64,
            "candidateCount": 2,
            "decisions": [
                {
                    "caseId": "candidate_one",
                    "decision": "confirmed_model_error",
                    "proposedTrainingDisposition": "hard_negative",
                    "recommendedDecision": "confirmed_model_error",
                    "recommendationReason": "non_target_fixture_detected_as_target",
                },
                {
                    "caseId": "candidate_two",
                    "decision": "excluded_fixture_artifact",
                    "proposedTrainingDisposition": "positive",
                    "recommendedDecision": "excluded_fixture_artifact",
                    "recommendationReason": (
                        "master_renderer_uses_non_realistic_synthetic_value"
                    ),
                },
            ],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "report.json"
            review_path = Path(temp_dir) / "review.json"
            report_path.write_text(report_text, encoding="utf-8")
            review_path.write_text(
                json.dumps(review, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            approved = load_approved_review(
                review_path,
                curation_report_path=report_path,
            )

        self.assertEqual(approved, {"candidate_one": "hard_negative"})

    def test_failed_regression_report_cannot_be_approved_for_training(self) -> None:
        report = make_curation_report(
            [
                {
                    "caseId": "candidate_one",
                    "proposedTrainingDisposition": "hard_negative",
                    "recommendedDecision": "confirmed_model_error",
                    "recommendationReason": "non_target_fixture_detected_as_target",
                }
            ]
        )
        report["regressionGuards"] = {
            "caseCount": 13,
            "passedCaseCount": 12,
            "failedCaseIds": ["person"],
            "passed": False,
        }
        report_text = json.dumps(report, sort_keys=True) + "\n"
        review = build_review_template(
            curation_report_sha256=hashlib.sha256(
                report_text.encode("utf-8")
            ).hexdigest(),
            screening=report["screening"],
            corpus_sha256="b" * 64,
            subset_manifest_sha256="c" * 64,
        )
        review.update(
            {
                "status": "approved",
                "trainingEligible": True,
                "reviewedAt": "2026-08-02T00:00:00Z",
            }
        )
        review["decisions"][0]["decision"] = "confirmed_model_error"
        with tempfile.TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "report.json"
            review_path = Path(temp_dir) / "review.json"
            report_path.write_text(report_text, encoding="utf-8")
            review_path.write_text(
                json.dumps(review, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "report contract mismatch"):
                load_approved_review(
                    review_path,
                    curation_report_path=report_path,
                )

    def test_curated_hard_negative_expands_only_approved_synthetic_case(self) -> None:
        case = make_case(
            "gen_private_date_hard_negative",
            template="Review date {SYNTHETIC_PRIVATE_DATE} safely.",
            binding=("SYNTHETIC_PRIVATE_DATE", "private_date"),
            expected_types=(),
            expected_count=0,
            tags=("pattern-private-date", "risk-false-positive"),
        )

        records_by_split = build_curated_training_records(
            [case],
            {case.case_id: "hard_negative"},
        )
        records = [record for records in records_by_split.values() for record in records]

        self.assertEqual(len(records), CURATED_HARD_NEGATIVE_VARIANTS_PER_CASE)
        self.assertTrue(all(not record.spans for record in records))
        self.assertTrue(
            all(
                "SYNTHETIC_PRIVATE_DATE_VALUE" not in record.text
                for record in records
            )
        )
        self.assertEqual(len({record.split for record in records}), 1)


def make_curation_report(candidates: list[dict[str, str]]) -> dict[str, object]:
    return {
        "reportVersion": CURATION_REPORT_VERSION,
        "status": "review_required",
        "syntheticOnly": True,
        "productionPromotionEvidence": False,
        "model": {
            "version": "v0.1.1",
            "sha256": MODEL_SHA256,
            "thresholds": TARGET_THRESHOLDS,
            "canonicalRegistrySha256": "d" * 64,
            "artifactManifestSha256": "e" * 64,
            "artifactFileCount": len(REQUIRED_MODEL_FILES),
        },
        "source": {
            "corpusSha256": "b" * 64,
            "subsetManifestSha256": "c" * 64,
        },
        "regressionGuards": {
            "caseCount": 13,
            "passedCaseCount": 13,
            "failedCaseIds": [],
            "passed": True,
        },
        "screening": {"mismatchCandidates": candidates},
    }


def write_fake_canonical_registry(model_dir: Path, registry_path: Path) -> None:
    files = []
    for name in sorted(REQUIRED_MODEL_FILES):
        content = f"canonical-{name}".encode("utf-8")
        (model_dir / name).write_bytes(content)
        files.append(
            {
                "path": name,
                "bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    registry = {
        "schemaVersion": "gatelm.pii-model-canonical-registry.v1",
        "modelId": "gatelm/koelectra-small-v3-pii-ner",
        "entries": [
            {
                "canonicalVersion": "v0.1.1",
                "legacyRevision": "v3.14",
                "runtime": "onnxruntime",
                "lifecycle": "test",
                "sourceManifests": [
                    {"path": "manifest.json", "sha256": "f" * 64}
                ],
                "files": files,
            }
        ],
    }
    registry_path.write_text(
        json.dumps(registry, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def make_case(
    case_id: str,
    *,
    template: str,
    binding: tuple[str, str] | None,
    expected_types: tuple[str, ...],
    expected_count: int,
    tags: tuple[str, ...],
) -> MasterEvalCase:
    return MasterEvalCase(
        case_id=case_id,
        locale="en-US",
        input_template=template,
        placeholder_bindings={} if binding is None else {binding[0]: binding[1]},
        expectations=TargetExpectations(
            gateway=GatewayExpectation(
                safety_outcome="passed",
                provider_called=True,
                cache_lookup=True,
                streaming_started=False,
                terminal_status="success",
                http_status=200,
                error_code=None,
            ),
            detector=DetectorExpectation(
                outcome="passed",
                mode="shadow",
                detected_types=expected_types,
                detected_count=expected_count,
                block_reason=None,
            ),
        ),
        tags=tags,
    )
