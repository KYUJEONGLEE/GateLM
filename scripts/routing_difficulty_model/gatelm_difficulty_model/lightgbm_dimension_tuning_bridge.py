"""Stage-separated four-feature LightGBM tuning bridge.

The bridge keeps prompt-derived text and feature matrices in process memory (or
in the ignored preparation directory) and serializes only aggregate evidence,
immutable model material, and safe identity hashes.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.decomposition import PCA

from .candidate_training import _artifact_scores
from .encoder_runtime import encode_pooled_single_requests, load_runtime
from .lightgbm_e5_base_encoder import E5BaseEncoderRuntime, load_lock
from .lightgbm_embedding_artifacts import (
    TestEvaluationInput,
    artifact_identity,
    evaluate_frozen_test_once,
    freeze_owner_selection,
    prepare_freeze_candidate,
    read_json_object,
    write_json_artifact,
)
from .lightgbm_embedding_calibration import (
    apply_calibrator,
    classification_metrics,
    select_calibrator,
    select_threshold_scenarios,
)
from .lightgbm_embedding_experiment import (
    CATEGORIES,
    EXPERIMENT_SEED,
    canonical_sha256,
    fold_set_sha256,
    make_stratified_group_folds,
    safe_row_identity_sha256,
    sha256_file,
)
from .lightgbm_embedding_search import (
    candidate_set_manifest,
    evaluate_baseline,
    final_best_iteration,
    frozen_search_candidates,
    generate_oof_probabilities,
    refit_full_train,
    run_random_search,
    save_model_with_parity,
    select_best_candidate,
)
from .lightgbm_four_way import CANDIDATE_DIMENSIONS, build_four_way_matrices
from .semantic_features import SEMANTIC_HEAD_SPECS_V1
from .semantic_heads import (
    predict_semantic_head_probabilities,
    train_semantic_heads,
)
from .semantic_heads_cli import load_training_input
from .canonical_dataset import (
    CANONICAL_DATASET,
    CANONICAL_MANIFEST,
    experiment_manifest,
    require_canonical_dataset,
)


CONFIG_SCHEMA = "gatelm.lightgbm-dimension-tuning-bridge-config.v1"
INPUT_MANIFEST_SCHEMA = "gatelm.lightgbm-dimension-tuning-input-manifest.v1"
TUNING_SCHEMA = "gatelm.lightgbm-dimension-tuning-evidence.v1"
FINAL_SCHEMA = "gatelm.lightgbm-dimension-tuning-final-evidence.v1"
SPLIT_POLICY_VERSION = "routing-difficulty-group-split.2026-07-21.v1"
FEATURE_POLICY_VERSION = "difficulty-lightgbm-four-feature-bridge.2026-07-22.v1"
TARGET_SPLIT_COUNTS = {"train": 10_500, "validation": 2_250, "test": 2_250}
SELECTED_C_FN = 5.0
FEATURE_CANDIDATES = tuple(CANDIDATE_DIMENSIONS)


@dataclass(frozen=True)
class BridgeConfig:
    path: Path
    repository_root: Path
    value: Mapping[str, Any]
    input_root: Path
    output_root: Path
    config_sha256: str


@dataclass(frozen=True)
class FeatureMaterial:
    matrices: Mapping[str, np.ndarray]
    descriptors: Mapping[str, Mapping[str, Any]]
    champion_prediction: np.ndarray
    pca_path: Path
    semantic_heads_path: Path


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _resolve_inside(root: Path, value: Any, *, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a repository-relative path")
    candidate = (root / value).resolve()
    candidate.relative_to(root.resolve())
    return candidate


def load_bridge_config(path: Path) -> BridgeConfig:
    repository_root = Path(__file__).resolve().parents[3]
    value = json.loads(path.read_text(encoding="utf-8"))
    required_fields = {
        "schemaVersion",
        "experimentId",
        "experimentVersion",
        "inputRoot",
        "outputRoot",
        "candidateOrder",
        "dataset",
        "split",
        "search",
        "artifacts",
    }
    if not isinstance(value, Mapping) or set(value) != required_fields:
        raise ValueError("dimension tuning bridge config fields drifted")
    if value.get("schemaVersion") != CONFIG_SCHEMA:
        raise ValueError("unsupported dimension tuning bridge config")
    if value.get("candidateOrder") != list(FEATURE_CANDIDATES):
        raise ValueError("bridge candidate order drifted")
    split = value.get("split")
    search = value.get("search")
    dataset = value.get("dataset")
    artifacts = value.get("artifacts")
    test_repeats = search.get("testBootstrapRepeats") if isinstance(search, Mapping) else None
    if (
        not isinstance(split, Mapping)
        or set(split) != {"policyVersion", "seed", "counts"}
        or split.get("policyVersion") != SPLIT_POLICY_VERSION
        or split.get("seed") != EXPERIMENT_SEED
        or split.get("counts") != TARGET_SPLIT_COUNTS
        or not isinstance(search, Mapping)
        or set(search) != {"candidateCount", "selectedCFn", "testBootstrapRepeats"}
        or search.get("candidateCount") != 80
        or float(search.get("selectedCFn", -1)) != SELECTED_C_FN
        or isinstance(test_repeats, bool)
        or not isinstance(test_repeats, int)
        or not 1 <= test_repeats <= 100000
        or not isinstance(dataset, Mapping)
        or set(dataset) != {"path", "manifestPath"}
        or not isinstance(artifacts, Mapping)
        or set(artifacts)
        != {
            "smallManifest",
            "smallArtifactRoot",
            "baseLock",
            "baseArtifactRoot",
            "championArtifact",
        }
    ):
        raise ValueError("bridge split or search protocol drifted")
    input_root = _resolve_inside(
        repository_root, value.get("inputRoot"), field="inputRoot"
    )
    output_root = _resolve_inside(
        repository_root, value.get("outputRoot"), field="outputRoot"
    )
    input_root.relative_to((repository_root / ".tmp").resolve())
    output_root.relative_to(
        (repository_root / "scripts/routing_difficulty_model/artifacts").resolve()
    )
    require_canonical_dataset(
        _resolve_inside(repository_root, dataset["path"], field="dataset.path"),
        _resolve_inside(
            repository_root, dataset["manifestPath"], field="dataset.manifestPath"
        ),
    )
    return BridgeConfig(
        path=path.resolve(),
        repository_root=repository_root,
        value=value,
        input_root=input_root,
        output_root=output_root,
        config_sha256=sha256_file(path),
    )


def _subset_sum_family(
    order: Sequence[str], sizes: Mapping[str, int], target: int
) -> tuple[str, ...] | None:
    states: dict[int, tuple[str, ...]] = {0: ()}
    for family in order:
        size = sizes[family]
        for total, selected in sorted(tuple(states.items()), reverse=True):
            next_total = total + size
            if next_total <= target and next_total not in states:
                states[next_total] = (*selected, family)
        if target in states:
            return states[target]
    return None


def _split_balance_score(
    samples: Sequence[Mapping[str, Any]], assignment: Mapping[str, str]
) -> tuple[float, str]:
    overall_labels = Counter(int(sample["label"]) for sample in samples)
    overall_categories = Counter(str(sample["expectedCategory"]) for sample in samples)
    score = 0.0
    safe_membership: list[tuple[str, str]] = []
    for split, expected_count in TARGET_SPLIT_COUNTS.items():
        rows = [sample for sample in samples if assignment[str(sample["familyId"])] == split]
        if len(rows) != expected_count:
            return (float("inf"), "")
        labels = Counter(int(row["label"]) for row in rows)
        categories = Counter(str(row["expectedCategory"]) for row in rows)
        if set(labels) != {0, 1} or set(categories) != set(CATEGORIES):
            return (float("inf"), "")
        ratio = expected_count / len(samples)
        score += 4.0 * sum(
            abs(labels[label] - overall_labels[label] * ratio) for label in (0, 1)
        )
        score += sum(
            abs(categories[category] - overall_categories[category] * ratio)
            for category in CATEGORIES
        )
        safe_membership.extend(
            (str(row["sampleId"]), split) for row in rows
        )
    return score, canonical_sha256(sorted(safe_membership))


def assign_family_disjoint_70_15_15(
    samples: Sequence[Mapping[str, Any]], *, trials: int = 2048
) -> dict[str, str]:
    del samples, trials
    raise ValueError(
        "routing experiments must reuse the canonical 15,000-record split; resplitting is forbidden"
    )


def _write_jsonl(path: Path, rows: Sequence[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for row in rows
    )
    path.write_text(text, encoding="utf-8", newline="\n")


def _input_row(sample: Mapping[str, Any], split: str) -> dict[str, Any]:
    return {
        "sampleId": sample["sampleId"],
        "familyId": sample["familyId"],
        "split": split,
        "label": int(sample["label"]),
        "category": sample["expectedCategory"],
        "instructionText": sample["instructionText"],
        "ruleVectorV1": sample["ruleVectorV1"],
        "ruleDifficulty": sample["ruleDifficulty"],
        "modelPath": bool(sample["modelPath"]),
        "language": sample["language"],
        "evaluationSlices": sample["evaluationSlices"],
        "semanticTargets": {
            "semanticTaskBucket": sample["taskBucket"],
            "semanticConstraintBucket": sample["constraintBucket"],
            "semanticScopeBucket": sample["scopeBucket"],
            "semanticDependencyBucket": sample["dependencyBucket"],
        },
    }


def canonical_experiment_split(value: Any) -> str:
    aliases = {"train": "train", "calibration": "validation", "holdout": "test"}
    if value not in aliases:
        raise ValueError("canonical exporter returned an invalid split")
    return aliases[value]


def prepare_inputs(config: BridgeConfig, *, go_executable: str = "go") -> dict[str, Any]:
    dataset = _resolve_inside(
        config.repository_root, config.value["dataset"]["path"], field="dataset.path"
    )
    manifest_path = _resolve_inside(
        config.repository_root,
        config.value["dataset"]["manifestPath"],
        field="dataset.manifestPath",
    )
    manifest = experiment_manifest(require_canonical_dataset(dataset, manifest_path))
    exported = load_training_input(dataset, manifest_path, go_executable)
    samples = exported.get("samples")
    if not isinstance(samples, list) or len(samples) != 15_000:
        raise ValueError("approved exporter did not return all 15,000 aligned samples")
    identities: dict[str, Any] = {}
    membership_material: list[tuple[str, str, str]] = []
    for split in ("train", "validation", "test"):
        rows = [
            _input_row(sample, split)
            for sample in samples
            if canonical_experiment_split(sample.get("split")) == split
        ]
        rows.sort(key=lambda row: str(row["sampleId"]))
        path = config.input_root / f"{split}.jsonl"
        _write_jsonl(path, rows)
        identities[split] = {
            "relativePath": path.relative_to(config.repository_root).as_posix(),
            "sizeBytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "records": len(rows),
            "families": len({row["familyId"] for row in rows}),
            "simple": sum(row["label"] == 0 for row in rows),
            "complex": sum(row["label"] == 1 for row in rows),
            "categories": dict(sorted(Counter(row["category"] for row in rows).items())),
        }
        membership_material.extend(
            (str(row["sampleId"]), str(row["familyId"]), split) for row in rows
        )
    input_manifest = {
        "schemaVersion": INPUT_MANIFEST_SCHEMA,
        "experimentId": config.value["experimentId"],
        "configSha256": config.config_sha256,
        "dataset": {
            "version": manifest["datasetVersion"],
            "sha256": manifest["datasetSha256"],
            "manifestSha256": sha256_file(manifest_path),
            "sourceSplitPolicyVersion": manifest["splitPolicyVersion"],
        },
        "splitPolicyVersion": SPLIT_POLICY_VERSION,
        "splitSeed": EXPERIMENT_SEED,
        "splitMembershipSha256": canonical_sha256(sorted(membership_material)),
        "partitions": identities,
        "familyOverlap": 0,
        "containsPromptMaterial": False,
        "promotionState": "exploratory_only",
    }
    config.output_root.mkdir(parents=True, exist_ok=True)
    write_json_artifact(config.output_root, "input-manifest.v1.json", input_manifest)
    return input_manifest


def _load_partition(
    config: BridgeConfig, manifest: Mapping[str, Any], split: str
) -> list[dict[str, Any]]:
    identity = manifest["partitions"][split]
    path = _resolve_inside(
        config.repository_root, identity["relativePath"], field=f"{split}.relativePath"
    )
    if path.stat().st_size != identity["sizeBytes"] or sha256_file(path) != identity["sha256"]:
        raise ValueError(f"{split} input identity mismatch")
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    if len(rows) != TARGET_SPLIT_COUNTS[split] or any(row.get("split") != split for row in rows):
        raise ValueError(f"{split} input shape mismatch")
    return rows


def _flatten_head_probabilities(probabilities: Mapping[str, Any]) -> np.ndarray:
    matrices = [np.asarray(probabilities[spec.name], dtype=np.float64) for spec in SEMANTIC_HEAD_SPECS_V1]
    value = np.ascontiguousarray(np.concatenate(matrices, axis=1), dtype=np.float32)
    if value.ndim != 2 or value.shape[1] != 12 or not np.all(np.isfinite(value)):
        raise ValueError("semantic head probabilities are not exact finite 12D")
    return value


def _semantic_targets(rows: Sequence[Mapping[str, Any]], indices: Sequence[int]) -> dict[str, list[str]]:
    return {
        spec.name: [str(rows[index]["semanticTargets"][spec.name]) for index in indices]
        for spec in SEMANTIC_HEAD_SPECS_V1
    }


def _save_pca(path: Path, pca: PCA) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        mean=np.asarray(pca.mean_, dtype=np.float64),
        components=np.asarray(pca.components_, dtype=np.float64),
        explained_variance=np.asarray(pca.explained_variance_, dtype=np.float64),
        l2_epsilon=np.asarray([1e-12], dtype=np.float64),
    )


def _load_pca_transform(path: Path, values: np.ndarray) -> np.ndarray:
    with np.load(path, allow_pickle=False) as artifact:
        mean = np.asarray(artifact["mean"], dtype=np.float64)
        components = np.asarray(artifact["components"], dtype=np.float64)
    result = (np.asarray(values, dtype=np.float64) - mean) @ components.T
    norms = np.linalg.norm(result, axis=1, keepdims=True)
    if result.shape[1] != 64 or np.any(norms <= 1e-12) or not np.all(np.isfinite(result)):
        raise ValueError("PCA64 output is invalid")
    return np.ascontiguousarray(result / norms, dtype=np.float32)


def _artifact_paths(config: BridgeConfig) -> dict[str, Path]:
    artifacts = config.value["artifacts"]
    return {
        key: _resolve_inside(config.repository_root, value, field=f"artifacts.{key}")
        for key, value in artifacts.items()
    }


def _champion_prediction(
    rows: Sequence[Mapping[str, Any]], small_runtime: Any, small_pooled: np.ndarray, champion_path: Path
) -> np.ndarray:
    artifact = read_json_object(champion_path)
    if artifact.get("candidateName") != "42d-rule-vector-v1-plus-projection" or artifact.get("totalDimension") != 106:
        raise ValueError("authoritative LR champion identity mismatch")
    if small_runtime.projection is None:
        raise ValueError("authoritative LR projection is unavailable")
    projection = small_runtime.projection.transform(small_pooled)
    rules = np.asarray([row["ruleVectorV1"] for row in rows], dtype=np.float64)
    matrix = np.concatenate((rules, projection), axis=1)
    scores = _artifact_scores(artifact, matrix)
    result = np.asarray(
        [
            1
            if bool(row["modelPath"]) and float(score) >= float(artifact["threshold"])
            else 1
            if not bool(row["modelPath"]) and row["ruleDifficulty"] == "complex"
            else 0
            for row, score in zip(rows, scores, strict=True)
        ],
        dtype=np.int8,
    )
    return result


def _build_development_features(
    config: BridgeConfig,
    rows: Sequence[Mapping[str, Any]],
    train_count: int,
    folds: Sequence[Any],
) -> FeatureMaterial:
    paths = _artifact_paths(config)
    small_runtime, small_manifest = load_runtime(
        manifest_path=paths["smallManifest"], artifact_root=paths["smallArtifactRoot"]
    )
    instructions = [str(row["instructionText"]) for row in rows]
    small_pooled = encode_pooled_single_requests(small_runtime, instructions)
    pca = PCA(n_components=64, svd_solver="full", whiten=False)
    pca.fit(small_pooled[:train_count])
    pca_path = config.output_root / "feature-material/e5-small-pca64.train-only.v1.npz"
    _save_pca(pca_path, pca)
    pca64 = _load_pca_transform(pca_path, small_pooled)

    oof_heads = np.full((train_count, 12), np.nan, dtype=np.float32)
    pca_hash = sha256_file(pca_path)
    for fold in folds:
        fit = fold.fit_indices.tolist()
        valid = fold.validation_indices.tolist()
        artifact = train_semantic_heads(
            pca64[fit],
            _semantic_targets(rows, fit),
            artifact_version=f"dimension-tuning-heads-fold-{fold.fold}.2026-07-22.v1",
            encoder_version="e5-small-train-only-pca64.2026-07-22.v1",
            encoder_hash=pca_hash,
            pooling_version=str(small_manifest["pooling"]["version"]),
        )
        oof_heads[valid] = _flatten_head_probabilities(
            predict_semantic_head_probabilities(artifact, pca64[valid])
        )
    if not np.all(np.isfinite(oof_heads)):
        raise ValueError("semantic head OOF coverage is incomplete")
    full_head_artifact = train_semantic_heads(
        pca64[:train_count],
        _semantic_targets(rows, list(range(train_count))),
        artifact_version="dimension-tuning-heads-full-train.2026-07-22.v1",
        encoder_version="e5-small-train-only-pca64.2026-07-22.v1",
        encoder_hash=pca_hash,
        pooling_version=str(small_manifest["pooling"]["version"]),
    )
    semantic_heads_path = write_json_artifact(
        config.output_root,
        "feature-material/e5-small-pca64-semantic-heads12.train-only.v1.json",
        full_head_artifact,
    )
    heads12 = _flatten_head_probabilities(
        predict_semantic_head_probabilities(full_head_artifact, pca64)
    )
    heads12[:train_count] = oof_heads

    base_lock = load_lock(paths["baseLock"], artifact_root=paths["baseArtifactRoot"])
    base_runtime = E5BaseEncoderRuntime(
        artifact_root=paths["baseArtifactRoot"], lock=base_lock
    )
    base_rows: list[np.ndarray] = []
    for index, instruction in enumerate(instructions, start=1):
        base_rows.append(base_runtime.encode_one(instruction))
        if index % 50 == 0 or index == len(instructions):
            print(f"E5-base encoded {index}/{len(instructions)} development records")
    base768 = np.ascontiguousarray(np.stack(base_rows), dtype=np.float32)
    rules = np.asarray([row["ruleVectorV1"] for row in rows], dtype=np.float32)
    matrices = build_four_way_matrices(
        rule_vectors=rules,
        e5_small_pca_64=pca64,
        semantic_head_probabilities=heads12,
        e5_base_raw_768=base768,
    )
    identity_common = {
        "smallBundleSha256": small_manifest["bundleSha256"],
        "pca64Sha256": pca_hash,
        "semanticHeadsSha256": full_head_artifact["artifactContentHash"],
        "baseRuntimeLockSha256": sha256_file(paths["baseLock"]),
        "featurePolicyVersion": FEATURE_POLICY_VERSION,
    }
    descriptors = {
        candidate: {
            "providerKind": "gatelm_lightgbm_composite_feature_v1",
            "modelId": candidate,
            "sourceRevision": canonical_sha256(identity_common),
            "inputPrefix": "query: ",
            "maximumTokenLength": 128,
            "pooling": "attention_mask_weighted_mean_excluding_padding",
            "normalization": "candidate_specific_frozen_v1",
            "outputDtype": "float32",
            "outputDimension": dimension,
            "artifactIdentitySha256": canonical_sha256(
                {**identity_common, "candidate": candidate, "dimension": dimension}
            ),
        }
        for candidate, dimension in CANDIDATE_DIMENSIONS.items()
    }
    champion = _champion_prediction(rows, small_runtime, small_pooled, paths["championArtifact"])
    return FeatureMaterial(
        matrices=matrices,
        descriptors=descriptors,
        champion_prediction=champion,
        pca_path=pca_path,
        semantic_heads_path=semantic_heads_path,
    )


def _predict(booster: Any, matrix: np.ndarray, best_iteration: int) -> np.ndarray:
    values = np.asarray(booster.predict(matrix, num_iteration=best_iteration), dtype=np.float64)
    if values.shape != (matrix.shape[0],) or not np.all(np.isfinite(values)):
        raise ValueError("LightGBM prediction output is invalid")
    return values


def _selected_scenario(
    scenarios: Sequence[Mapping[str, Any]],
) -> Mapping[str, Any] | None:
    scenario = next(item for item in scenarios if float(item["cFn"]) == SELECTED_C_FN)
    selected = scenario.get("selected")
    if scenario.get("status") != "feasible" or not isinstance(selected, Mapping):
        return None
    return selected


def run_tuning(config: BridgeConfig, *, execution_approval_reference: str) -> dict[str, Any]:
    if not execution_approval_reference.strip():
        raise ValueError("execution approval reference is required")
    input_manifest = read_json_object(config.output_root / "input-manifest.v1.json")
    if input_manifest.get("configSha256") != config.config_sha256:
        raise ValueError("input manifest config identity mismatch")
    train_rows = _load_partition(config, input_manifest, "train")
    validation_rows = _load_partition(config, input_manifest, "validation")
    rows = [*train_rows, *validation_rows]
    labels = np.asarray([row["label"] for row in rows], dtype=np.int8)
    families = np.asarray([row["familyId"] for row in rows], dtype=object)
    records = np.asarray([row["sampleId"] for row in rows], dtype=object)
    categories = np.asarray([row["category"] for row in rows], dtype=object)
    train_count = len(train_rows)
    folds = make_stratified_group_folds(
        labels=labels[:train_count],
        family_ids=families[:train_count],
        record_ids=records[:train_count],
        categories=categories[:train_count],
    )
    features = _build_development_features(config, rows, train_count, folds)
    candidates = frozen_search_candidates()
    search_manifest = candidate_set_manifest(candidates)
    combined_candidate_set_sha = canonical_sha256(
        {
            "featureCandidates": [
                {"candidate": name, "dimension": CANDIDATE_DIMENSIONS[name]}
                for name in FEATURE_CANDIDATES
            ],
            "hyperparameterCandidateSetSha256": search_manifest["candidateSetSha256"],
        }
    )
    validation_identity = safe_row_identity_sha256(
        record_ids=records[train_count:].tolist(),
        labels=labels[train_count:].tolist(),
        categories=categories[train_count:].tolist(),
    )
    result_rows: list[dict[str, Any]] = []
    for feature_candidate in FEATURE_CANDIDATES:
        print(f"tuning {feature_candidate}: 80 candidates x 5 folds")
        matrix = features.matrices[feature_candidate]
        train_matrix = matrix[:train_count]
        validation_matrix = matrix[train_count:]
        baseline = evaluate_baseline(train_matrix, labels[:train_count], folds)
        search_results = run_random_search(
            train_matrix,
            labels[:train_count],
            folds,
            candidates,
            smoke=False,
        )
        selected = select_best_candidate(search_results)
        best_iteration = final_best_iteration(selected)
        booster = refit_full_train(train_matrix, labels[:train_count], selected)
        model_relative = f"candidates/{feature_candidate}/model.lightgbm.txt"
        model_path = config.output_root / model_relative
        save_model_with_parity(
            booster,
            model_path,
            parity_matrix=train_matrix[: min(32, train_count)],
            best_iteration=best_iteration,
        )
        oof = generate_oof_probabilities(
            train_matrix,
            labels[:train_count],
            families[:train_count],
            folds,
            selected,
        )
        validation_raw = _predict(booster, validation_matrix, best_iteration)
        calibration = select_calibrator(
            oof_probability=oof,
            train_labels=labels[:train_count],
            validation_raw_probability=validation_raw,
            validation_labels=labels[train_count:],
        )
        calibrator_relative = f"candidates/{feature_candidate}/calibrator.json"
        calibrator_path = write_json_artifact(
            config.output_root, calibrator_relative, calibration.selected_artifact
        )
        scenarios = select_threshold_scenarios(
            probability=calibration.selected_probability,
            labels=labels[train_count:],
            categories=categories[train_count:].tolist(),
            champion_prediction=features.champion_prediction[train_count:],
            row_identity_sha256=validation_identity,
            champion_row_identity_sha256=validation_identity,
        )
        scenario_json = [scenario.as_json() for scenario in scenarios]
        selected_threshold = _selected_scenario(scenario_json)
        metrics = classification_metrics(
            labels=labels[train_count:],
            probability=calibration.selected_probability,
            threshold=(
                float(selected_threshold["threshold"])
                if selected_threshold is not None
                else 0.5
            ),
        )
        row = {
            "featureCandidate": feature_candidate,
            "dimension": CANDIDATE_DIMENSIONS[feature_candidate],
            "descriptor": dict(features.descriptors[feature_candidate]),
            "baseline": baseline.aggregate_json(),
            "hyperparameterSearch": {
                "candidateCount": len(search_results),
                "completedFoldRuns": len(search_results) * len(folds),
                "candidateSetSha256": search_manifest["candidateSetSha256"],
                "results": [result.aggregate_json() for result in search_results],
            },
            "selectedHyperparameterCandidateId": selected.candidate_id,
            "selectedParameters": dict(selected.parameters),
            "bestIteration": best_iteration,
            "model": artifact_identity(config.output_root, model_path),
            "calibrator": {
                "type": calibration.selected_artifact["type"],
                **artifact_identity(config.output_root, calibrator_path),
            },
            "calibrationResults": list(calibration.aggregate_results),
            "thresholdScenarios": scenario_json,
            "validation": metrics,
            "selectedScenario": (
                dict(selected_threshold) if selected_threshold is not None else None
            ),
            "eligibleForSelection": selected_threshold is not None,
        }
        write_json_artifact(
            config.output_root,
            f"candidates/{feature_candidate}/tuning-evidence.json",
            row,
        )
        result_rows.append(row)
    eligible_features = [row for row in result_rows if row["eligibleForSelection"]]
    if not eligible_features:
        raise ValueError("no feature candidate satisfied the C_FN=5 safety constraints")
    selected_feature = min(
        eligible_features,
        key=lambda row: (
            float(row["selectedScenario"]["expectedDecisionLoss"]),
            int(row["selectedScenario"]["falseNegative"]),
            -float(row["validation"]["averagePrecision"]),
            float(row["validation"]["logLoss"]),
            int(row["dimension"]),
            str(row["featureCandidate"]),
        ),
    )
    dataset_identity = {
        "version": input_manifest["dataset"]["version"],
        "sha256": input_manifest["dataset"]["sha256"],
        "manifestSha256": input_manifest["dataset"]["manifestSha256"],
        "splitPolicyVersion": SPLIT_POLICY_VERSION,
        "splitMembershipSha256": input_manifest["splitMembershipSha256"],
        "testDataSha256": input_manifest["partitions"]["test"]["sha256"],
    }
    paths = _artifact_paths(config)
    champion_identity = {
        "version": "difficulty-authoritative-lr106.2026-07-15.v3",
        "sha256": sha256_file(paths["championArtifact"]),
    }
    slice_policy = {
        "version": "difficulty-evaluation-slices.owner-approved-15000.v1",
        "sha256": canonical_sha256(
            sorted({slice_name for row in rows for slice_name in row["evaluationSlices"]})
        ),
    }
    freeze_candidate = prepare_freeze_candidate(
        experiment_id=config.value["experimentId"],
        experiment_version=config.value["experimentVersion"],
        dataset_identity=dataset_identity,
        encoder_descriptor=selected_feature["descriptor"],
        embedding_dimension=int(selected_feature["dimension"]),
        candidate_set_sha256=combined_candidate_set_sha,
        fold_membership_sha256=fold_set_sha256(folds),
        selected_candidate_id=(
            f"{selected_feature['featureCandidate']}::"
            f"{selected_feature['selectedHyperparameterCandidateId']}"
        ),
        selected_parameters=selected_feature["selectedParameters"],
        best_iteration=int(selected_feature["bestIteration"]),
        model_identity=selected_feature["model"],
        calibrator_type=selected_feature["calibrator"]["type"],
        calibrator_identity={
            key: selected_feature["calibrator"][key]
            for key in ("relativePath", "sizeBytes", "sha256")
        },
        threshold_scenarios=selected_feature["thresholdScenarios"],
        code_config_sha256=config.config_sha256,
        champion_identity=champion_identity,
        slice_policy=slice_policy,
    )
    write_json_artifact(config.output_root, "pretest-freeze-candidate.json", freeze_candidate)
    evidence = {
        "schemaVersion": TUNING_SCHEMA,
        "experimentId": config.value["experimentId"],
        "experimentVersion": config.value["experimentVersion"],
        "executionApprovalReference": execution_approval_reference,
        "configSha256": config.config_sha256,
        "inputManifestSha256": sha256_file(config.output_root / "input-manifest.v1.json"),
        "splitPolicyVersion": SPLIT_POLICY_VERSION,
        "splitCounts": TARGET_SPLIT_COUNTS,
        "foldMembershipSha256": fold_set_sha256(folds),
        "hyperparameterCandidateSetSha256": search_manifest["candidateSetSha256"],
        "combinedCandidateSetSha256": combined_candidate_set_sha,
        "selectedCFn": SELECTED_C_FN,
        "selectionRule": [
            "validation_expected_decision_loss_asc",
            "validation_false_negative_asc",
            "validation_average_precision_desc",
            "validation_log_loss_asc",
            "dimension_asc",
            "candidate_id_asc",
        ],
        "selectedFeatureCandidate": selected_feature["featureCandidate"],
        "candidates": result_rows,
        "testOutcomeAccessed": False,
        "promotionState": "exploratory_only",
        "runtimeProfileGenerated": False,
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    write_json_artifact(config.output_root, "tuning-evidence.v1.json", evidence)
    return evidence


def freeze_selection(
    config: BridgeConfig,
    *,
    owner_decision_reference: str,
    owner_decision_timestamp: str,
) -> dict[str, Any]:
    candidate = read_json_object(config.output_root / "pretest-freeze-candidate.json")
    scenario = next(
        item
        for item in candidate["validationThresholdScenarios"]
        if float(item["cFn"]) == SELECTED_C_FN
    )
    selected = scenario["selected"]
    record = freeze_owner_selection(
        candidate,
        selected_c_fn=SELECTED_C_FN,
        selected_threshold=float(selected["threshold"]),
        owner_decision_reference=owner_decision_reference,
        owner_decision_timestamp=owner_decision_timestamp,
    )
    write_json_artifact(config.output_root, "pretest-freeze.json", record)
    return record


def _load_selected_test_matrix(
    config: BridgeConfig,
    rows: Sequence[Mapping[str, Any]],
    feature_candidate: str,
) -> tuple[np.ndarray, np.ndarray]:
    paths = _artifact_paths(config)
    instructions = [str(row["instructionText"]) for row in rows]
    rules = np.asarray([row["ruleVectorV1"] for row in rows], dtype=np.float32)
    small_runtime, _ = load_runtime(
        manifest_path=paths["smallManifest"], artifact_root=paths["smallArtifactRoot"]
    )
    small_pooled = encode_pooled_single_requests(small_runtime, instructions)
    champion = _champion_prediction(rows, small_runtime, small_pooled, paths["championArtifact"])
    if feature_candidate in {
        "rule_42_plus_e5_small_pca_64",
        "rule_42_plus_semantic_heads_12",
    }:
        pca64 = _load_pca_transform(
            config.output_root / "feature-material/e5-small-pca64.train-only.v1.npz",
            small_pooled,
        )
        if feature_candidate == "rule_42_plus_e5_small_pca_64":
            return np.ascontiguousarray(np.concatenate((rules, pca64), axis=1), dtype=np.float32), champion
        head_artifact = read_json_object(
            config.output_root
            / "feature-material/e5-small-pca64-semantic-heads12.train-only.v1.json"
        )
        heads = _flatten_head_probabilities(
            predict_semantic_head_probabilities(head_artifact, pca64)
        )
        return np.ascontiguousarray(np.concatenate((rules, heads), axis=1), dtype=np.float32), champion
    base_lock = load_lock(paths["baseLock"], artifact_root=paths["baseArtifactRoot"])
    base_runtime = E5BaseEncoderRuntime(
        artifact_root=paths["baseArtifactRoot"], lock=base_lock
    )
    base = np.ascontiguousarray(
        np.stack([base_runtime.encode_one(instruction) for instruction in instructions]),
        dtype=np.float32,
    )
    return (base if feature_candidate == "e5_base_raw_768" else np.concatenate((rules, base), axis=1)), champion


def evaluate_test(
    config: BridgeConfig,
    *,
    authorization_reference: str,
    authorization_timestamp: str,
) -> dict[str, Any]:
    input_manifest = read_json_object(config.output_root / "input-manifest.v1.json")
    freeze = read_json_object(config.output_root / "pretest-freeze.json")
    tuning = read_json_object(config.output_root / "tuning-evidence.v1.json")
    selected_feature = str(tuning["selectedFeatureCandidate"])

    def load_test_after_access_is_consumed() -> TestEvaluationInput:
        rows = _load_partition(config, input_manifest, "test")
        matrix, champion = _load_selected_test_matrix(config, rows, selected_feature)
        return TestEvaluationInput(
            matrix=np.ascontiguousarray(matrix, dtype=np.float32),
            labels=np.asarray([row["label"] for row in rows], dtype=np.int8),
            family_ids=[str(row["familyId"]) for row in rows],
            categories=[str(row["category"]) for row in rows],
            record_ids=[str(row["sampleId"]) for row in rows],
            slice_membership=[list(row["evaluationSlices"]) for row in rows],
            champion_prediction=champion,
            source_sha256=input_manifest["partitions"]["test"]["sha256"],
        )

    evidence = evaluate_frozen_test_once(
        artifact_root=config.output_root,
        freeze=freeze,
        authorization_reference=authorization_reference,
        authorization_timestamp=authorization_timestamp,
        test_loader=load_test_after_access_is_consumed,
        bootstrap_repeats=int(config.value["search"]["testBootstrapRepeats"]),
    )
    write_json_artifact(config.output_root, "test-evidence.v1.json", evidence)
    return evidence


def render_final_report(config: BridgeConfig) -> tuple[dict[str, Any], Path]:
    input_manifest = read_json_object(config.output_root / "input-manifest.v1.json")
    tuning = read_json_object(config.output_root / "tuning-evidence.v1.json")
    freeze = read_json_object(config.output_root / "pretest-freeze.json")
    test = read_json_object(config.output_root / "test-evidence.v1.json")
    final = {
        "schemaVersion": FINAL_SCHEMA,
        "experimentId": config.value["experimentId"],
        "experimentVersion": config.value["experimentVersion"],
        "status": "executed",
        "promotionState": "exploratory_only",
        "runtimeProfileGenerated": False,
        "candidateOrder": list(FEATURE_CANDIDATES),
        "splitCounts": TARGET_SPLIT_COUNTS,
        "splitMembershipSha256": input_manifest["splitMembershipSha256"],
        "hyperparameterCandidateCountPerFeature": 80,
        "completedFoldRuns": 4 * 80 * 5,
        "selectedCFn": SELECTED_C_FN,
        "selectedFeatureCandidate": tuning["selectedFeatureCandidate"],
        "selectedHyperparameterCandidateId": freeze["frozenCandidates"][0]["selectedCandidateId"],
        "freezeSha256": freeze["freezeSha256"],
        "testEvidenceSha256": test["evidenceSha256"],
        "validationCandidates": [
            {
                "featureCandidate": row["featureCandidate"],
                "dimension": row["dimension"],
                "selectedHyperparameterCandidateId": row["selectedHyperparameterCandidateId"],
                "selectedParameters": row["selectedParameters"],
                "bestIteration": row["bestIteration"],
                "calibratorType": row["calibrator"]["type"],
                "threshold": (
                    row["selectedScenario"]["threshold"]
                    if row["selectedScenario"] is not None
                    else None
                ),
                "eligibleForSelection": row["eligibleForSelection"],
                "validation": row["validation"],
                "model": row["model"],
            }
            for row in tuning["candidates"]
        ],
        "test": {
            "selectedCandidateCount": test["testAccess"]["evaluatedCandidateCount"],
            "overall": test["overall"],
            "safety": test["safety"],
            "categoryAndSlice": test["categoryAndSlice"],
            "familyGroupBootstrap": test["familyGroupBootstrap"],
        },
        "containsPromptMaterial": False,
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    final["evidenceSha256"] = canonical_sha256(final)
    final_path = config.output_root / "final-evidence.v1.json"
    if final_path.exists():
        if read_json_object(final_path) != final:
            raise ValueError("existing final evidence differs from rendered evidence")
    else:
        write_json_artifact(config.output_root, "final-evidence.v1.json", final)
    lines = [
        "# GateLM LightGBM Dimension-to-Hyperparameter Bridge Report",
        "",
        f"- Experiment: `{final['experimentId']}`",
        f"- Status: `{final['status']}`",
        f"- Split: `10,500 / 2,250 / 2,250`, family overlap `0`",
        f"- Search: `4 feature candidates x 80 hyperparameter candidates x 5 folds`",
        f"- Selected feature: `{final['selectedFeatureCandidate']}`",
        f"- Selected hyperparameter candidate: `{final['selectedHyperparameterCandidateId']}`",
        f"- Test evaluated candidate count: `{final['test']['selectedCandidateCount']}`",
        "",
        "| Feature candidate | D | Validation AP | Validation log loss | Validation FN |",
        "|---|---:|---:|---:|---:|",
    ]
    for row in final["validationCandidates"]:
        validation = row["validation"]
        lines.append(
            f"| `{row['featureCandidate']}` | {row['dimension']} | "
            f"{validation['averagePrecision']:.6f} | {validation['logLoss']:.6f} | "
            f"{validation['falseNegative']} |"
        )
    lines.extend(
        [
            "",
            "Only aggregate evidence is serialized. Prompt text, feature matrices, and per-sample scores are excluded.",
            "",
        ]
    )
    report_path = config.output_root / "final-report.md"
    report = "\n".join(lines)
    if report_path.exists():
        if report_path.read_text(encoding="utf-8") != report:
            raise ValueError("existing final report differs from rendered report")
    else:
        report_path.write_text(report, encoding="utf-8", newline="\n")

    reproducibility = {
        "schemaVersion": "gatelm.lightgbm-dimension-tuning-reproducibility-manifest.v1",
        "experimentId": config.value["experimentId"],
        "configSha256": config.config_sha256,
        "featureArtifacts": {
            "e5SmallPca64": artifact_identity(
                config.output_root,
                config.output_root
                / "feature-material/e5-small-pca64.train-only.v1.npz",
            ),
            "semanticHeads12": artifact_identity(
                config.output_root,
                config.output_root
                / "feature-material/e5-small-pca64-semantic-heads12.train-only.v1.json",
            ),
        },
        "candidateArtifacts": [
            {
                "featureCandidate": row["featureCandidate"],
                "model": dict(row["model"]),
                "calibrator": {
                    key: row["calibrator"][key]
                    for key in ("relativePath", "sizeBytes", "sha256")
                },
            }
            for row in tuning["candidates"]
        ],
        "stageEvidence": {
            "inputManifest": artifact_identity(
                config.output_root, config.output_root / "input-manifest.v1.json"
            ),
            "tuning": artifact_identity(
                config.output_root, config.output_root / "tuning-evidence.v1.json"
            ),
            "freeze": artifact_identity(
                config.output_root, config.output_root / "pretest-freeze.json"
            ),
            "test": artifact_identity(
                config.output_root, config.output_root / "test-evidence.v1.json"
            ),
            "final": artifact_identity(config.output_root, final_path),
        },
        "containsPromptMaterial": False,
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
        "promotionState": "exploratory_only",
    }
    reproducibility["manifestSha256"] = canonical_sha256(reproducibility)
    reproducibility_path = config.output_root / "reproducibility-manifest.v1.json"
    if reproducibility_path.exists():
        if read_json_object(reproducibility_path) != reproducibility:
            raise ValueError("existing reproducibility manifest differs from rendered manifest")
    else:
        write_json_artifact(
            config.output_root,
            "reproducibility-manifest.v1.json",
            reproducibility,
        )
    return final, report_path
