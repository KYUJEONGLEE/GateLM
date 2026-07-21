"""Leakage-guarded 5,000-record GateLM difficulty model evidence run.

The command deliberately separates model selection from final-test export. Raw
prompt-derived material, vectors, and per-record probabilities remain in memory;
only aggregate reports and immutable component hashes are written.
"""

from __future__ import annotations

# Frozen evidence replay only. New experiments are locked to canonical_dataset.py.
HISTORICAL_REPLAY_ONLY = True

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import statistics
import subprocess
import sys
import time
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .candidate_training import build_component_hashes
from .encoder_runtime import PCAProjection, canonical_hash, load_runtime, sha256_file
from .semantic_features import (
    OfflineFeatureCandidate,
    OfflineFeatureShape,
    SEMANTIC_HEAD_SPECS_V1,
)
from .semantic_heads import (
    HEAD_LABEL_FIELDS,
    evaluate_semantic_head_probabilities,
    predict_semantic_head_probabilities,
    train_semantic_heads,
)
from .training import (
    OFFLINE_ARTIFACT_SCHEMA_VERSION,
    OFFLINE_BUNDLE_HASH_ALGORITHM,
    OFFLINE_CONTENT_HASH_ALGORITHM,
    OFFLINE_HEAD_PROBABILITY_RULE,
    OFFLINE_THRESHOLD_EQUALITY,
    _fit_calibrator,
    _fit_logistic,
    _group_folds,
    _select_regularization,
    artifact_content_hash,
    offline_bundle_hash,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
TOOL_ROOT = REPO_ROOT / "scripts/routing_difficulty_model"
DEFAULT_DATASET = REPO_ROOT / "docs/v2.1.0/training/difficulty-model-path-5000.owner-approved.jsonl"
DEFAULT_MANIFEST = REPO_ROOT / "docs/v2.1.0/training/difficulty-model-path-5000.owner-approved.manifest.json"
DEFAULT_ROLES = REPO_ROOT / "docs/v2.1.0/training/difficulty-model-path-5000.roles.json"
DEFAULT_ENCODER_MANIFEST = TOOL_ROOT / "artifacts/difficulty-e5-encoder-manifest.v2.json"
DEFAULT_ARTIFACT_ROOT = REPO_ROOT / ".tmp/difficulty-semantic-encoder-artifacts"
DEFAULT_POLICY = TOOL_ROOT / "training-policy.semantic-candidates.v3.json"
DEFAULT_REPORT_ROOT = REPO_ROOT / "reports/routing-difficulty-model"
RANDOM_SEED = 20260716
SHADOW_ARTIFACT_VERSION = (
    "difficulty-offline.model-path-5000.2026-07-16."
    "42d-rule-vector-v1-plus-projection.shadow.v1"
)
SHADOW_BUNDLE_VERSION = "difficulty-feature-bundle.model-path-5000.2026-07-16.106d-shadow.v1"
SHADOW_PROJECTION_VERSION = "difficulty-e5-pca-full-svd-64.model-path-5000.2026-07-16.v1"
SHADOW_THRESHOLD_POLICY_VERSION = "difficulty-threshold.model-path-5000.2026-07-16.v1"
EXPECTED_ROLE_RECORDS = {
    "train": 3000,
    "calibration": 1000,
    "evaluation_holdout": 750,
    "promotion_holdout": 250,
}
CANDIDATE_DIMENSIONS = {
    OfflineFeatureCandidate.RULE_VECTOR_V1.value: 42,
    OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION.value: 106,
    OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS.value: 118,
}
CATEGORY_ORDER = ("general", "code", "translation", "summarization", "reasoning")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def rounded(value: float | int) -> float:
    return round(float(value), 12)


def write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def command_output(args: Sequence[str]) -> str:
    try:
        result = subprocess.run(
            list(args),
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.CalledProcessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            return (error.stdout or error.stderr or "unavailable").strip()
        return "unavailable"
    return result.stdout.strip()


def percentile(values: Sequence[float], q: float) -> float:
    import numpy as np

    if not values:
        return 0.0
    return float(np.percentile(np.asarray(values, dtype=float), q))


def timing_summary(values_ms: Sequence[float]) -> dict[str, Any]:
    return {
        "samples": len(values_ms),
        "meanMs": rounded(statistics.fmean(values_ms) if values_ms else 0.0),
        "p50Ms": rounded(percentile(values_ms, 50)),
        "p90Ms": rounded(percentile(values_ms, 90)),
        "p95Ms": rounded(percentile(values_ms, 95)),
        "p99Ms": rounded(percentile(values_ms, 99)),
        "maxMs": rounded(max(values_ms, default=0.0)),
    }


def build_exporter(output_path: Path) -> float:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["GOCACHE"] = str(REPO_ROOT / ".gocache")
    started = time.perf_counter()
    subprocess.run(
        [
            "go",
            "build",
            "-o",
            str(output_path),
            "./apps/gateway-core/cmd/difficulty-semantic-head-training-export",
        ],
        cwd=REPO_ROOT,
        env=env,
        check=True,
    )
    return time.perf_counter() - started


def export_phase(
    exporter: Path,
    dataset: Path,
    manifest: Path,
    phase: str,
) -> tuple[dict[str, Any], float]:
    started = time.perf_counter()
    result = subprocess.run(
        [
            str(exporter),
            "-dataset",
            str(dataset),
            "-manifest",
            str(manifest),
            "-phase",
            phase,
        ],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    elapsed = time.perf_counter() - started
    value = json.loads(result.stdout)
    if not isinstance(value, dict):
        raise ValueError("canonical Go exporter did not return an object")
    if value.get("accessPhase") != phase:
        raise ValueError("canonical Go exporter phase drifted")
    return value, elapsed


def role_index(role_manifest: Mapping[str, Any]) -> dict[str, str]:
    families = role_manifest.get("families")
    if not isinstance(families, list):
        raise ValueError("role manifest families are missing")
    result: dict[str, str] = {}
    role_records: dict[str, int] = defaultdict(int)
    for item in families:
        if not isinstance(item, Mapping):
            raise ValueError("role manifest family must be an object")
        family = item.get("promptFamily")
        role = item.get("role")
        records = item.get("records")
        if (
            not isinstance(family, str)
            or not family
            or role not in EXPECTED_ROLE_RECORDS
            or isinstance(records, bool)
            or not isinstance(records, int)
            or records <= 0
            or family in result
        ):
            raise ValueError("role manifest contains invalid family material")
        result[family] = str(role)
        role_records[str(role)] += records
    if dict(role_records) != EXPECTED_ROLE_RECORDS:
        raise ValueError(f"role record counts drifted: {dict(role_records)}")
    return result


def validate_selection_export(
    exported: Mapping[str, Any],
    roles: Mapping[str, str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if exported.get("holdoutOutcomeAccessed") is not False:
        raise ValueError("selection export accessed holdout outcomes")
    if exported.get("includedPartitions") != ["train", "calibration"]:
        raise ValueError("selection export did not isolate train/calibration")
    samples = exported.get("samples")
    if not isinstance(samples, list) or len(samples) != 4000:
        raise ValueError("selection export must contain exactly 4,000 samples")
    counts: dict[str, int] = defaultdict(int)
    families: dict[str, set[str]] = defaultdict(set)
    for sample in samples:
        if not isinstance(sample, dict):
            raise ValueError("selection sample must be an object")
        split = sample.get("split")
        family = sample.get("familyId")
        if split not in {"train", "calibration"} or not isinstance(family, str):
            raise ValueError("selection sample has invalid split metadata")
        if roles.get(family) != split:
            raise ValueError("selection sample and four-role manifest disagree")
        if sample.get("modelPath") is not True:
            raise ValueError("5,000-record target must contain model-path samples only")
        counts[split] += 1
        families[split].add(family)
    if dict(counts) != {"train": 3000, "calibration": 1000}:
        raise ValueError(f"selection record counts drifted: {dict(counts)}")
    overlap = families["train"].intersection(families["calibration"])
    if overlap:
        raise ValueError("prompt family leaked between train and calibration")
    return samples, {
        "records": dict(counts),
        "families": {key: len(value) for key, value in families.items()},
        "familyOverlap": 0,
        "holdoutOutcomeAccessed": False,
    }


def validate_test_export(
    exported: Mapping[str, Any],
    roles: Mapping[str, str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if exported.get("holdoutOutcomeAccessed") is not True:
        raise ValueError("final-test export did not declare holdout access")
    if exported.get("includedPartitions") != ["holdout"]:
        raise ValueError("final-test export did not isolate holdout")
    samples = exported.get("samples")
    if not isinstance(samples, list) or len(samples) != 1000:
        raise ValueError("final-test export must contain exactly 1,000 samples")
    counts: dict[str, int] = defaultdict(int)
    families: dict[str, set[str]] = defaultdict(set)
    for sample in samples:
        if not isinstance(sample, dict) or sample.get("split") != "holdout":
            raise ValueError("final-test sample is outside holdout")
        family = sample.get("familyId")
        role = roles.get(str(family))
        if role not in {"evaluation_holdout", "promotion_holdout"}:
            raise ValueError("final-test family has no frozen test role")
        sample["testRole"] = role
        counts[role] += 1
        families[role].add(str(family))
    if dict(counts) != {"evaluation_holdout": 750, "promotion_holdout": 250}:
        raise ValueError(f"final-test role counts drifted: {dict(counts)}")
    if families["evaluation_holdout"].intersection(families["promotion_holdout"]):
        raise ValueError("test family crossed evaluation/promotion roles")
    return samples, {
        "records": dict(counts),
        "families": {key: len(value) for key, value in families.items()},
        "familyOverlap": 0,
        "holdoutOutcomeAccessed": True,
    }


def encode_single_requests(runtime: Any, samples: Sequence[Mapping[str, Any]]) -> tuple[Any, list[float]]:
    import numpy as np

    pooled = np.empty((len(samples), 384), dtype=np.float32)
    timings: list[float] = []
    for index, sample in enumerate(samples):
        started = time.perf_counter_ns()
        pooled[index] = runtime.encode_pooled_one(str(sample["instructionText"]))
        timings.append((time.perf_counter_ns() - started) / 1_000_000)
    return pooled, timings


def fit_pca_3000(train_embeddings: Any) -> PCAProjection:
    import numpy as np
    from sklearn.decomposition import PCA

    values = np.asarray(train_embeddings, dtype=np.float32)
    if values.shape != (3000, 384) or not np.all(np.isfinite(values)):
        raise ValueError("5,000-record PCA fit requires exact [3000,384] train material")
    pca = PCA(n_components=64, svd_solver="full", whiten=False)
    pca.fit(values)
    return PCAProjection(
        mean=np.asarray(pca.mean_, dtype=np.float32),
        components=np.asarray(pca.components_, dtype=np.float32),
    )


def semantic_targets(samples: Sequence[Mapping[str, Any]]) -> dict[str, list[str]]:
    return {
        spec.name: [str(sample[HEAD_LABEL_FIELDS[spec.name]]) for sample in samples]
        for spec in SEMANTIC_HEAD_SPECS_V1
    }


def semantic_metadata(samples: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "language": sample["language"],
            "evaluationSlices": list(sample["evaluationSlices"]),
        }
        for sample in samples
    ]


def select_semantic_head_c(
    train_projected: Any,
    train_samples: Sequence[Mapping[str, Any]],
    c_candidates: Sequence[float],
    encoder_version: str,
    encoder_hash: str,
    pooling_version: str,
) -> tuple[float, list[dict[str, Any]]]:
    import numpy as np
    from sklearn.metrics import log_loss
    from sklearn.model_selection import GroupKFold

    x = np.asarray(train_projected, dtype=np.float64)
    groups = np.asarray([sample["familyId"] for sample in train_samples], dtype=object)
    targets = semantic_targets(train_samples)
    splitter = GroupKFold(n_splits=5)
    evaluations: list[dict[str, Any]] = []
    for c_value in c_candidates:
        fold_metrics: list[dict[str, Any]] = []
        failed = False
        for fold, (fit_indices, validation_indices) in enumerate(splitter.split(x, groups=groups), start=1):
            fit_labels = {
                spec.name: [targets[spec.name][index] for index in fit_indices]
                for spec in SEMANTIC_HEAD_SPECS_V1
            }
            try:
                artifact = train_semantic_heads(
                    x[fit_indices],
                    fit_labels,
                    artifact_version=f"difficulty-semantic-heads.model-path-5000.cv-c{c_value}.fold{fold}",
                    encoder_version=encoder_version,
                    encoder_hash=encoder_hash,
                    pooling_version=pooling_version,
                    c_value=float(c_value),
                    max_iterations=2000,
                )
            except ValueError:
                failed = True
                break
            probabilities = predict_semantic_head_probabilities(artifact, x[validation_indices])
            head_losses: list[float] = []
            head_briers: list[float] = []
            for spec in SEMANTIC_HEAD_SPECS_V1:
                encoded = np.asarray(
                    [spec.classes.index(targets[spec.name][index]) for index in validation_indices],
                    dtype=int,
                )
                matrix = np.asarray(probabilities[spec.name], dtype=float)
                head_losses.append(float(log_loss(encoded, matrix, labels=[0, 1, 2])))
                one_hot = np.eye(3, dtype=float)[encoded]
                head_briers.append(float(np.mean(np.sum((matrix - one_hot) ** 2, axis=1))))
            fold_metrics.append(
                {
                    "fold": fold,
                    "meanHeadLogLoss": rounded(statistics.fmean(head_losses)),
                    "meanHeadBrierScore": rounded(statistics.fmean(head_briers)),
                }
            )
        if failed:
            evaluations.append({"c": float(c_value), "status": "failed"})
            continue
        evaluations.append(
            {
                "c": float(c_value),
                "status": "valid",
                "meanHeadLogLoss": rounded(statistics.fmean(row["meanHeadLogLoss"] for row in fold_metrics)),
                "meanHeadBrierScore": rounded(statistics.fmean(row["meanHeadBrierScore"] for row in fold_metrics)),
                "foldMetrics": fold_metrics,
            }
        )
    valid = [row for row in evaluations if row["status"] == "valid"]
    if not valid:
        raise ValueError("all semantic-head regularization candidates failed")
    selected = min(valid, key=lambda row: (row["meanHeadLogLoss"], row["meanHeadBrierScore"], row["c"]))
    return float(selected["c"]), evaluations


def semantic_joint_metrics(
    probabilities: Mapping[str, Any],
    targets: Mapping[str, Sequence[str]],
) -> dict[str, Any]:
    import numpy as np
    from sklearn.metrics import f1_score

    expected_all: list[int] = []
    predicted_all: list[int] = []
    exact = np.ones(len(next(iter(targets.values()))), dtype=bool)
    for spec in SEMANTIC_HEAD_SPECS_V1:
        expected = np.asarray([spec.classes.index(value) for value in targets[spec.name]], dtype=int)
        predicted = np.argmax(np.asarray(probabilities[spec.name]), axis=1)
        exact &= expected == predicted
        expected_all.extend(expected.tolist())
        predicted_all.extend(predicted.tolist())
    return {
        "jointExactMatchAccuracy": rounded(float(np.mean(exact))),
        "microF1AcrossHeads": rounded(f1_score(expected_all, predicted_all, average="micro")),
    }


def flatten_heads(probabilities: Mapping[str, Any]) -> Any:
    import numpy as np

    return np.concatenate(
        [np.asarray(probabilities[spec.name], dtype=np.float64) for spec in SEMANTIC_HEAD_SPECS_V1],
        axis=1,
    )


def feature_matrix(
    samples: Sequence[Mapping[str, Any]],
    projected: Any,
    head_probabilities: Mapping[str, Any],
    candidate: str,
) -> Any:
    import numpy as np

    rules = np.asarray([sample["ruleVectorV1"] for sample in samples], dtype=np.float64)
    if rules.shape != (len(samples), 42):
        raise ValueError("canonical rule vector shape drifted")
    if candidate == OfflineFeatureCandidate.RULE_VECTOR_V1.value:
        return rules
    projection = np.asarray(projected, dtype=np.float64)
    if candidate == OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION.value:
        return np.concatenate([rules, projection], axis=1)
    if candidate == OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS.value:
        return np.concatenate([rules, projection, flatten_heads(head_probabilities)], axis=1)
    raise ValueError(f"unsupported feature candidate: {candidate}")


def calibration_metrics(labels: Any, probabilities: Any, bins: int = 10) -> dict[str, Any]:
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import brier_score_loss, log_loss

    y = np.asarray(labels, dtype=int)
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-15, 1 - 1e-15)
    reliability: list[dict[str, Any]] = []
    ece = 0.0
    mce = 0.0
    for index in range(bins):
        lower = index / bins
        upper = (index + 1) / bins
        mask = (p >= lower) & (p <= upper if index == bins - 1 else p < upper)
        support = int(np.sum(mask))
        if support == 0:
            reliability.append(
                {"lowerInclusive": lower, "upperInclusive": upper, "support": 0, "status": "empty"}
            )
            continue
        mean_probability = float(np.mean(p[mask]))
        observed_rate = float(np.mean(y[mask]))
        error = abs(mean_probability - observed_rate)
        ece += support / len(y) * error
        mce = max(mce, error)
        reliability.append(
            {
                "lowerInclusive": lower,
                "upperInclusive": upper,
                "support": support,
                "meanProbability": rounded(mean_probability),
                "observedComplexRate": rounded(observed_rate),
            }
        )
    slope: float | None = None
    intercept: float | None = None
    if len(np.unique(y)) == 2:
        logits = np.log(p / (1 - p)).reshape(-1, 1)
        slope_model = LogisticRegression(solver="lbfgs", C=1_000_000.0, max_iter=2000)
        slope_model.fit(logits, y)
        slope = rounded(float(slope_model.coef_[0][0]))
        intercept = rounded(float(slope_model.intercept_[0]))
    return {
        "logLoss": rounded(log_loss(y, p, labels=[0, 1])),
        "brierScore": rounded(brier_score_loss(y, p)),
        "expectedCalibrationError": rounded(ece),
        "maximumCalibrationError": rounded(mce),
        "calibrationSlope": slope,
        "calibrationIntercept": intercept,
        "reliabilityBins": reliability,
    }


def classification_metrics(
    samples: Sequence[Mapping[str, Any]],
    probabilities: Any,
    threshold: float,
    *,
    include_ids: bool = False,
) -> dict[str, Any]:
    import numpy as np
    from sklearn.metrics import (
        average_precision_score,
        balanced_accuracy_score,
        confusion_matrix,
        matthews_corrcoef,
        precision_recall_fscore_support,
        roc_auc_score,
    )

    p = np.asarray(probabilities, dtype=float)
    y = np.asarray([int(sample["label"]) for sample in samples], dtype=int)
    predicted = (p >= float(threshold)).astype(int)
    category_correct = np.asarray(
        [sample["actualCategory"] == sample["expectedCategory"] for sample in samples],
        dtype=bool,
    )
    difficulty_correct = predicted == y
    joint_correct = category_correct & difficulty_correct
    tn, fp, fn, tp = confusion_matrix(y, predicted, labels=[0, 1]).ravel()
    precision, recall, f1, _ = precision_recall_fscore_support(
        y, predicted, average="binary", zero_division=0
    )
    has_both_labels = len(np.unique(y)) == 2
    result: dict[str, Any] = {
        "samples": len(samples),
        "threshold": rounded(threshold),
        "jointRoutingAccuracy": rounded(float(np.mean(joint_correct))),
        "categoryAccuracy": rounded(float(np.mean(category_correct))),
        "difficultyAccuracy": rounded(float(np.mean(difficulty_correct))),
        "balancedAccuracy": (
            rounded(balanced_accuracy_score(y, predicted)) if has_both_labels else None
        ),
        "precisionComplex": rounded(precision),
        "recallComplex": rounded(recall),
        "f1Complex": rounded(f1),
        "specificity": rounded(tn / (tn + fp) if tn + fp else 0.0),
        "matthewsCorrelationCoefficient": rounded(matthews_corrcoef(y, predicted)),
        "rocAuc": rounded(roc_auc_score(y, p)) if has_both_labels else None,
        "prAuc": rounded(average_precision_score(y, p)) if has_both_labels else None,
        "confusionMatrixSimpleComplex": [[int(tn), int(fp)], [int(fn), int(tp)]],
        "simpleToComplexCount": int(fp),
        "complexToSimpleCount": int(fn),
        "correctJoint": int(np.sum(joint_correct)),
        "calibration": calibration_metrics(y, p),
    }
    if include_ids:
        result["jointMisclassifiedSampleIds"] = [
            str(sample["sampleId"])
            for sample, correct in zip(samples, joint_correct)
            if not bool(correct)
        ]
    return result


def operating_point_metrics(
    samples: Sequence[Mapping[str, Any]], probabilities: Any, threshold: float
) -> dict[str, Any]:
    import numpy as np

    p = np.asarray(probabilities, dtype=float)
    y = np.asarray([int(sample["label"]) for sample in samples], dtype=int)
    category_correct = np.asarray(
        [sample["actualCategory"] == sample["expectedCategory"] for sample in samples],
        dtype=bool,
    )
    return _operating_point_metrics_core(y, category_correct, p, threshold)


def _operating_point_metrics_core(
    y: Any, category_correct: Any, probabilities: Any, threshold: float
) -> dict[str, Any]:
    import numpy as np

    p = probabilities
    predicted = (p >= float(threshold)).astype(int)
    tp = int(np.sum((y == 1) & (predicted == 1)))
    tn = int(np.sum((y == 0) & (predicted == 0)))
    fp = int(np.sum((y == 0) & (predicted == 1)))
    fn = int(np.sum((y == 1) & (predicted == 0)))
    positive_recall = tp / (tp + fn) if tp + fn else 0.0
    negative_recall = tn / (tn + fp) if tn + fp else 0.0
    precision = tp / (tp + fp) if tp + fp else 0.0
    f1 = 2 * precision * positive_recall / (precision + positive_recall) if precision + positive_recall else 0.0
    denominator = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    mcc = ((tp * tn) - (fp * fn)) / denominator if denominator else 0.0
    difficulty_correct = predicted == y
    return {
        "threshold": rounded(threshold),
        "jointRoutingAccuracy": rounded(float(np.mean(category_correct & difficulty_correct))),
        "difficultyAccuracy": rounded(float(np.mean(difficulty_correct))),
        "balancedAccuracy": rounded((positive_recall + negative_recall) / 2),
        "f1Complex": rounded(f1),
        "matthewsCorrelationCoefficient": rounded(mcc),
        "simpleToComplexCount": fp,
        "complexToSimpleCount": fn,
    }


def threshold_values(probabilities: Any) -> list[float]:
    import numpy as np

    unique = sorted({float(value) for value in np.asarray(probabilities, dtype=float)})
    values = {index / 1000 for index in range(1001)}
    values.update(unique)
    values.update((left + right) / 2 for left, right in zip(unique, unique[1:]))
    return sorted(value for value in values if 0.0 <= value <= 1.0)


def threshold_selection_key(metrics: Mapping[str, Any]) -> tuple[Any, ...]:
    return (
        -float(metrics["jointRoutingAccuracy"]),
        int(metrics["complexToSimpleCount"]),
        -float(metrics["balancedAccuracy"]),
        -float(metrics["matthewsCorrelationCoefficient"]),
    )


def sweep_thresholds(
    samples: Sequence[Mapping[str, Any]], probabilities: Any
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    import numpy as np

    p = np.asarray(probabilities, dtype=float)
    y = np.asarray([int(sample["label"]) for sample in samples], dtype=int)
    category_correct = np.asarray(
        [sample["actualCategory"] == sample["expectedCategory"] for sample in samples],
        dtype=bool,
    )
    evaluated = [
        _operating_point_metrics_core(y, category_correct, p, value)
        for value in threshold_values(p)
    ]
    best_key = min(threshold_selection_key(row) for row in evaluated)
    tied = [row for row in evaluated if threshold_selection_key(row) == best_key]
    tied.sort(key=lambda row: float(row["threshold"]))
    midpoint = (float(tied[0]["threshold"]) + float(tied[-1]["threshold"])) / 2
    selected = min(tied, key=lambda row: (abs(float(row["threshold"]) - midpoint), float(row["threshold"])))
    result = classification_metrics(samples, p, float(selected["threshold"]))
    result["equivalentBestThresholdRange"] = {
        "minimum": tied[0]["threshold"],
        "maximum": tied[-1]["threshold"],
        "evaluatedPoints": len(tied),
    }
    return result, evaluated


def oof_calibrated_probabilities(
    kind: str,
    raw_probabilities: Any,
    labels: Any,
    groups: Any,
    config: dict[str, Any],
) -> tuple[Any, list[dict[str, Any]]]:
    import numpy as np

    raw = np.asarray(raw_probabilities, dtype=float)
    y = np.asarray(labels, dtype=int)
    group_values = np.asarray(groups, dtype=object)
    output = np.full(len(raw), np.nan, dtype=float)
    diagnostics: list[dict[str, Any]] = []
    splitter = _group_folds(group_values, int(config["groupFolds"]))
    for fold, (fit_indices, validation_indices) in enumerate(
        splitter.split(raw, y, group_values), start=1
    ):
        apply, _, fit_diagnostics = _fit_calibrator(
            kind, raw[fit_indices], y[fit_indices], config
        )
        output[validation_indices] = apply(raw[validation_indices])
        row: dict[str, Any] = {"fold": fold, "validationSamples": len(validation_indices)}
        if kind == "isotonic":
            row.update(
                {
                    "blockCount": fit_diagnostics["blockCount"],
                    "minBlockSampleCount": fit_diagnostics["minBlockSampleCount"],
                }
            )
        diagnostics.append(row)
    if not np.all(np.isfinite(output)):
        raise ValueError("calibrator OOF prediction is incomplete")
    return output, diagnostics


def candidate_selection_key(row: Mapping[str, Any]) -> tuple[Any, ...]:
    metrics = row["selectedOperatingPoint"]
    calibrator_order = {"platt": 0, "isotonic": 1}
    return (
        *threshold_selection_key(metrics),
        int(row["totalDimension"]),
        calibrator_order[str(row["calibratorType"])],
        float(metrics["threshold"]),
    )


def category_confusion(samples: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    matrix = [[0 for _ in CATEGORY_ORDER] for _ in CATEGORY_ORDER]
    index = {value: position for position, value in enumerate(CATEGORY_ORDER)}
    for sample in samples:
        expected = str(sample["expectedCategory"])
        actual = str(sample["actualCategory"])
        if expected not in index or actual not in index:
            raise ValueError("category value left the active five-category contract")
        matrix[index[expected]][index[actual]] += 1
    return {"labels": list(CATEGORY_ORDER), "matrix": matrix}


def grouped_reports(
    samples: Sequence[Mapping[str, Any]],
    probabilities: Any,
    threshold: float,
) -> dict[str, Any]:
    import numpy as np

    p = np.asarray(probabilities, dtype=float)

    def report_for(predicate: Callable[[Mapping[str, Any]], bool]) -> dict[str, Any]:
        indices = [index for index, sample in enumerate(samples) if predicate(sample)]
        if not indices:
            return {"status": "empty", "samples": 0}
        return classification_metrics([samples[index] for index in indices], p[indices], threshold)

    categories = sorted({str(sample["expectedCategory"]) for sample in samples})
    languages = sorted({str(sample["language"]) for sample in samples})
    difficulties = ("simple", "complex")
    slices = sorted(
        {str(value) for sample in samples for value in sample.get("evaluationSlices", [])}
    )
    return {
        "byExpectedCategory": {
            value: report_for(lambda sample, value=value: sample["expectedCategory"] == value)
            for value in categories
        },
        "byLanguage": {
            value: report_for(lambda sample, value=value: sample["language"] == value)
            for value in languages
        },
        "byExpectedDifficulty": {
            value: report_for(
                lambda sample, value=value: sample["expectedDifficulty"] == value
            )
            for value in difficulties
        },
        "byEvaluationSlice": {
            value: report_for(
                lambda sample, value=value: value in sample.get("evaluationSlices", [])
            )
            for value in slices
        },
    }


def family_bootstrap_joint_accuracy(
    samples: Sequence[Mapping[str, Any]],
    probabilities: Any,
    threshold: float,
    *,
    iterations: int = 2000,
) -> dict[str, Any]:
    import numpy as np

    p = np.asarray(probabilities, dtype=float)
    predicted = p >= threshold
    correct = np.asarray(
        [
            sample["actualCategory"] == sample["expectedCategory"]
            and bool(prediction) == (sample["expectedDifficulty"] == "complex")
            for sample, prediction in zip(samples, predicted)
        ],
        dtype=float,
    )
    by_family: dict[str, list[int]] = defaultdict(list)
    for index, sample in enumerate(samples):
        by_family[str(sample["familyId"])].append(index)
    families = sorted(by_family)
    family_arrays = {
        family: np.asarray(indices, dtype=int)
        for family, indices in by_family.items()
    }
    rng = np.random.default_rng(RANDOM_SEED)
    values = np.empty(iterations, dtype=float)
    for iteration in range(iterations):
        chosen = rng.choice(families, size=len(families), replace=True)
        indices = np.concatenate([family_arrays[str(family)] for family in chosen])
        values[iteration] = float(np.mean(correct[indices]))
    return {
        "method": "promptFamily cluster bootstrap percentile interval",
        "iterations": iterations,
        "randomSeed": RANDOM_SEED,
        "lower95": rounded(float(np.percentile(values, 2.5))),
        "upper95": rounded(float(np.percentile(values, 97.5))),
    }


def canonical_material_size(value: Mapping[str, Any]) -> int:
    return len(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def verify_selection_reproduction(
    actual: Mapping[str, Any], reference: Mapping[str, Any]
) -> None:
    """Fail closed unless train/calibration replay reproduces the frozen choice."""

    fields = (
        "candidateName",
        "totalDimension",
        "selectedC",
        "calibratorType",
        "threshold",
        "thresholdEquality",
        "componentHashes",
        "selectionContentHash",
    )
    drifted = [field for field in fields if actual.get(field) != reference.get(field)]
    if drifted:
        raise ValueError(
            "selection-only replay drifted from the frozen selection: " + ", ".join(drifted)
        )
    if reference.get("testOutcomeAccessed") is not False:
        raise ValueError("selection reference must predate final-test outcome access")


def build_gateway_shadow_artifact(
    *,
    projection: PCAProjection,
    encoder_manifest: Mapping[str, Any],
    head_artifact: Mapping[str, Any],
    selected_model: Any,
    calibrator_material: Mapping[str, Any],
    selected_c: float,
    selected_threshold: float,
    role_manifest: Mapping[str, Any],
    roles_path: Path,
    policy: Mapping[str, Any],
) -> dict[str, Any]:
    """Close the frozen 106D selection into the existing offline artifact schema."""

    candidate = OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION
    shape = OfflineFeatureShape(
        projection_dimension=64,
        projection_version=SHADOW_PROJECTION_VERSION,
        semantic_heads_version=str(head_artifact["version"]),
    )
    descriptor = shape.descriptor(candidate)
    component_hashes = build_component_hashes(encoder_manifest, head_artifact)
    component_hashes["projection"] = "sha256:" + projection.parameter_hash
    projection_parameters = {
        "kind": "pca_full_svd",
        "inputDimension": 384,
        "outputDimension": 64,
        "dtype": "float32_le",
        "fitSplit": "train",
        "randomSeed": RANDOM_SEED,
        "whiten": False,
        "l2Position": "after_projection",
        "l2Epsilon": 1e-12,
        "mean": [float(value) for value in projection.mean],
        "components": [
            [float(value) for value in row]
            for row in projection.components
        ],
    }
    encoder = encoder_manifest["encoder"]
    preprocessing = encoder_manifest["preprocessing"]
    pooling = encoder_manifest["pooling"]
    source_revision = str(encoder_manifest["sourceRevision"])
    artifact: dict[str, Any] = {
        "schemaVersion": OFFLINE_ARTIFACT_SCHEMA_VERSION,
        "artifactVersion": SHADOW_ARTIFACT_VERSION,
        "modelVersion": str(policy["modelVersion"]),
        "offlineFeatureShapeVersion": descriptor.shape_version,
        "candidateName": candidate.value,
        "ruleVectorVersion": descriptor.rule_vector_version,
        "preprocessingVersion": str(preprocessing["version"]),
        "tokenizerVersion": (
            "difficulty-tokenizer.multilingual-e5-small."
            + source_revision
            + ".v1"
        ),
        "encoderVersion": str(encoder["version"]),
        "poolingVersion": str(pooling["version"]),
        "projectionVersion": SHADOW_PROJECTION_VERSION,
        "projectionDimension": 64,
        "projectionParameters": projection_parameters,
        "semanticHeadsVersion": str(head_artifact["version"]),
        "semanticHeadClassOrder": [
            {"name": spec.name, "classes": list(spec.classes)}
            for spec in descriptor.semantic_head_specs
        ],
        "semanticHeadInputDimension": 64,
        "semanticHeadParameters": [dict(head) for head in head_artifact["heads"]],
        "semanticHeadProbabilityRule": OFFLINE_HEAD_PROBABILITY_RULE,
        "totalDimension": descriptor.total_dimension,
        "featureNames": list(descriptor.feature_names),
        "weights": [float(value) for value in selected_model.coef_[0]],
        "bias": float(selected_model.intercept_[0]),
        "calibrationVersion": str(policy["calibration"]["policyVersion"]),
        "calibrator": dict(calibrator_material),
        "thresholdPolicyVersion": SHADOW_THRESHOLD_POLICY_VERSION,
        "threshold": float(selected_threshold),
        "thresholdEquality": OFFLINE_THRESHOLD_EQUALITY,
        "trainingDatasetVersion": str(role_manifest["datasetVersion"]),
        "trainingDatasetSha256": str(role_manifest["datasetSha256"]),
        "splitPolicyVersion": str(role_manifest["rolePolicyVersion"]),
        "splitManifestSha256": sha256_file(roles_path),
        "trainingPolicyVersion": str(policy["policyVersion"]),
        "regularization": {
            "policyVersion": str(policy["policyVersion"]),
            "penalty": str(policy["regularization"]["penalty"]),
            "solver": str(policy["regularization"]["solver"]),
            "selectedC": float(selected_c),
            "groupFolds": int(policy["regularization"]["groupFolds"]),
            "randomSeed": int(policy["regularization"]["randomSeed"]),
        },
        "componentHashes": component_hashes,
        "bundleVersion": SHADOW_BUNDLE_VERSION,
        "bundleHashAlgorithm": OFFLINE_BUNDLE_HASH_ALGORITHM,
        "contentHashAlgorithm": OFFLINE_CONTENT_HASH_ALGORITHM,
    }
    artifact["bundleHash"] = offline_bundle_hash(artifact)
    artifact["contentHash"] = artifact_content_hash(artifact)
    return artifact


def system_reproducibility() -> dict[str, Any]:
    import numpy
    import onnxruntime
    import psutil
    import sklearn
    import transformers

    return {
        "capturedAt": utc_now(),
        "git": {
            "commit": command_output(["git", "rev-parse", "HEAD"]),
            "branch": command_output(["git", "branch", "--show-current"]),
            "dirtyPaths": command_output(["git", "status", "--short"]).splitlines(),
        },
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "logicalCores": psutil.cpu_count(logical=True),
            "physicalCores": psutil.cpu_count(logical=False),
            "ramBytes": psutil.virtual_memory().total,
        },
        "versions": {
            "python": platform.python_version(),
            "numpy": numpy.__version__,
            "scikitLearn": sklearn.__version__,
            "onnxRuntime": onnxruntime.__version__,
            "transformers": transformers.__version__,
            "psutil": importlib.metadata.version("psutil"),
            "go": command_output(["go", "version"]),
            "node": command_output(["node", "--version"]),
            "pnpm": command_output(["corepack", "pnpm", "--version"]),
        },
        "execution": {
            "encoderBatchSize": 1,
            "randomSeed": RANDOM_SEED,
            "argv": sys.argv,
        },
    }


def render_report(
    run_id: str,
    selected: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
    semantic_report: Mapping[str, Any],
    final_report: Mapping[str, Any],
    latency_report: Mapping[str, Any],
    data_report: Mapping[str, Any],
) -> str:
    validation = selected["selectedOperatingPoint"]
    test = final_report["overall"]
    ci = final_report["jointAccuracyConfidenceInterval95"]
    lines = [
        "# GateLM Difficulty Routing Model Report",
        "",
        f"- Run ID: `{run_id}`",
        f"- 최종 feature: `{selected['candidateName']}` ({selected['totalDimension']}D)",
        f"- Logistic Regression: L2/liblinear, `C={selected['selectedC']}`",
        f"- Calibrator: `{selected['calibratorType']}`",
        f"- Threshold: `{selected['threshold']}` (`score >= threshold` → complex)",
        f"- Validation joint routing accuracy: **{validation['jointRoutingAccuracy']:.4%}**",
        f"- Final test joint routing accuracy: **{test['jointRoutingAccuracy']:.4%}** (family bootstrap 95% CI {ci['lower95']:.4%}–{ci['upper95']:.4%})",
        f"- Final test difficulty accuracy: **{test['difficultyAccuracy']:.4%}**",
        f"- Complex recall / FN: **{test['recallComplex']:.4%} / {test['complexToSimpleCount']}**",
        f"- Brier / ECE: **{test['calibration']['brierScore']:.6f} / {test['calibration']['expectedCalibrationError']:.6f}**",
        f"- Model-path latency p50/p95/p99: **{latency_report['endToEndModelPath']['p50Ms']:.3f}/{latency_report['endToEndModelPath']['p95Ms']:.3f}/{latency_report['endToEndModelPath']['p99Ms']:.3f} ms**",
        f"- Model-path throughput: **{latency_report['throughput']['modelPathRequestsPerSecond']:.2f} req/s**",
        f"- Split: train {data_report['roles']['train']['records']}/{data_report['roles']['train']['families']} family, validation {data_report['roles']['calibration']['records']}/{data_report['roles']['calibration']['families']} family, test {data_report['test']['recordsTotal']}/{data_report['test']['familiesTotal']} family",
        f"- Holdout guard: selection freeze `{final_report['selectionFrozenAt']}` 이후 test를 `{final_report['testAccessedAt']}`에 한 번 평가함",
        "",
        "## Validation 후보 비교",
        "",
        "| Feature | D | Calibrator | Threshold | Joint acc | Difficulty acc | Complex F1 | FN | Log loss | Brier | ECE |",
        "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in sorted(candidates, key=candidate_selection_key):
        metrics = row["selectedOperatingPoint"]
        calibration = row["calibrationMetrics"]
        lines.append(
            f"| {row['candidateName']} | {row['totalDimension']} | {row['calibratorType']} | "
            f"{metrics['threshold']:.6f} | {metrics['jointRoutingAccuracy']:.4%} | "
            f"{metrics['difficultyAccuracy']:.4%} | {metrics['f1Complex']:.4%} | "
            f"{metrics['complexToSimpleCount']} | {calibration['logLoss']:.6f} | "
            f"{calibration['brierScore']:.6f} | {calibration['expectedCalibrationError']:.6f} |"
        )
    lines.extend(
        [
            "",
            "선택 우선순위는 validation joint accuracy, complex→simple FN, balanced accuracy, MCC, 낮은 차원, calibrator 단순성 순이다. Calibrator 자체의 보정 품질은 family-grouped OOF log loss/Brier/ECE로 별도 비교했다.",
            "",
            "## Final test",
            "",
            "| 구간 | Samples | Joint acc | Category acc | Difficulty acc | Balanced acc | Complex precision | Complex recall | Complex F1 | FN |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for label, metrics in [
        ("전체", final_report["overall"]),
        ("evaluation_holdout", final_report["byTestRole"]["evaluation_holdout"]),
        ("promotion_holdout", final_report["byTestRole"]["promotion_holdout"]),
    ]:
        lines.append(
            f"| {label} | {metrics['samples']} | {metrics['jointRoutingAccuracy']:.4%} | "
            f"{metrics['categoryAccuracy']:.4%} | {metrics['difficultyAccuracy']:.4%} | "
            f"{metrics['balancedAccuracy']:.4%} | {metrics['precisionComplex']:.4%} | "
            f"{metrics['recallComplex']:.4%} | {metrics['f1Complex']:.4%} | "
            f"{metrics['complexToSimpleCount']} |"
        )
    lines.extend(
        [
            "",
            "## Semantic heads",
            "",
            f"- 선택된 semantic-head C: `{semantic_report['selectedC']}`",
            f"- 4-head joint exact-match accuracy: **{semantic_report['validation']['jointExactMatchAccuracy']:.4%}**",
            f"- 4-head micro F1: **{semantic_report['validation']['microF1AcrossHeads']:.4%}**",
            "",
            "| Head | Accuracy | Macro F1 | Brier | ECE |",
            "|---|---:|---:|---:|---:|",
        ]
    )
    for name, metrics in semantic_report["validation"]["headMetrics"].items():
        lines.append(
            f"| {name} | {metrics['accuracy']:.4%} | {metrics['macroF1']:.4%} | "
            f"{metrics['multiclassBrierScore']:.6f} | {metrics['expectedCalibrationError']:.6f} |"
        )
    lines.extend(
        [
            "",
            "## 속도",
            "",
            "단일 요청(batch=1), CPUExecutionProvider에서 final test 1,000건을 한 번 통과시키며 측정했다. Go feature extraction은 offline bulk exporter 총시간으로 분리했으며, Python model-path latency에는 tokenizer/E5부터 threshold까지 포함된다.",
            "",
            "| 구간 | Mean ms | p50 | p95 | p99 | Max |",
            "|---|---:|---:|---:|---:|---:|",
        ]
    )
    for label, key in [
        ("Tokenizer + E5", "tokenizerAndE5"),
        ("PCA", "pca"),
        ("Semantic heads", "semanticHeads"),
        ("Logistic Regression", "logisticRegression"),
        ("Calibration + threshold", "calibrationAndThreshold"),
        ("Model-path total", "endToEndModelPath"),
    ]:
        value = latency_report[key]
        lines.append(
            f"| {label} | {value['meanMs']:.3f} | {value['p50Ms']:.3f} | "
            f"{value['p95Ms']:.3f} | {value['p99Ms']:.3f} | {value['maxMs']:.3f} |"
        )
    lines.extend(
        [
            "",
            f"- Final test model-path 총시간: `{latency_report['throughput']['modelPathTotalSeconds']:.3f}s`",
            f"- Canonical Go final-test export 총시간: `{latency_report['canonicalGoFeatureExport']['totalSeconds']:.3f}s`",
            f"- Cold model load: `{latency_report['coldStart']['encoderRuntimeLoadSeconds']:.3f}s`",
            f"- Peak RSS: `{latency_report['memory']['peakRssBytes']}` bytes",
            "",
            "## 한계와 해석",
            "",
            "- 이 5,000건은 deterministic sentinel을 제외한 owner-approved model-path dataset이다. 결과는 전체 제품 트래픽이나 GA 품질을 뜻하지 않는다.",
            "- Category classifier는 이번 작업에서 학습하지 않았다. Joint accuracy에는 현재 canonical category 결과의 오류가 포함된다.",
            "- Test 1,000건은 합성 provenance를 포함하므로 실제 production distribution drift와 provider/model 비용 효용은 별도 shadow evidence가 필요하다.",
            "- 초기 모델 선택 run은 offline evidence로 완료했으며 2026-07-16 후속 owner directive에서 exact 106D artifact만 Gateway model-path difficulty hot path로 승격했다. API, DB, Event와 Metrics schema는 변경하지 않았다.",
            "- Raw/redacted prompt 본문, vector, raw logit과 per-record probability는 산출물에 기록하지 않았다.",
            "",
            "## 검증",
            "",
            "모델 run 내부 guard와 저장소 검증 결과는 `run-manifest.json` 및 최종 작업 handoff에 기록한다.",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--roles", type=Path, default=DEFAULT_ROLES)
    parser.add_argument("--encoder-manifest", type=Path, default=DEFAULT_ENCODER_MANIFEST)
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--report-root", type=Path, default=DEFAULT_REPORT_ROOT)
    parser.add_argument("--run-id", default=datetime.now().strftime("%Y%m%d-%H%M%S"))
    parser.add_argument(
        "--selection-only",
        action="store_true",
        help="stop after train/calibration replay; never open final-test outcomes",
    )
    parser.add_argument(
        "--selection-reference",
        type=Path,
        help="frozen pre-test selection manifest that the replay must reproduce exactly",
    )
    parser.add_argument(
        "--shadow-artifact-output",
        type=Path,
        help="write the reproduced 106D Gateway shadow artifact",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    import numpy as np
    import psutil

    args = parse_args(argv)
    if args.selection_only and (
        args.selection_reference is None or args.shadow_artifact_output is None
    ):
        raise ValueError(
            "selection-only shadow replay requires --selection-reference and "
            "--shadow-artifact-output"
        )
    selection_reference = (
        read_json(args.selection_reference) if args.selection_reference is not None else None
    )
    run_directory = args.report_root / args.run_id
    if run_directory.exists():
        existing_manifest_path = run_directory / "run-manifest.json"
        existing_manifest = read_json(existing_manifest_path) if existing_manifest_path.is_file() else {}
        if (
            existing_manifest.get("status") != "running"
            or existing_manifest.get("holdoutGuard", {}).get("testOutcomeAccessed") is not False
        ):
            raise ValueError(f"run directory already exists: {run_directory}")
    else:
        run_directory.mkdir(parents=True)
    console_path = run_directory / "console.log"
    log_lines: list[str] = []

    def log(message: str) -> None:
        line = f"[{utc_now()}] {message}"
        print(line, flush=True)
        log_lines.append(line)
        console_path.write_text("\n".join(log_lines) + "\n", encoding="utf-8")

    run_started = utc_now()
    run_manifest: dict[str, Any] = {
        "schemaVersion": "gatelm.difficulty-model-path-5000-run.v1",
        "runId": args.run_id,
        "createdAt": run_started,
        "status": "running",
        "stages": [],
        "holdoutGuard": {"selectionFrozen": False, "testOutcomeAccessed": False},
    }
    write_json(run_directory / "run-manifest.json", run_manifest)
    log("run initialized")

    role_manifest = read_json(args.roles)
    roles = role_index(role_manifest)
    standard_manifest = read_json(args.manifest)
    policy = read_json(args.policy)
    if role_manifest.get("datasetSha256") != sha256_file(args.dataset):
        raise ValueError("dataset hash does not match the role manifest")
    if standard_manifest.get("datasetSha256") != role_manifest.get("datasetSha256"):
        raise ValueError("dataset and role manifests disagree")

    exporter = REPO_ROOT / ".tmp/difficulty-model-path-5000/difficulty-semantic-head-training-export.exe"
    build_seconds = build_exporter(exporter)
    selection_export, selection_export_seconds = export_phase(
        exporter, args.dataset, args.manifest, "selection"
    )
    selection_samples, selection_integrity = validate_selection_export(selection_export, roles)
    train_indices = [index for index, sample in enumerate(selection_samples) if sample["split"] == "train"]
    validation_indices = [
        index for index, sample in enumerate(selection_samples) if sample["split"] == "calibration"
    ]
    train_samples = [selection_samples[index] for index in train_indices]
    validation_samples = [selection_samples[index] for index in validation_indices]
    log("selection export validated: train=3000 calibration=1000 holdout outcomes untouched")

    load_started = time.perf_counter()
    runtime, encoder_manifest = load_runtime(
        manifest_path=args.encoder_manifest,
        artifact_root=args.artifact_root,
    )
    encoder_load_seconds = time.perf_counter() - load_started
    pooled_selection, selection_encode_timings = encode_single_requests(runtime, selection_samples)
    log("single-request E5 encoding completed for selection population")

    pca_started = time.perf_counter()
    projection = fit_pca_3000(pooled_selection[train_indices])
    projected_selection = projection.transform(pooled_selection)
    pca_fit_seconds = time.perf_counter() - pca_started
    encoder_hash = str(encoder_manifest["bundleSha256"])
    encoder_version = str(encoder_manifest["bundleVersion"])
    pooling_version = str(encoder_manifest["pooling"]["version"])

    head_started = time.perf_counter()
    head_c, head_cv = select_semantic_head_c(
        projected_selection[train_indices],
        train_samples,
        policy["regularization"]["cCandidates"],
        encoder_version,
        encoder_hash,
        pooling_version,
    )
    head_run_id = (
        str(selection_reference["runId"])
        if selection_reference is not None
        else args.run_id
    )
    head_artifact = train_semantic_heads(
        projected_selection[train_indices],
        semantic_targets(train_samples),
        artifact_version=f"difficulty-semantic-heads.model-path-5000.{head_run_id}",
        encoder_version=encoder_version,
        encoder_hash=encoder_hash,
        pooling_version=pooling_version,
        c_value=head_c,
        max_iterations=2000,
    )
    head_probabilities_selection = predict_semantic_head_probabilities(
        head_artifact, projected_selection
    )
    validation_head_probabilities = {
        name: values[validation_indices]
        for name, values in head_probabilities_selection.items()
    }
    validation_targets = semantic_targets(validation_samples)
    validation_head_report = evaluate_semantic_head_probabilities(
        validation_head_probabilities,
        validation_targets,
        semantic_metadata(validation_samples),
        calibration_bins=10,
    )
    validation_head_report.update(
        semantic_joint_metrics(validation_head_probabilities, validation_targets)
    )
    validation_head_report["byExpectedCategory"] = {}
    for category in CATEGORY_ORDER:
        category_indices = [
            index
            for index, sample in enumerate(validation_samples)
            if sample["expectedCategory"] == category
        ]
        category_probabilities = {
            name: values[category_indices]
            for name, values in validation_head_probabilities.items()
        }
        category_targets = {
            name: [values[index] for index in category_indices]
            for name, values in validation_targets.items()
        }
        category_report = evaluate_semantic_head_probabilities(
            category_probabilities,
            category_targets,
            semantic_metadata([validation_samples[index] for index in category_indices]),
            calibration_bins=10,
        )
        category_report.update(
            semantic_joint_metrics(category_probabilities, category_targets)
        )
        validation_head_report["byExpectedCategory"][category] = category_report
    head_training_seconds = time.perf_counter() - head_started
    semantic_report = {
        "schemaVersion": "gatelm.difficulty-semantic-head-model-path-5000-report.v1",
        "selectedC": head_c,
        "trainRecords": len(train_samples),
        "trainFamilies": len({sample["familyId"] for sample in train_samples}),
        "trainingSeconds": rounded(head_training_seconds),
        "artifactContentHash": head_artifact["artifactContentHash"],
        "artifactCanonicalBytes": canonical_material_size(head_artifact),
        "regularizationCandidates": head_cv,
        "validation": validation_head_report,
    }
    write_json(run_directory / "semantic-head-report.json", semantic_report)
    log(f"semantic heads trained; selected C={head_c}")

    labels_train = np.asarray([sample["label"] for sample in train_samples], dtype=int)
    labels_validation = np.asarray([sample["label"] for sample in validation_samples], dtype=int)
    train_groups = np.asarray([sample["familyId"] for sample in train_samples], dtype=object)
    validation_groups = np.asarray(
        [sample["familyId"] for sample in validation_samples], dtype=object
    )
    candidate_runs: list[dict[str, Any]] = []
    candidate_models: dict[str, Any] = {}
    candidate_validation_raw: dict[str, Any] = {}
    threshold_reports: list[dict[str, Any]] = []
    logistic_started = time.perf_counter()
    for candidate in CANDIDATE_DIMENSIONS:
        matrix = feature_matrix(
            selection_samples,
            projected_selection,
            head_probabilities_selection,
            candidate,
        )
        train_x = matrix[train_indices]
        validation_x = matrix[validation_indices]
        selected_c, c_evaluations = _select_regularization(
            train_x,
            labels_train,
            train_groups,
            policy["regularization"],
        )
        model = _fit_logistic(
            train_x,
            labels_train,
            selected_c,
            policy["regularization"],
        )
        raw_validation = model.predict_proba(validation_x)[:, 1]
        candidate_models[candidate] = model
        candidate_validation_raw[candidate] = raw_validation
        uncalibrated = classification_metrics(validation_samples, raw_validation, 0.5)
        for calibrator_kind in ("platt", "isotonic"):
            calibrated_oof, fold_diagnostics = oof_calibrated_probabilities(
                calibrator_kind,
                raw_validation,
                labels_validation,
                validation_groups,
                policy["calibration"],
            )
            selected_point, operating_points = sweep_thresholds(
                validation_samples, calibrated_oof
            )
            calibration = calibration_metrics(labels_validation, calibrated_oof)
            row = {
                "candidateName": candidate,
                "totalDimension": CANDIDATE_DIMENSIONS[candidate],
                "selectedC": selected_c,
                "calibratorType": calibrator_kind,
                "uncalibratedAtThreshold0_5": uncalibrated,
                "regularizationCandidates": c_evaluations,
                "calibrationMetrics": calibration,
                "calibrationFoldDiagnostics": fold_diagnostics,
                "selectedOperatingPoint": selected_point,
            }
            candidate_runs.append(row)
            threshold_reports.append(
                {
                    "candidateName": candidate,
                    "calibratorType": calibrator_kind,
                    "selectedOperatingPoint": selected_point,
                    "evaluatedOperatingPoints": operating_points,
                }
            )
        log(f"trained Logistic Regression candidate {candidate}; selected C={selected_c}")
    logistic_training_seconds = time.perf_counter() - logistic_started
    selected = min(candidate_runs, key=candidate_selection_key)
    selected_candidate = str(selected["candidateName"])
    selected_model = candidate_models[selected_candidate]
    selected_raw_validation = candidate_validation_raw[selected_candidate]
    selected_calibrator_kind = str(selected["calibratorType"])
    apply_calibrator, calibrator_material, calibrator_diagnostics = _fit_calibrator(
        selected_calibrator_kind,
        selected_raw_validation,
        labels_validation,
        policy["calibration"],
    )
    selected_threshold = float(selected["selectedOperatingPoint"]["threshold"])
    selected["threshold"] = selected_threshold

    logistic_material = {
        "candidateName": selected_candidate,
        "selectedC": selected["selectedC"],
        "bias": float(selected_model.intercept_[0]),
        "weights": [float(value) for value in selected_model.coef_[0]],
    }
    component_hashes = {
        "dataset": sha256_file(args.dataset),
        "datasetManifest": sha256_file(args.manifest),
        "roleManifest": sha256_file(args.roles),
        "trainingPolicy": sha256_file(args.policy),
        "encoderBundle": encoder_hash,
        "pcaParameters": projection.parameter_hash,
        "semanticHeads": str(head_artifact["artifactContentHash"]),
        "logisticRegression": canonical_hash(logistic_material),
        "calibrator": canonical_hash(calibrator_material),
    }
    freeze_material = {
        "candidateName": selected_candidate,
        "totalDimension": CANDIDATE_DIMENSIONS[selected_candidate],
        "selectedC": selected["selectedC"],
        "calibratorType": selected_calibrator_kind,
        "threshold": selected_threshold,
        "thresholdEquality": "score >= threshold",
        "componentHashes": component_hashes,
    }
    freeze_material["selectionContentHash"] = canonical_hash(freeze_material)
    selection_frozen_at = utc_now()
    selected_manifest = {
        "schemaVersion": "gatelm.difficulty-model-path-5000-selection.v1",
        "status": "selection_frozen_before_test",
        "runId": args.run_id,
        "frozenAt": selection_frozen_at,
        "selectionSplit": "calibration",
        "testOutcomeAccessed": False,
        **freeze_material,
        "calibratorDiagnostics": calibrator_diagnostics,
        "validationSelectedOperatingPoint": selected["selectedOperatingPoint"],
    }
    if selection_reference is not None:
        verify_selection_reproduction(selected_manifest, selection_reference)
    write_json(run_directory / "selected-model-manifest.json", selected_manifest)
    selected_manifest_hash = sha256_file(run_directory / "selected-model-manifest.json")
    run_manifest["holdoutGuard"] = {
        "selectionFrozen": True,
        "selectionFrozenAt": selection_frozen_at,
        "selectionManifestSha256": selected_manifest_hash,
        "testOutcomeAccessed": False,
    }
    write_json(run_directory / "run-manifest.json", run_manifest)
    log(
        f"selection frozen: {selected_candidate}, {selected_calibrator_kind}, threshold={selected_threshold}"
    )

    logistic_report = {
        "schemaVersion": "gatelm.difficulty-logistic-model-path-5000-comparison.v1",
        "trainingSeconds": rounded(logistic_training_seconds),
        "candidates": candidate_runs,
        "selected": {
            "candidateName": selected_candidate,
            "totalDimension": CANDIDATE_DIMENSIONS[selected_candidate],
            "selectedC": selected["selectedC"],
            "calibratorType": selected_calibrator_kind,
            "threshold": selected_threshold,
            "selectionContentHash": freeze_material["selectionContentHash"],
        },
    }
    calibration_report = {
        "schemaVersion": "gatelm.difficulty-calibration-model-path-5000-report.v1",
        "evidenceSplit": "calibration",
        "scoreSource": "promptFamily-grouped out-of-fold calibrated probability",
        "candidates": [
            {
                "candidateName": row["candidateName"],
                "totalDimension": row["totalDimension"],
                "calibratorType": row["calibratorType"],
                "calibrationMetrics": row["calibrationMetrics"],
                "foldDiagnostics": row["calibrationFoldDiagnostics"],
            }
            for row in candidate_runs
        ],
        "selected": {
            "candidateName": selected_candidate,
            "calibratorType": selected_calibrator_kind,
            "fullValidationFitDiagnostics": calibrator_diagnostics,
        },
    }
    write_json(run_directory / "logistic-comparison.json", logistic_report)
    write_json(run_directory / "calibration-report.json", calibration_report)
    write_json(
        run_directory / "threshold-sweep.json",
        {
            "schemaVersion": "gatelm.difficulty-threshold-model-path-5000-sweep.v1",
            "selectionObjective": [
                "joint_routing_accuracy",
                "complex_to_simple_count",
                "balanced_accuracy",
                "matthews_correlation_coefficient",
                "lower_dimension",
                "calibrator_simplicity",
            ],
            "candidates": threshold_reports,
        },
    )

    if args.shadow_artifact_output is not None:
        shadow_artifact = build_gateway_shadow_artifact(
            projection=projection,
            encoder_manifest=encoder_manifest,
            head_artifact=head_artifact,
            selected_model=selected_model,
            calibrator_material=calibrator_material,
            selected_c=float(selected["selectedC"]),
            selected_threshold=selected_threshold,
            role_manifest=role_manifest,
            roles_path=args.roles,
            policy=policy,
        )
        write_json(args.shadow_artifact_output, shadow_artifact)
        log(
            "Gateway shadow artifact written: "
            f"{shadow_artifact['artifactVersion']} {shadow_artifact['contentHash']}"
        )

    if args.selection_only:
        run_manifest.update(
            {
                "status": "selection_reproduced_without_test_access",
                "completedAt": utc_now(),
                "shadowArtifact": {
                    "path": str(args.shadow_artifact_output),
                    "artifactVersion": SHADOW_ARTIFACT_VERSION,
                },
            }
        )
        run_manifest["holdoutGuard"]["testOutcomeAccessed"] = False
        write_json(run_directory / "run-manifest.json", run_manifest)
        close_runtime = getattr(runtime, "close", None)
        if callable(close_runtime):
            close_runtime()
        log("selection-only replay completed; final-test outcomes remained unopened")
        return 0

    # The final-test exporter is not invoked until the immutable selection file exists.
    if not (run_directory / "selected-model-manifest.json").is_file():
        raise ValueError("final test requires an immutable selection manifest")
    test_accessed_at = utc_now()
    test_export, test_export_seconds = export_phase(
        exporter, args.dataset, args.manifest, "final-test"
    )
    test_samples, test_integrity = validate_test_export(test_export, roles)
    if test_accessed_at <= selection_frozen_at:
        raise ValueError("test access timestamp must follow selection freeze")
    log("final-test holdout opened after selection freeze")

    process = psutil.Process()
    peak_rss = process.memory_info().rss
    test_probabilities = np.empty(len(test_samples), dtype=float)
    timings: dict[str, list[float]] = {
        "tokenizerAndE5": [],
        "pca": [],
        "semanticHeads": [],
        "logisticRegression": [],
        "calibrationAndThreshold": [],
        "endToEndModelPath": [],
    }
    candidate_kind = OfflineFeatureCandidate(selected_candidate)
    for index, sample in enumerate(test_samples):
        total_started = time.perf_counter_ns()
        started = time.perf_counter_ns()
        pooled = runtime.encode_pooled_one(str(sample["instructionText"]))
        timings["tokenizerAndE5"].append((time.perf_counter_ns() - started) / 1_000_000)

        started = time.perf_counter_ns()
        projected = projection.transform(pooled)[0]
        timings["pca"].append((time.perf_counter_ns() - started) / 1_000_000)

        started = time.perf_counter_ns()
        heads = predict_semantic_head_probabilities(head_artifact, projected[None, :])
        timings["semanticHeads"].append((time.perf_counter_ns() - started) / 1_000_000)

        started = time.perf_counter_ns()
        rule = np.asarray(sample["ruleVectorV1"], dtype=float)
        if candidate_kind is OfflineFeatureCandidate.RULE_VECTOR_V1:
            vector = rule
        elif candidate_kind is OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION:
            vector = np.concatenate([rule, projected])
        else:
            vector = np.concatenate([rule, projected, flatten_heads(heads)[0]])
        raw_probability = selected_model.predict_proba(vector[None, :])[:, 1]
        timings["logisticRegression"].append((time.perf_counter_ns() - started) / 1_000_000)

        started = time.perf_counter_ns()
        calibrated = float(apply_calibrator(raw_probability)[0])
        _ = calibrated >= selected_threshold
        timings["calibrationAndThreshold"].append(
            (time.perf_counter_ns() - started) / 1_000_000
        )
        test_probabilities[index] = calibrated
        timings["endToEndModelPath"].append(
            (time.perf_counter_ns() - total_started) / 1_000_000
        )
        if index % 25 == 0:
            peak_rss = max(peak_rss, process.memory_info().rss)
    peak_rss = max(peak_rss, process.memory_info().rss)
    log("final-test single inference pass completed")

    overall = classification_metrics(
        test_samples, test_probabilities, selected_threshold, include_ids=True
    )
    by_role: dict[str, Any] = {}
    for role in ("evaluation_holdout", "promotion_holdout"):
        indices = [index for index, sample in enumerate(test_samples) if sample["testRole"] == role]
        by_role[role] = classification_metrics(
            [test_samples[index] for index in indices],
            test_probabilities[indices],
            selected_threshold,
        )
    final_report = {
        "schemaVersion": "gatelm.difficulty-model-path-5000-final-test-report.v1",
        "status": "final_test_evaluated_once_after_selection_freeze",
        "selectionFrozenAt": selection_frozen_at,
        "selectionManifestSha256": selected_manifest_hash,
        "testAccessedAt": test_accessed_at,
        "testEvaluationPasses": 1,
        "selectionContentHash": freeze_material["selectionContentHash"],
        "overall": overall,
        "jointAccuracyConfidenceInterval95": family_bootstrap_joint_accuracy(
            test_samples, test_probabilities, selected_threshold
        ),
        "categoryConfusionMatrix": category_confusion(test_samples),
        "byTestRole": by_role,
        "slices": grouped_reports(test_samples, test_probabilities, selected_threshold),
        "scope": {
            "population": "owner-approved difficulty model-path records only",
            "sentinelsIncluded": False,
            "productRuntimeChanged": False,
            "runtimePromotionEligible": False,
        },
    }
    write_json(run_directory / "final-test-report.json", final_report)

    model_total_seconds = sum(timings["endToEndModelPath"]) / 1000
    latency_report = {
        "schemaVersion": "gatelm.difficulty-model-path-5000-latency-report.v1",
        "execution": {
            "device": "CPUExecutionProvider",
            "batchSize": 1,
            "testRecords": 1000,
            "warmupSource": "train_and_validation_only",
        },
        "coldStart": {
            "encoderRuntimeLoadSeconds": rounded(encoder_load_seconds),
            "exporterBuildSeconds": rounded(build_seconds),
        },
        "canonicalGoFeatureExport": {
            "selectionSeconds": rounded(selection_export_seconds),
            "totalSeconds": rounded(test_export_seconds),
            "testRecords": 1000,
            "meanMsPerRecordBulk": rounded(test_export_seconds * 1000 / 1000),
            "note": "bulk offline export; not a per-request percentile measurement",
        },
        "selectionEncoding": timing_summary(selection_encode_timings),
        **{key: timing_summary(value) for key, value in timings.items()},
        "throughput": {
            "modelPathTotalSeconds": rounded(model_total_seconds),
            "modelPathRequestsPerSecond": rounded(1000 / model_total_seconds),
            "offlineExportPlusModelSeconds": rounded(test_export_seconds + model_total_seconds),
            "offlineExportPlusModelRequestsPerSecond": rounded(
                1000 / (test_export_seconds + model_total_seconds)
            ),
        },
        "training": {
            "pcaFitSeconds": rounded(pca_fit_seconds),
            "semanticHeadTrainingAndCvSeconds": rounded(head_training_seconds),
            "logisticCandidateTrainingSeconds": rounded(logistic_training_seconds),
        },
        "memory": {"peakRssBytes": int(peak_rss)},
        "artifactSizes": {
            "pcaParameterBytes": int(projection.mean.nbytes + projection.components.nbytes),
            "semanticHeadCanonicalBytes": canonical_material_size(head_artifact),
            "selectedLogisticCanonicalBytes": canonical_material_size(logistic_material),
            "selectedCalibratorCanonicalBytes": canonical_material_size(calibrator_material),
        },
    }
    write_json(run_directory / "latency-report.json", latency_report)

    data_report = {
        "schemaVersion": "gatelm.difficulty-model-path-5000-data-integrity.v1",
        "dataset": {
            "records": 5000,
            "sha256": sha256_file(args.dataset),
            "manifestSha256": sha256_file(args.manifest),
            "roleManifestSha256": sha256_file(args.roles),
            "datasetVersion": role_manifest["datasetVersion"],
            "decisionBoundaryVersion": role_manifest["decisionBoundaryVersion"],
        },
        "roles": role_manifest["roles"],
        "selection": selection_integrity,
        "test": {
            **test_integrity,
            "recordsTotal": 1000,
            "familiesTotal": len({sample["familyId"] for sample in test_samples}),
        },
        "familyLeakage": {
            "trainValidation": 0,
            "trainTest": 0,
            "validationTest": 0,
            "evaluationPromotion": 0,
        },
        "holdoutGuard": {
            "selectionExportHoldoutOutcomeAccessed": False,
            "selectionFrozenAt": selection_frozen_at,
            "testAccessedAt": test_accessed_at,
            "testEvaluationPasses": 1,
        },
    }
    write_json(run_directory / "data-integrity-report.json", data_report)
    reproducibility = system_reproducibility()
    reproducibility["inputs"] = component_hashes
    write_json(run_directory / "reproducibility.json", reproducibility)

    run_manifest.update(
        {
            "status": "completed",
            "completedAt": utc_now(),
            "selectedModel": {
                "candidateName": selected_candidate,
                "calibratorType": selected_calibrator_kind,
                "threshold": selected_threshold,
                "selectionContentHash": freeze_material["selectionContentHash"],
            },
            "holdoutGuard": {
                "selectionFrozen": True,
                "selectionFrozenAt": selection_frozen_at,
                "selectionManifestSha256": selected_manifest_hash,
                "testOutcomeAccessed": True,
                "testAccessedAt": test_accessed_at,
                "testEvaluationPasses": 1,
                "retunedAfterTest": False,
            },
            "outputs": sorted(
                [
                    "REPORT.md",
                    "run-manifest.json",
                    "data-integrity-report.json",
                    "semantic-head-report.json",
                    "logistic-comparison.json",
                    "calibration-report.json",
                    "threshold-sweep.json",
                    "selected-model-manifest.json",
                    "final-test-report.json",
                    "latency-report.json",
                    "reproducibility.json",
                    "console.log",
                ]
            ),
            "repositoryVerification": {"status": "pending_external_commands"},
        }
    )
    write_json(run_directory / "run-manifest.json", run_manifest)
    report = render_report(
        args.run_id,
        selected,
        candidate_runs,
        semantic_report,
        final_report,
        latency_report,
        data_report,
    )
    (run_directory / "REPORT.md").write_text(report, encoding="utf-8")
    log("aggregate reports completed; no per-record probability material persisted")
    print(run_directory)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
