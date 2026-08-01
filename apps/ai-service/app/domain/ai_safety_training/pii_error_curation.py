from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from string import Formatter
from typing import Any, Protocol

from app.domain.ai_safety_eval.master_corpus import (
    MasterEvalCase,
    render_master_eval_prompt,
)
from app.domain.ai_safety_training.koelectra_dataset import (
    MAX_NEGATIVE_TO_POSITIVE_RATIO,
    POSITIVE_VARIANTS_PER_RECORD,
    SPLITS,
    TrainingRecord,
    augmented_positive_record,
    group_id_for_case,
    split_for_case,
    stable_digest,
    training_record_from_case,
    validate_training_dataset,
    validate_training_record,
)


CURATION_REPORT_VERSION = "gatelm.pii-v0.1.1-error-curation.v1"
REVIEW_SCHEMA_VERSION = "gatelm.pii-v0.1.1-error-review.v1"
REGRESSION_GUARD_SCHEMA_VERSION = "pii-v0.1.1-regression-guards.v1"
MODEL_VERSION = "v0.1.1"
MODEL_SHA256 = "8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381"
TARGET_THRESHOLDS = {
    "email": 0.99,
    "organization_name": 0.90,
    "person_name": 0.90,
    "phone_number": 0.99,
    "postal_address": 0.90,
    "resident_registration_number": 0.99,
}
TARGET_TYPES = frozenset(TARGET_THRESHOLDS)
FIXTURE_ARTIFACT_TARGET_TYPES = frozenset(
    {"email", "organization_name", "person_name", "postal_address"}
)
CURATED_HARD_NEGATIVE_VARIANTS_PER_CASE = 4
CURATED_HARD_NEGATIVE_VALUES = {
    "train": {
        "private_date": (
            "1999-03-02",
            "2001/11/09",
            "2024.02.29",
            "1988-12-31",
            "2012/06/17",
            "1975.10.08",
        ),
        "private_url": (
            "https://alpha.example.test/reset?token=SYNTHETIC_A",
            "https://beta.example.test/account/SYNTHETIC_B",
            "https://gamma.example.test/share?id=SYNTHETIC_C",
            "https://delta.example.test/a/b?key=SYNTHETIC_D",
        ),
    },
    "validation": {
        "private_date": (
            "1997-04-15",
            "2003/08/21",
            "2020.09.30",
            "1984-01-19",
        ),
        "private_url": (
            "https://validation-a.example.test/reset?token=SYNTHETIC_E",
            "https://validation-b.example.test/share?id=SYNTHETIC_F",
            "https://validation-c.example.test/a/b?key=SYNTHETIC_G",
        ),
    },
    "holdout": {
        "private_date": (
            "1995-05-23",
            "2007/07/14",
            "2018.11.05",
            "1982-02-27",
        ),
        "private_url": (
            "https://holdout-a.example.test/reset?token=SYNTHETIC_H",
            "https://holdout-b.example.test/share?id=SYNTHETIC_I",
            "https://holdout-c.example.test/a/b?key=SYNTHETIC_J",
        ),
    },
}


class DetectionLike(Protocol):
    detector_type: str
    start: int
    end: int


class AdapterLike(Protocol):
    def detect(self, text: str) -> list[DetectionLike]: ...


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_canonical_text_file(path: Path) -> str:
    return hashlib.sha256(path.read_text(encoding="utf-8").encode("utf-8")).hexdigest()


def load_regression_guard_fixture(path: Path) -> dict[str, Any]:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    expected_fields = {
        "schemaVersion",
        "syntheticOnly",
        "modelVersion",
        "modelSha256",
        "thresholds",
        "positiveCases",
        "negativeCases",
    }
    if not isinstance(fixture, dict) or set(fixture) != expected_fields:
        raise ValueError("PII regression guard fixture fields mismatch")
    if fixture["schemaVersion"] != REGRESSION_GUARD_SCHEMA_VERSION:
        raise ValueError("PII regression guard fixture version mismatch")
    if fixture["syntheticOnly"] is not True:
        raise ValueError("PII regression guard fixture must be synthetic-only")
    if fixture["modelVersion"] != MODEL_VERSION or fixture["modelSha256"] != MODEL_SHA256:
        raise ValueError("PII regression guard model binding mismatch")
    if fixture["thresholds"] != TARGET_THRESHOLDS:
        raise ValueError("PII regression guard threshold binding mismatch")
    _validate_positive_guards(fixture["positiveCases"])
    _validate_negative_guards(fixture["negativeCases"])
    return fixture


def _validate_positive_guards(value: object) -> None:
    if not isinstance(value, list) or len(value) != 7:
        raise ValueError("PII regression guard positive case count mismatch")
    case_ids: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "caseId",
            "text",
            "expectedDetectorType",
            "expectedValue",
        }:
            raise ValueError("PII positive regression guard fields mismatch")
        if not all(isinstance(item[key], str) and item[key] for key in item):
            raise ValueError("PII positive regression guard values must be non-empty strings")
        if item["expectedDetectorType"] not in TARGET_TYPES:
            raise ValueError("PII positive regression guard detector type mismatch")
        if item["expectedValue"] not in item["text"]:
            raise ValueError("PII positive regression guard value is absent from text")
        if item["caseId"] in case_ids:
            raise ValueError("PII positive regression guard case IDs must be unique")
        case_ids.add(item["caseId"])


def _validate_negative_guards(value: object) -> None:
    if not isinstance(value, list) or len(value) != 6:
        raise ValueError("PII regression guard negative case count mismatch")
    case_ids: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "caseId",
            "text",
            "forbiddenDetectorTypes",
        }:
            raise ValueError("PII negative regression guard fields mismatch")
        forbidden = item["forbiddenDetectorTypes"]
        if (
            not isinstance(item["caseId"], str)
            or not item["caseId"]
            or not isinstance(item["text"], str)
            or not item["text"]
            or not isinstance(forbidden, list)
            or not forbidden
            or any(detector_type not in TARGET_TYPES for detector_type in forbidden)
        ):
            raise ValueError("PII negative regression guard value mismatch")
        if item["caseId"] in case_ids:
            raise ValueError("PII negative regression guard case IDs must be unique")
        case_ids.add(item["caseId"])


def evaluate_regression_guards(
    adapter: AdapterLike,
    fixture: Mapping[str, Any],
) -> dict[str, Any]:
    case_results: list[dict[str, Any]] = []
    for case in fixture["positiveCases"]:
        detections = adapter.detect(case["text"])
        matched = any(
            detection.detector_type == case["expectedDetectorType"]
            and case["text"][detection.start : detection.end] == case["expectedValue"]
            for detection in detections
        )
        case_results.append(
            {
                "caseId": case["caseId"],
                "kind": "positive",
                "passed": matched,
            }
        )
    for case in fixture["negativeCases"]:
        actual_types = {detection.detector_type for detection in adapter.detect(case["text"])}
        forbidden = set(case["forbiddenDetectorTypes"])
        case_results.append(
            {
                "caseId": case["caseId"],
                "kind": "negative",
                "passed": not actual_types.intersection(forbidden),
            }
        )
    return {
        "caseCount": len(case_results),
        "positiveCaseCount": len(fixture["positiveCases"]),
        "negativeCaseCount": len(fixture["negativeCases"]),
        "passedCaseCount": sum(result["passed"] for result in case_results),
        "failedCaseIds": [result["caseId"] for result in case_results if not result["passed"]],
        "passed": all(result["passed"] for result in case_results),
    }


def evaluate_screening_candidates(
    adapter: AdapterLike,
    cases: Sequence[MasterEvalCase],
) -> dict[str, Any]:
    candidate_rows: list[dict[str, Any]] = []
    classifications: Counter[str] = Counter()
    dispositions: Counter[str] = Counter()
    confusing_risk_false_positive_correct = 0
    confusing_risk_false_negative_correct = 0
    confusion_groups: Counter[tuple[tuple[str, ...], tuple[str, ...]]] = Counter()

    for case in cases:
        expected_counts = expected_target_counts(case)
        detections = [
            detection
            for detection in adapter.detect(render_master_eval_prompt(case))
            if detection.detector_type in TARGET_TYPES
        ]
        actual_counts = Counter(detection.detector_type for detection in detections)
        expected_types = tuple(sorted(expected_counts))
        actual_types = tuple(sorted(actual_counts))
        if dict(actual_counts) == expected_counts:
            classification = "confusing_but_correct" if _is_risk_case(case) else "correct"
            classifications[classification] += 1
            if "risk-false-positive" in case.tags:
                confusing_risk_false_positive_correct += 1
            if "risk-false-negative" in case.tags:
                confusing_risk_false_negative_correct += 1
            continue

        missing_types = sorted(set(expected_counts) - set(actual_counts))
        extra_types = sorted(set(actual_counts) - set(expected_counts))
        count_mismatch = (
            not missing_types
            and not extra_types
            and sum(expected_counts.values()) != sum(actual_counts.values())
        )
        error_kinds = []
        if extra_types or sum(actual_counts.values()) > sum(expected_counts.values()):
            error_kinds.append("false_positive")
        if missing_types or sum(actual_counts.values()) < sum(expected_counts.values()):
            error_kinds.append("false_negative")
        if count_mismatch:
            error_kinds.append("count_mismatch")
        proposed_disposition = proposed_training_disposition(
            expected_counts=expected_counts,
            actual_counts=actual_counts,
        )
        recommended_decision, recommendation_reason = review_recommendation(
            case=case,
            expected_counts=expected_counts,
            actual_counts=actual_counts,
        )
        classifications["model_mismatch_candidate"] += 1
        dispositions[proposed_disposition] += 1
        confusion_groups[(expected_types, actual_types)] += 1
        candidate_rows.append(
            {
                "caseId": case.case_id,
                "errorKinds": error_kinds,
                "expectedTargetTypes": list(expected_types),
                "actualTargetTypes": list(actual_types),
                "expectedCount": sum(expected_counts.values()),
                "actualCount": sum(actual_counts.values()),
                "proposedTrainingDisposition": proposed_disposition,
                "recommendedDecision": recommended_decision,
                "recommendationReason": recommendation_reason,
                "humanReviewStatus": "pending",
            }
        )

    return {
        "caseCount": len(cases),
        "classificationCounts": dict(sorted(classifications.items())),
        "mismatchCandidateCount": len(candidate_rows),
        "proposedTrainingDispositionCounts": dict(sorted(dispositions.items())),
        "reviewRecommendationCounts": dict(
            sorted(
                Counter(
                    row["recommendedDecision"] for row in candidate_rows
                ).items()
            )
        ),
        "riskFalsePositiveCorrectCount": confusing_risk_false_positive_correct,
        "riskFalseNegativeCorrectCount": confusing_risk_false_negative_correct,
        "confusionGroups": [
            {
                "expectedTargetTypes": list(expected_types),
                "actualTargetTypes": list(actual_types),
                "caseCount": count,
            }
            for (expected_types, actual_types), count in sorted(
                confusion_groups.items(),
                key=lambda item: (item[0][0], item[0][1]),
            )
        ],
        "mismatchCandidates": candidate_rows,
    }


def expected_target_counts(case: MasterEvalCase) -> dict[str, int]:
    expected_types = sorted(
        set(case.expectations.detector.detected_types).intersection(TARGET_TYPES)
    )
    if not expected_types:
        return {}
    expected_count = case.expectations.detector.detected_count
    if len(expected_types) == 1:
        return {expected_types[0]: expected_count}
    if expected_count != len(expected_types):
        raise ValueError(f"{case.case_id}: ambiguous target detector count")
    return {detector_type: 1 for detector_type in expected_types}


def proposed_training_disposition(
    *,
    expected_counts: Mapping[str, int],
    actual_counts: Mapping[str, int],
) -> str:
    if not expected_counts and actual_counts:
        return "hard_negative"
    if expected_counts and not actual_counts:
        return "positive"
    return "manual"


def review_recommendation(
    *,
    case: MasterEvalCase,
    expected_counts: Mapping[str, int],
    actual_counts: Mapping[str, int],
) -> tuple[str, str]:
    if not expected_counts and actual_counts:
        return (
            "confirmed_model_error",
            "non_target_fixture_detected_as_target",
        )
    if (
        expected_counts
        and not actual_counts
        and set(expected_counts).issubset(FIXTURE_ARTIFACT_TARGET_TYPES)
        and case.case_id.startswith("gen_")
    ):
        return (
            "excluded_fixture_artifact",
            "master_renderer_uses_non_realistic_synthetic_value",
        )
    return "needs_case_review", "mixed_or_count_mismatch"


def _is_risk_case(case: MasterEvalCase) -> bool:
    return bool({"risk-false-positive", "risk-false-negative"}.intersection(case.tags))


def build_review_template(
    *,
    curation_report_sha256: str,
    screening: Mapping[str, Any],
    corpus_sha256: str,
    subset_manifest_sha256: str,
) -> dict[str, Any]:
    candidates = screening["mismatchCandidates"]
    return {
        "schemaVersion": REVIEW_SCHEMA_VERSION,
        "status": "pending",
        "trainingEligible": False,
        "reviewerRole": "dataset_owner",
        "reviewedAt": None,
        "syntheticOnly": True,
        "modelVersion": MODEL_VERSION,
        "modelSha256": MODEL_SHA256,
        "curationReportSha256": curation_report_sha256,
        "sourceCorpusSha256": corpus_sha256,
        "subsetManifestSha256": subset_manifest_sha256,
        "candidateCount": len(candidates),
        "decisions": [
            {
                "caseId": candidate["caseId"],
                "decision": "pending",
                "proposedTrainingDisposition": candidate[
                    "proposedTrainingDisposition"
                ],
                "recommendedDecision": candidate["recommendedDecision"],
                "recommendationReason": candidate["recommendationReason"],
            }
            for candidate in candidates
        ],
    }


def load_approved_review(
    review_path: Path,
    *,
    curation_report_path: Path,
) -> dict[str, str]:
    report_text = curation_report_path.read_text(encoding="utf-8")
    report = json.loads(report_text)
    review = json.loads(review_path.read_text(encoding="utf-8"))
    _validate_curation_report_for_review(report)
    expected_fields = {
        "schemaVersion",
        "status",
        "trainingEligible",
        "reviewerRole",
        "reviewedAt",
        "syntheticOnly",
        "modelVersion",
        "modelSha256",
        "curationReportSha256",
        "sourceCorpusSha256",
        "subsetManifestSha256",
        "candidateCount",
        "decisions",
    }
    if not isinstance(review, dict) or set(review) != expected_fields:
        raise ValueError("PII error review fields mismatch")
    if review["schemaVersion"] != REVIEW_SCHEMA_VERSION:
        raise ValueError("PII error review version mismatch")
    if (
        review["status"] != "approved"
        or review["trainingEligible"] is not True
        or review["reviewerRole"] != "dataset_owner"
        or not isinstance(review["reviewedAt"], str)
        or not review["reviewedAt"]
        or review["syntheticOnly"] is not True
        or review["modelVersion"] != MODEL_VERSION
        or review["modelSha256"] != MODEL_SHA256
    ):
        raise ValueError("PII error review is not approved for training")
    report_sha256 = hashlib.sha256(report_text.encode("utf-8")).hexdigest()
    if review["curationReportSha256"] != report_sha256:
        raise ValueError("PII error review curation report checksum mismatch")
    if review["sourceCorpusSha256"] != report["source"]["corpusSha256"]:
        raise ValueError("PII error review corpus binding mismatch")
    if review["subsetManifestSha256"] != report["source"]["subsetManifestSha256"]:
        raise ValueError("PII error review subset binding mismatch")

    candidates = {
        candidate["caseId"]: candidate
        for candidate in report["screening"]["mismatchCandidates"]
    }
    decisions = review["decisions"]
    if not isinstance(decisions, list) or review["candidateCount"] != len(decisions):
        raise ValueError("PII error review decision count mismatch")
    decisions_by_id: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        if not isinstance(decision, dict) or set(decision) != {
            "caseId",
            "decision",
            "proposedTrainingDisposition",
            "recommendedDecision",
            "recommendationReason",
        }:
            raise ValueError("PII error review decision fields mismatch")
        case_id = decision["caseId"]
        if not isinstance(case_id, str) or case_id in decisions_by_id:
            raise ValueError("PII error review decision case IDs are invalid")
        decisions_by_id[case_id] = decision
    if set(decisions_by_id) != set(candidates):
        raise ValueError("PII error review decision case IDs mismatch")

    approved: dict[str, str] = {}
    for case_id, decision in decisions_by_id.items():
        candidate = candidates[case_id]
        proposed = candidate["proposedTrainingDisposition"]
        if decision["proposedTrainingDisposition"] != proposed:
            raise ValueError("PII error review proposed disposition mismatch")
        if (
            decision["recommendedDecision"] != candidate["recommendedDecision"]
            or decision["recommendationReason"] != candidate["recommendationReason"]
        ):
            raise ValueError("PII error review recommendation mismatch")
        if decision["decision"] == "confirmed_model_error":
            if proposed not in {"hard_negative", "positive"}:
                raise ValueError("PII error review cannot train a manual disposition")
            approved[case_id] = proposed
        elif decision["decision"] != "excluded_fixture_artifact":
            raise ValueError("PII error review contains a pending or invalid decision")
    if not approved:
        raise ValueError("PII error review approved no model errors for training")
    return approved


def _validate_curation_report_for_review(report: object) -> None:
    if not isinstance(report, dict):
        raise ValueError("PII error curation report must be an object")
    model = report.get("model")
    source = report.get("source")
    screening = report.get("screening")
    if (
        report.get("reportVersion") != CURATION_REPORT_VERSION
        or report.get("status") != "review_required"
        or report.get("syntheticOnly") is not True
        or report.get("productionPromotionEvidence") is not False
        or not isinstance(model, dict)
        or model.get("version") != MODEL_VERSION
        or model.get("sha256") != MODEL_SHA256
        or model.get("thresholds") != TARGET_THRESHOLDS
        or not isinstance(source, dict)
        or not _is_sha256(source.get("corpusSha256"))
        or not _is_sha256(source.get("subsetManifestSha256"))
        or not isinstance(screening, dict)
        or not isinstance(screening.get("mismatchCandidates"), list)
    ):
        raise ValueError("PII error curation report contract mismatch")


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    )


def build_curated_training_records(
    cases: Sequence[MasterEvalCase],
    approved: Mapping[str, str],
) -> dict[str, list[TrainingRecord]]:
    cases_by_id = {case.case_id: case for case in cases}
    if set(approved) - set(cases_by_id):
        raise ValueError("approved PII error review references unknown corpus cases")
    records: dict[str, list[TrainingRecord]] = {split: [] for split in SPLITS}
    for case_id in sorted(approved):
        case = cases_by_id[case_id]
        disposition = approved[case_id]
        if disposition == "positive":
            base_record = training_record_from_case(case)
            if not base_record.spans:
                raise ValueError(f"{case_id}: approved positive has no target spans")
            records[base_record.split].extend(
                augmented_positive_record(base_record, variant_index)
                for variant_index in range(
                    POSITIVE_VARIANTS_PER_RECORD,
                    POSITIVE_VARIANTS_PER_RECORD * 2,
                )
            )
        elif disposition == "hard_negative":
            for variant_index in range(CURATED_HARD_NEGATIVE_VARIANTS_PER_CASE):
                record = curated_hard_negative_record(case, variant_index)
                records[record.split].append(record)
        else:
            raise ValueError(f"{case_id}: unsupported approved training disposition")
    return records


def curated_hard_negative_record(
    case: MasterEvalCase,
    variant_index: int,
) -> TrainingRecord:
    if variant_index < 0 or variant_index >= CURATED_HARD_NEGATIVE_VARIANTS_PER_CASE:
        raise ValueError("curated hard-negative variant index is invalid")
    split = split_for_case(case)
    values: dict[str, str] = {}
    formatter = Formatter()
    for _, field_name, format_spec, conversion in formatter.parse(case.input_template):
        if field_name is None:
            continue
        if format_spec or conversion:
            raise ValueError(f"{case.case_id}: formatted placeholders are not supported")
        detector_type = case.placeholder_bindings[field_name]
        candidates = CURATED_HARD_NEGATIVE_VALUES[split].get(detector_type)
        if candidates is None:
            raise ValueError(
                f"{case.case_id}: unsupported hard-negative placeholder type"
            )
        seed = f"{case.case_id}:{field_name}:{variant_index}:{split}"
        index = int(stable_digest(seed)[:8], 16) % len(candidates)
        values[field_name] = candidates[index]
    if not values:
        raise ValueError(f"{case.case_id}: hard-negative case has no placeholders")
    record = TrainingRecord(
        case_id=f"{case.case_id}__curated_hn_{variant_index:02d}",
        split=split,
        locale=case.locale,
        group_id=group_id_for_case(case),
        text=case.input_template.format(**values),
        spans=(),
    )
    validate_training_record(record)
    return record


def merge_curated_training_records(
    dataset: Mapping[str, Sequence[TrainingRecord]],
    curated: Mapping[str, Sequence[TrainingRecord]],
) -> dict[str, list[TrainingRecord]]:
    merged = {
        split: sorted([*dataset[split], *curated[split]], key=lambda item: item.case_id)
        for split in SPLITS
    }
    case_ids = [record.case_id for split in SPLITS for record in merged[split]]
    if len(case_ids) != len(set(case_ids)):
        raise ValueError("curated PII training records duplicate existing case IDs")
    for split in SPLITS:
        positives = sum(bool(record.spans) for record in merged[split])
        negatives = sum(not record.spans for record in merged[split])
        if negatives > positives * MAX_NEGATIVE_TO_POSITIVE_RATIO:
            raise ValueError("curated PII training records exceed negative ratio")
    validate_training_dataset(merged)
    return merged
