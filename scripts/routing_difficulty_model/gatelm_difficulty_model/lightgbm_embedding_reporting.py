"""Aggregate-only evidence validation and Markdown report rendering."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from .lightgbm_embedding_artifacts import scan_aggregate_material
from .lightgbm_embedding_experiment import (
    CATEGORIES,
    REQUIRED_SLICES,
    ExperimentError,
    ExperimentStatus,
    canonical_sha256,
)


AGGREGATE_EVIDENCE_SCHEMA = "gatelm.lightgbm-embedding-aggregate-evidence.v1"
REPORT_SECTIONS = (
    "Decision summary",
    "Dataset and provenance",
    "Dimension contract",
    "Execution environment",
    "Split and leakage",
    "Fold audit",
    "Fixed baseline",
    "Deterministic Random Search",
    "Selected parameters",
    "OOF and calibration",
    "Threshold scenarios",
    "Threshold stability",
    "Pre-Test freeze",
    "Test metrics",
    "Confusion matrix",
    "Expected Decision Loss",
    "Category and slice safety",
    "Latency and artifact diagnostics",
    "Data safety",
    "Deviations and limitations",
    "Hard gate",
    "Sign-off",
    "Reproduction references",
)


def build_aggregate_evidence(
    *,
    experiment_id: str,
    experiment_version: str,
    protocol_sha256: str,
    validation: Mapping[str, Any] | None = None,
    tuning: Mapping[str, Any] | None = None,
    freeze_candidate: Mapping[str, Any] | None = None,
    freeze_record: Mapping[str, Any] | None = None,
    test_evidence: Mapping[str, Any] | None = None,
    environment: Mapping[str, Any] | None = None,
    deviations: Sequence[Mapping[str, Any]] = (),
    limitations: Sequence[str] = (),
) -> dict[str, Any]:
    if not experiment_id or not experiment_version:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "EXPERIMENT_IDENTITY_MISSING",
        )
    evidence = {
        "schemaVersion": AGGREGATE_EVIDENCE_SCHEMA,
        "experimentId": experiment_id,
        "experimentVersion": experiment_version,
        "protocolSha256": protocol_sha256,
        "evidenceClass": "exploratory_offline_only",
        "promotionState": "exploratory_only",
        "runtimeProfileGenerated": False,
        "experimentExecuted": tuning is not None,
        "testAccessState": (
            "consumed_once" if test_evidence is not None else "untouched"
        ),
        "stages": {
            "validation": None if validation is None else dict(validation),
            "tuning": None if tuning is None else dict(tuning),
            "freezeCandidate": (
                None if freeze_candidate is None else dict(freeze_candidate)
            ),
            "freezeRecord": None if freeze_record is None else dict(freeze_record),
            "test": None if test_evidence is None else dict(test_evidence),
        },
        "environment": {} if environment is None else dict(environment),
        "deviations": [dict(value) for value in deviations],
        "limitations": list(limitations),
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    scan_aggregate_material(evidence)
    evidence["evidenceSha256"] = canonical_sha256(evidence)
    validate_aggregate_evidence(evidence)
    return evidence


def validate_aggregate_evidence(evidence: Mapping[str, Any]) -> None:
    if evidence.get("schemaVersion") != AGGREGATE_EVIDENCE_SCHEMA:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "AGGREGATE_EVIDENCE_SCHEMA_INVALID",
        )
    required = {
        "schemaVersion",
        "experimentId",
        "experimentVersion",
        "protocolSha256",
        "evidenceClass",
        "promotionState",
        "runtimeProfileGenerated",
        "experimentExecuted",
        "testAccessState",
        "stages",
        "environment",
        "deviations",
        "limitations",
        "containsEmbeddingMatrix",
        "containsPerSampleScore",
        "evidenceSha256",
    }
    if set(evidence) != required:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "AGGREGATE_EVIDENCE_FIELDS_INVALID",
        )
    if (
        evidence.get("evidenceClass") != "exploratory_offline_only"
        or evidence.get("promotionState") != "exploratory_only"
        or evidence.get("runtimeProfileGenerated") is not False
        or evidence.get("containsEmbeddingMatrix") is not False
        or evidence.get("containsPerSampleScore") is not False
        or evidence.get("testAccessState") not in {"untouched", "consumed_once"}
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "AGGREGATE_EVIDENCE_BOUNDARY_INVALID",
        )
    stages = evidence.get("stages")
    if not isinstance(stages, Mapping) or set(stages) != {
        "validation",
        "tuning",
        "freezeCandidate",
        "freezeRecord",
        "test",
    }:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "AGGREGATE_EVIDENCE_STAGES_INVALID",
        )
    if stages.get("test") is not None and stages.get("freezeRecord") is None:
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "TEST_EVIDENCE_WITHOUT_FREEZE",
        )
    if (stages.get("test") is None) != (evidence.get("testAccessState") == "untouched"):
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "TEST_ACCESS_STATE_INCONSISTENT",
        )
    material = dict(evidence)
    expected = material.pop("evidenceSha256", None)
    if expected != canonical_sha256(material):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "AGGREGATE_EVIDENCE_HASH_MISMATCH",
        )
    tuning = stages.get("tuning")
    if isinstance(tuning, Mapping):
        results = tuning.get("candidateResults")
        if results is not None and (
            not isinstance(results, list) or not 1 <= len(results) <= 80
        ):
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "AGGREGATE_CANDIDATE_RESULTS_INVALID",
            )
    scan_aggregate_material(evidence)


def _display(value: Any) -> str:
    if value is None:
        return "not_evaluated"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if not math.isfinite(value):
            return "not_computable"
        return f"{value:.8g}"
    if isinstance(value, (str, int)):
        return str(value).replace("|", "\\|").replace("\n", " ")
    if isinstance(value, Mapping):
        return ", ".join(f"{key}={_display(child)}" for key, child in sorted(value.items()))
    if isinstance(value, Sequence):
        return ", ".join(_display(child) for child in value)
    return "not_available"


def _table(rows: Sequence[tuple[str, Any]]) -> list[str]:
    result = ["| Item | Result |", "|---|---|"]
    result.extend(f"| {name} | {_display(value)} |" for name, value in rows)
    return result


def _section(lines: list[str], number: int, title: str, body: Sequence[str]) -> None:
    lines.extend((f"## {number}. {title}", "", *body, ""))


def render_markdown_report(evidence: Mapping[str, Any]) -> str:
    validate_aggregate_evidence(evidence)
    stages = evidence["stages"]
    validation = stages.get("validation") or {}
    tuning = stages.get("tuning") or {}
    freeze_candidate = stages.get("freezeCandidate") or {}
    freeze = stages.get("freezeRecord") or {}
    test = stages.get("test") or {}
    selected = (freeze.get("frozenCandidates") or [{}])[0]
    owner = freeze.get("ownerDecision") or {}
    overall = test.get("overall") or {}
    confusion = overall.get("confusionMatrix") or {}
    category_slice = test.get("categoryAndSlice") or {}

    test_safety = test.get("safety") or {}
    hard_gates_passed = bool(test) and (
        (test_safety.get("overall") or {}).get("passed") is True
        and test_safety.get("allCategoriesPassed") is True
        and test_safety.get("minimumComplexRecallPassed") is True
        and (test.get("testAccess") or {}).get("evaluatedCandidateCount") == 1
    )
    decision = (
        ExperimentStatus.VALID_OFFLINE_EVIDENCE.value
        if hard_gates_passed
        else "BLOCKED_INVALID_OR_INSUFFICIENT"
    )
    lines = [
        "# GateLM LightGBM Embedding Hyperparameter Experiment Report",
        "",
        "| Field | Value |",
        "|---|---|",
        f"| Experiment ID | {_display(evidence['experimentId'])} |",
        f"| Experiment version | {_display(evidence['experimentVersion'])} |",
        f"| Protocol SHA-256 | {_display(evidence['protocolSha256'])} |",
        "| Evidence class | Exploratory offline evidence only |",
        f"| Experiment executed | {_display(evidence['experimentExecuted'])} |",
        "| Promotion state | `exploratory_only` |",
        "| Runtime profile generated | `false` |",
        f"| Test access state | {_display(evidence['testAccessState'])} |",
        "",
        "> This report contains aggregate evidence only. It does not authorize runtime promotion.",
        "",
    ]
    _section(
        lines,
        1,
        REPORT_SECTIONS[0],
        _table(
            (
                ("Evidence decision", decision),
                ("Dataset eligibility", validation.get("datasetEligibility")),
                ("Selected candidate", selected.get("selectedCandidateId")),
                ("Embedding dimension D", selected.get("embeddingDimension")),
                ("Calibrator", (selected.get("calibrator") or {}).get("type")),
                ("Selected C_FN", selected.get("selectedCFn")),
                ("Threshold", selected.get("threshold")),
                ("Overall safety gate", (test_safety.get("overall") or {}).get("passed")),
                ("All-category safety gate", test_safety.get("allCategoriesPassed")),
                ("Complex Recall gate", test_safety.get("minimumComplexRecallPassed")),
                ("Runtime promotion", "not_authorized"),
            )
        ),
    )
    _section(
        lines,
        2,
        REPORT_SECTIONS[1],
        _table(
            (
                ("Dataset", validation.get("dataset")),
                ("Dataset identity", freeze_candidate.get("dataset")),
                ("Protocol", evidence["protocolSha256"]),
            )
        ),
    )
    _section(
        lines,
        3,
        REPORT_SECTIONS[2],
        _table(
            (
                ("Declared D", validation.get("embeddingDimension")),
                ("Observed shape", validation.get("featureShape")),
                ("Dimension status", validation.get("dimensionStatus")),
                ("Embedding persisted", False),
            )
        ),
    )
    _section(lines, 4, REPORT_SECTIONS[3], _table(tuple(evidence["environment"].items())))
    _section(
        lines,
        5,
        REPORT_SECTIONS[4],
        _table(
            (
                ("Split aggregate", validation.get("splitAggregate")),
                ("Split membership SHA-256", validation.get("splitMembershipSha256")),
                ("Family leakage", validation.get("familyLeakage")),
            )
        ),
    )
    fold_rows = []
    for fold in validation.get("folds", []):
        fold_rows.append((f"Fold {fold.get('fold')}", fold.get("aggregate")))
    _section(lines, 6, REPORT_SECTIONS[5], _table(fold_rows or (("Status", "not_evaluated"),)))
    _section(lines, 7, REPORT_SECTIONS[6], _table(tuple((tuning.get("baseline") or {}).items())))
    _section(
        lines,
        8,
        REPORT_SECTIONS[7],
        _table(
            (
                ("Candidate set SHA-256", tuning.get("candidateSetSha256")),
                ("Candidate count", tuning.get("candidateCount")),
                ("Completed fold runs", tuning.get("completedFoldRuns")),
                ("Search mode", tuning.get("searchMode")),
            )
        ),
    )
    _section(
        lines,
        9,
        REPORT_SECTIONS[8],
        _table(
            (
                ("Candidate ID", tuning.get("selectedCandidateId")),
                ("Parameters", tuning.get("selectedParameters")),
                ("Best iteration", tuning.get("bestIteration")),
                ("CV mean AP", tuning.get("selectedMeanAveragePrecision")),
                ("CV AP std", tuning.get("selectedStdAveragePrecision")),
            )
        ),
    )
    _section(
        lines,
        10,
        REPORT_SECTIONS[9],
        _table(
            (
                ("OOF coverage", tuning.get("oofCoverage")),
                ("Calibration candidates", tuning.get("calibrationResults")),
                ("Selected calibrator", tuning.get("selectedCalibrator")),
            )
        ),
    )
    _section(
        lines,
        11,
        REPORT_SECTIONS[10],
        _table(
            tuple(
                (f"C_FN {scenario.get('cFn')}", scenario)
                for scenario in tuning.get("thresholdScenarios", [])
            )
            or (("Status", "not_evaluated"),)
        ),
    )
    _section(
        lines,
        12,
        REPORT_SECTIONS[11],
        _table(tuple((tuning.get("thresholdStability") or {}).items())),
    )
    _section(
        lines,
        13,
        REPORT_SECTIONS[12],
        _table(
            (
                ("Freeze SHA-256", freeze.get("freezeSha256")),
                ("Owner decision", owner),
                ("Frozen candidate count", len(freeze.get("frozenCandidates", []))),
                ("Test outcome accessed before freeze", False),
            )
        ),
    )
    _section(lines, 14, REPORT_SECTIONS[13], _table(tuple(overall.items())))
    _section(
        lines,
        15,
        REPORT_SECTIONS[14],
        _table(
            (
                ("TN", confusion.get("trueNegative")),
                ("FP", confusion.get("falsePositive")),
                ("FN", confusion.get("falseNegative")),
                ("TP", confusion.get("truePositive")),
            )
        ),
    )
    _section(
        lines,
        16,
        REPORT_SECTIONS[15],
        _table(tuple((overall.get("expectedDecisionLoss") or {}).items())),
    )
    safety_rows = []
    for category in CATEGORIES:
        safety_rows.append(
            (f"Category {category}", (category_slice.get("categories") or {}).get(category))
        )
    for slice_name in REQUIRED_SLICES:
        safety_rows.append(
            (f"Slice {slice_name}", (category_slice.get("slices") or {}).get(slice_name))
        )
    _section(lines, 17, REPORT_SECTIONS[16], _table(safety_rows))
    _section(
        lines,
        18,
        REPORT_SECTIONS[17],
        _table(
            (
                ("Model", selected.get("model")),
                ("Calibrator", selected.get("calibrator")),
                ("Latency evidence", tuning.get("latencyDiagnostic")),
            )
        ),
    )
    _section(
        lines,
        19,
        REPORT_SECTIONS[18],
        _table(
            (
                ("Aggregate only", True),
                ("Embedding matrix included", False),
                ("Per-sample score included", False),
                ("Runtime profile generated", False),
            )
        ),
    )
    _section(
        lines,
        20,
        REPORT_SECTIONS[19],
        [
            f"- Deviations: {_display(evidence['deviations'])}",
            f"- Limitations: {_display(evidence['limitations'])}",
        ],
    )
    _section(
        lines,
        21,
        REPORT_SECTIONS[20],
        _table(
            (
                ("Dataset gate", validation.get("datasetEligibility")),
                ("Dimension gate", validation.get("dimensionStatus")),
                ("Search complete", tuning.get("searchComplete")),
                ("Freeze present", bool(freeze)),
                ("Test one-time", (test.get("testAccess") or {}).get("evaluatedCandidateCount")),
                ("Final evidence decision", decision),
            )
        ),
    )
    _section(
        lines,
        22,
        REPORT_SECTIONS[21],
        _table(
            (
                ("Dataset owner", validation.get("datasetOwnerDecision")),
                ("Model/evaluation owner", tuning.get("modelOwnerDecision")),
                ("Product/routing owner", owner.get("reference")),
                ("Runtime owner", "separate_contract_required"),
            )
        ),
    )
    _section(
        lines,
        23,
        REPORT_SECTIONS[22],
        _table(
            (
                ("Aggregate evidence SHA-256", evidence["evidenceSha256"]),
                ("Candidate set", tuning.get("candidateSetSha256")),
                ("Fold membership", validation.get("foldMembershipSha256")),
                ("Freeze", freeze.get("freezeSha256")),
                ("Test evidence", test.get("evidenceSha256")),
            )
        ),
    )
    rendered = "\n".join(lines).rstrip() + "\n"
    if any(section not in rendered for section in REPORT_SECTIONS):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "REPORT_SECTION_MISSING",
        )
    return rendered
