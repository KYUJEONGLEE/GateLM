"""Core contracts for the embedding-only LightGBM offline experiment.

This module deliberately contains no dataset-specific loader and no Test access.
Prompt-derived text and embedding matrices are process-local values supplied by
an approved :class:`EmbeddingProvider`; only safe membership hashes and aggregate
counts are serializable.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold


EXPERIMENT_SCHEMA_VERSION = "gatelm.lightgbm-embedding-experiment.v1"
EXPERIMENT_SEED = 20260721
N_FOLDS = 5
SPLITS = ("train", "validation", "test")
CATEGORIES = ("general", "code", "translation", "summarization", "reasoning")
REQUIRED_SLICES = (
    "long_simple",
    "short_complex",
    "korean",
    "english",
    "mixed_language",
    "negation",
    "indirect_expression",
    "synonym",
    "payload_contamination",
    "category_confusion",
    "ood_terminology",
)
LABEL_MAPPING = {0: "simple", 1: "complex"}


class ExperimentStatus(str, Enum):
    BLOCKED_DATASET_INELIGIBLE = "BLOCKED_DATASET_INELIGIBLE"
    BLOCKED_DIMENSION_MISMATCH = "BLOCKED_DIMENSION_MISMATCH"
    BLOCKED_INVALID_SPLIT = "BLOCKED_INVALID_SPLIT"
    BLOCKED_INVALID_FOLD = "BLOCKED_INVALID_FOLD"
    INVALID_PROTOCOL_DEVIATION = "INVALID_PROTOCOL_DEVIATION"
    INVALID_TEST_CONTAMINATION = "INVALID_TEST_CONTAMINATION"
    INVALID_DATA_SAFETY = "INVALID_DATA_SAFETY"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    VALID_OFFLINE_EVIDENCE = "VALID_OFFLINE_EVIDENCE"


class ExperimentError(RuntimeError):
    """Typed, content-safe failure raised by the offline protocol."""

    def __init__(self, status: ExperimentStatus, reason_code: str) -> None:
        if not reason_code or not reason_code.replace("_", "").isalnum():
            raise ValueError("reason_code must be a stable low-cardinality identifier")
        self.status = status
        self.reason_code = reason_code
        super().__init__(f"{status.value}: {reason_code}")


def canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "NON_CANONICAL_JSON_VALUE",
        ) from exc


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_bare_sha256(value: Any, *, reason_code: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(
        character not in "0123456789abcdef" for character in value
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            reason_code,
        )
    return value


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Offline-only provider contract; implementations may not download at runtime."""

    @property
    def descriptor(self) -> Mapping[str, Any]: ...

    @property
    def declared_dimension(self) -> int: ...

    @property
    def artifact_identity_sha256(self) -> str: ...

    def encode_batch(self, instruction_texts: Sequence[str]) -> Sequence[Sequence[float]]: ...


def validate_encoder_descriptor(
    descriptor: Mapping[str, Any],
    *,
    declared_dimension: int | None = None,
) -> int:
    required = {
        "providerKind",
        "modelId",
        "sourceRevision",
        "inputPrefix",
        "maximumTokenLength",
        "pooling",
        "normalization",
        "outputDtype",
        "outputDimension",
        "artifactIdentitySha256",
    }
    if not isinstance(descriptor, Mapping) or not required.issubset(descriptor):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "ENCODER_DESCRIPTOR_INCOMPLETE",
        )
    dimension = descriptor.get("outputDimension")
    maximum_length = descriptor.get("maximumTokenLength")
    if (
        isinstance(dimension, bool)
        or not isinstance(dimension, int)
        or dimension <= 0
        or dimension > 65536
    ):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "ENCODER_DIMENSION_INVALID",
        )
    if declared_dimension is not None and dimension != declared_dimension:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "ENCODER_DECLARED_DIMENSION_MISMATCH",
        )
    if descriptor.get("outputDtype") != "float32":
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "ENCODER_DTYPE_NOT_FLOAT32",
        )
    if (
        isinstance(maximum_length, bool)
        or not isinstance(maximum_length, int)
        or maximum_length <= 0
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ENCODER_MAXIMUM_LENGTH_INVALID",
        )
    for field in (
        "providerKind",
        "modelId",
        "sourceRevision",
        "pooling",
        "normalization",
    ):
        if not isinstance(descriptor.get(field), str) or not str(descriptor[field]).strip():
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "ENCODER_DESCRIPTOR_VALUE_INVALID",
            )
    require_bare_sha256(
        descriptor.get("artifactIdentitySha256"),
        reason_code="ENCODER_ARTIFACT_IDENTITY_INVALID",
    )
    return dimension


def build_embedding_matrix(
    embedding_rows: Sequence[Sequence[float]],
    *,
    declared_dimension: int,
    row_encoder_identities: Sequence[str] | None = None,
    expected_encoder_identity: str | None = None,
) -> np.ndarray:
    if (
        isinstance(declared_dimension, bool)
        or not isinstance(declared_dimension, int)
        or declared_dimension <= 0
    ):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "DECLARED_DIMENSION_INVALID",
        )
    if isinstance(embedding_rows, (str, bytes)) or not embedding_rows:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "EMBEDDING_ROWS_EMPTY",
        )
    rows: list[np.ndarray] = []
    try:
        for row in embedding_rows:
            if row is None or isinstance(row, (str, bytes)):
                raise TypeError
            array = np.asarray(row, dtype=np.float32)
            rows.append(array)
    except (TypeError, ValueError) as exc:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "EMBEDDING_ROW_INVALID",
        ) from exc
    if any(row.ndim != 1 for row in rows):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "EMBEDDING_ROW_RANK_INVALID",
        )
    if any(row.size == 0 for row in rows):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "EMBEDDING_ROW_EMPTY",
        )
    if {int(row.shape[0]) for row in rows} != {declared_dimension}:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "EMBEDDING_DIMENSION_MISMATCH",
        )
    if row_encoder_identities is not None:
        identities = list(row_encoder_identities)
        if len(identities) != len(rows) or any(not value for value in identities):
            raise ExperimentError(
                ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
                "ENCODER_ROW_IDENTITY_MISSING",
            )
        if len(set(identities)) != 1 or (
            expected_encoder_identity is not None
            and identities[0] != expected_encoder_identity
        ):
            raise ExperimentError(
                ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
                "MIXED_ENCODER_ROWS",
            )
    matrix = np.ascontiguousarray(np.stack(rows, axis=0), dtype=np.float32)
    if matrix.shape != (len(rows), declared_dimension) or matrix.dtype != np.float32:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "EMBEDDING_MATRIX_SHAPE_INVALID",
        )
    if not np.all(np.isfinite(matrix)):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "EMBEDDING_NON_FINITE",
        )
    return matrix


def encode_validated_matrix(
    provider: EmbeddingProvider,
    instruction_texts: Sequence[str],
) -> np.ndarray:
    if not isinstance(provider, EmbeddingProvider):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "EMBEDDING_PROVIDER_INVALID",
        )
    if isinstance(instruction_texts, (str, bytes)) or not instruction_texts:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ENCODER_INPUT_EMPTY",
        )
    if any(not isinstance(value, str) or not value.strip() for value in instruction_texts):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ENCODER_INPUT_INVALID",
        )
    dimension = validate_encoder_descriptor(
        provider.descriptor,
        declared_dimension=provider.declared_dimension,
    )
    if provider.artifact_identity_sha256 != provider.descriptor["artifactIdentitySha256"]:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ENCODER_ARTIFACT_IDENTITY_MISMATCH",
        )
    rows = provider.encode_batch(instruction_texts)
    return build_embedding_matrix(rows, declared_dimension=dimension)


def validate_dataset_eligibility(
    manifest: Mapping[str, Any],
    *,
    dataset_file: Path | None = None,
) -> None:
    scope = manifest.get("scope")
    review = manifest.get("review")
    counts = manifest.get("counts")
    if not all(isinstance(value, Mapping) for value in (scope, review, counts)):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DATASET_INELIGIBLE,
            "DATASET_MANIFEST_SECTIONS_MISSING",
        )
    gates = (
        scope.get("training_eligible") is True,
        review.get("production_gold") is True,
        review.get("human_reviewed") is True,
        review.get("review_status") == "approved"
        or review.get("review_status_distribution", {}).get("approved")
        == counts.get("records"),
        isinstance(counts.get("human_reviewed_records"), int)
        and not isinstance(counts.get("human_reviewed_records"), bool)
        and int(counts["human_reviewed_records"]) > 0,
    )
    if not all(gates):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DATASET_INELIGIBLE,
            "DATASET_APPROVAL_GATE_FAILED",
        )
    expected_sha = manifest.get("dataset_sha256")
    require_bare_sha256(expected_sha, reason_code="DATASET_SHA256_INVALID")
    if dataset_file is not None:
        if not dataset_file.is_file() or sha256_file(dataset_file) != expected_sha:
            raise ExperimentError(
                ExperimentStatus.BLOCKED_DATASET_INELIGIBLE,
                "DATASET_SHA256_MISMATCH",
            )


def normalized_labels(values: Sequence[str | int]) -> np.ndarray:
    if isinstance(values, (str, bytes)) or not values:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "LABELS_EMPTY",
        )
    result: list[int] = []
    for value in values:
        if value in (0, "simple", "Simple"):
            result.append(0)
        elif value in (1, "complex", "Complex"):
            result.append(1)
        else:
            raise ExperimentError(
                ExperimentStatus.BLOCKED_INVALID_SPLIT,
                "LABEL_INVALID",
            )
    return np.asarray(result, dtype=np.int8)


@dataclass(frozen=True)
class DatasetArrays:
    labels: np.ndarray
    family_ids: np.ndarray
    splits: np.ndarray
    categories: np.ndarray
    record_ids: np.ndarray

    @property
    def count(self) -> int:
        return int(self.labels.shape[0])


def validate_dataset_arrays(
    *,
    labels: Sequence[str | int],
    family_ids: Sequence[str],
    splits: Sequence[str],
    categories: Sequence[str],
    record_ids: Sequence[str],
    require_all_splits: bool = True,
) -> DatasetArrays:
    y = normalized_labels(labels)
    count = len(y)
    aligned = (family_ids, splits, categories, record_ids)
    if any(isinstance(values, (str, bytes)) or len(values) != count for values in aligned):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "ROW_ALIGNMENT_MISMATCH",
        )
    families = np.asarray([str(value).strip() for value in family_ids], dtype=object)
    split_values = np.asarray([str(value).strip().lower() for value in splits], dtype=object)
    category_values = np.asarray([str(value).strip().lower() for value in categories], dtype=object)
    records = np.asarray([str(value).strip() for value in record_ids], dtype=object)
    if any(not value for value in families):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "FAMILY_ID_EMPTY",
        )
    if any(not value for value in records) or len(set(records.tolist())) != count:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "RECORD_ID_INVALID",
        )
    if any(value not in SPLITS for value in split_values):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "SPLIT_VALUE_INVALID",
        )
    if any(value not in CATEGORIES for value in category_values):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "CATEGORY_INVALID",
        )
    present_splits = set(split_values.tolist())
    expected_splits = set(SPLITS) if require_all_splits else present_splits
    if require_all_splits and present_splits != expected_splits:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "REQUIRED_SPLIT_MISSING",
        )
    for split in expected_splits:
        indices = np.flatnonzero(split_values == split)
        if indices.size == 0 or set(y[indices].tolist()) != {0, 1}:
            raise ExperimentError(
                ExperimentStatus.BLOCKED_INVALID_SPLIT,
                "SPLIT_LABEL_SUPPORT_INVALID",
            )
    family_splits: dict[str, set[str]] = {}
    for family, split in zip(families, split_values, strict=True):
        family_splits.setdefault(str(family), set()).add(str(split))
    if any(len(values) != 1 for values in family_splits.values()):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "CROSS_SPLIT_FAMILY_LEAKAGE",
        )
    return DatasetArrays(y, families, split_values, category_values, records)


def validate_feature_alignment(matrix: np.ndarray, arrays: DatasetArrays) -> None:
    if (
        not isinstance(matrix, np.ndarray)
        or matrix.ndim != 2
        or matrix.shape[0] != arrays.count
        or matrix.shape[1] <= 0
        or matrix.dtype != np.float32
        or not np.all(np.isfinite(matrix))
    ):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "FEATURE_ROW_ALIGNMENT_MISMATCH",
        )


@dataclass(frozen=True)
class FoldMembership:
    fold: int
    fit_indices: np.ndarray
    validation_indices: np.ndarray
    membership_sha256: str
    aggregate: Mapping[str, Any]


def _safe_membership_hash(
    record_ids: np.ndarray,
    family_ids: np.ndarray,
    indices: np.ndarray,
) -> str:
    material = sorted(
        (
            canonical_sha256({"record": str(record_ids[index])}),
            canonical_sha256({"family": str(family_ids[index])}),
        )
        for index in indices.tolist()
    )
    return canonical_sha256(material)


def make_stratified_group_folds(
    *,
    labels: Sequence[str | int] | np.ndarray,
    family_ids: Sequence[str] | np.ndarray,
    record_ids: Sequence[str] | np.ndarray,
    categories: Sequence[str] | np.ndarray,
    seed: int = EXPERIMENT_SEED,
    n_splits: int = N_FOLDS,
) -> tuple[FoldMembership, ...]:
    y = normalized_labels(labels.tolist() if isinstance(labels, np.ndarray) else labels)
    count = len(y)
    families = np.asarray(family_ids, dtype=object)
    records = np.asarray(record_ids, dtype=object)
    category_values = np.asarray(categories, dtype=object)
    if any(len(values) != count for values in (families, records, category_values)):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "FOLD_ROW_ALIGNMENT_MISMATCH",
        )
    if n_splits != N_FOLDS or seed != EXPERIMENT_SEED:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "FOLD_CONFIGURATION_DRIFT",
        )
    if len(set(families.tolist())) < n_splits:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "FOLD_FAMILY_SUPPORT_INSUFFICIENT",
        )
    splitter = StratifiedGroupKFold(
        n_splits=n_splits,
        shuffle=True,
        random_state=seed,
    )
    folds: list[FoldMembership] = []
    try:
        generated = splitter.split(np.zeros((count, 1)), y, families)
        for fold_index, (fit, valid) in enumerate(generated, start=1):
            fit = np.asarray(fit, dtype=np.int64)
            valid = np.asarray(valid, dtype=np.int64)
            if fit.size == 0 or valid.size == 0:
                raise ExperimentError(
                    ExperimentStatus.BLOCKED_INVALID_FOLD,
                    "FOLD_EMPTY",
                )
            if set(families[fit].tolist()) & set(families[valid].tolist()):
                raise ExperimentError(
                    ExperimentStatus.BLOCKED_INVALID_FOLD,
                    "CROSS_FOLD_FAMILY_LEAKAGE",
                )
            if set(y[fit].tolist()) != {0, 1} or set(y[valid].tolist()) != {0, 1}:
                raise ExperimentError(
                    ExperimentStatus.BLOCKED_INVALID_FOLD,
                    "FOLD_LABEL_SUPPORT_INVALID",
                )
            membership = {
                "fit": _safe_membership_hash(records, families, fit),
                "validation": _safe_membership_hash(records, families, valid),
            }
            aggregate = {
                "fitRecords": int(fit.size),
                "fitFamilies": len(set(families[fit].tolist())),
                "validationRecords": int(valid.size),
                "validationFamilies": len(set(families[valid].tolist())),
                "fitLabels": {
                    LABEL_MAPPING[label]: int(np.sum(y[fit] == label)) for label in (0, 1)
                },
                "validationLabels": {
                    LABEL_MAPPING[label]: int(np.sum(y[valid] == label)) for label in (0, 1)
                },
                "validationCategories": dict(
                    sorted(Counter(str(value) for value in category_values[valid]).items())
                ),
                "familyOverlap": 0,
            }
            folds.append(
                FoldMembership(
                    fold=fold_index,
                    fit_indices=fit,
                    validation_indices=valid,
                    membership_sha256=canonical_sha256(membership),
                    aggregate=aggregate,
                )
            )
    except ExperimentError:
        raise
    except ValueError as exc:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "FOLD_GENERATION_FAILED",
        ) from exc
    if len(folds) != N_FOLDS:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "FOLD_COUNT_INVALID",
        )
    coverage = np.zeros(count, dtype=np.int8)
    for fold in folds:
        coverage[fold.validation_indices] += 1
    if not np.all(coverage == 1):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "FOLD_VALIDATION_COVERAGE_INVALID",
        )
    return tuple(folds)


def fold_set_sha256(folds: Sequence[FoldMembership]) -> str:
    if len(folds) != N_FOLDS:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "FOLD_COUNT_INVALID",
        )
    return canonical_sha256(
        [
            {
                "fold": fold.fold,
                "membershipSha256": fold.membership_sha256,
                "aggregate": dict(fold.aggregate),
            }
            for fold in folds
        ]
    )


def safe_row_identity_sha256(
    *,
    record_ids: Sequence[str],
    labels: Sequence[str | int],
    categories: Sequence[str],
    probabilities: Sequence[float] | None = None,
) -> str:
    y = normalized_labels(labels)
    if len(record_ids) != len(y) or len(categories) != len(y):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "IDENTITY_ROW_ALIGNMENT_MISMATCH",
        )
    if probabilities is not None:
        probability = np.asarray(probabilities, dtype=np.float64)
        if (
            probability.shape != y.shape
            or not np.all(np.isfinite(probability))
            or np.any((probability < 0.0) | (probability > 1.0))
        ):
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "IDENTITY_PROBABILITY_INVALID",
            )
    else:
        probability = None
    material = []
    for index, (record_id, label, category) in enumerate(
        zip(record_ids, y.tolist(), categories, strict=True)
    ):
        row: dict[str, Any] = {
            "recordIdentity": canonical_sha256({"record": str(record_id)}),
            "label": int(label),
            "category": str(category),
        }
        if probability is not None:
            row["probabilityHex"] = float(probability[index]).hex()
        material.append(row)
    return canonical_sha256(material)
