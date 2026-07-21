from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from gatelm_difficulty_model.lightgbm_embedding_experiment import (
    CATEGORIES,
    EXPERIMENT_SEED,
    ExperimentError,
    ExperimentStatus,
    build_embedding_matrix,
    canonical_sha256,
    encode_validated_matrix,
    fold_set_sha256,
    make_stratified_group_folds,
    safe_row_identity_sha256,
    validate_dataset_arrays,
    validate_dataset_eligibility,
    validate_encoder_descriptor,
    validate_feature_alignment,
)
from gatelm_difficulty_model.lightgbm_embedding_search import (
    BASELINE_PARAMS,
    CandidateResult,
    SearchCandidate,
    SearchIncompleteError,
    all_valid_combinations,
    candidate_set_manifest,
    evaluate_baseline,
    final_best_iteration,
    frozen_search_candidates,
    generate_oof_probabilities,
    refit_full_train,
    save_model_with_parity,
    select_best_candidate,
    run_random_search,
)


class FakeProvider:
    def __init__(self, dimension: int = 7) -> None:
        self._dimension = dimension
        self._identity = "a" * 64

    @property
    def descriptor(self):
        return {
            "providerKind": "synthetic_test_only",
            "modelId": "synthetic/model",
            "sourceRevision": "revision",
            "inputPrefix": "",
            "maximumTokenLength": 8,
            "pooling": "synthetic",
            "normalization": "none",
            "outputDtype": "float32",
            "outputDimension": self._dimension,
            "artifactIdentitySha256": self._identity,
        }

    @property
    def declared_dimension(self):
        return self._dimension

    @property
    def artifact_identity_sha256(self):
        return self._identity

    def encode_batch(self, instruction_texts):
        return [np.full(self._dimension, index + 1, dtype=np.float32) for index, _ in enumerate(instruction_texts)]


def synthetic_train_arrays(records: int = 80, dimension: int = 5):
    rng = np.random.default_rng(EXPERIMENT_SEED)
    labels = np.asarray([index % 2 for index in range(records)], dtype=np.int8)
    matrix = rng.normal(size=(records, dimension)).astype(np.float32)
    matrix[:, 0] += labels * 1.5
    families = np.asarray([f"family-{index}" for index in range(records)], dtype=object)
    records_ids = np.asarray([f"record-{index}" for index in range(records)], dtype=object)
    categories = np.asarray(
        [CATEGORIES[index % len(CATEGORIES)] for index in range(records)], dtype=object
    )
    folds = make_stratified_group_folds(
        labels=labels,
        family_ids=families,
        record_ids=records_ids,
        categories=categories,
    )
    return matrix, labels, families, records_ids, categories, folds


class EmbeddingContractTests(unittest.TestCase):
    def test_dynamic_dimension_is_accepted(self) -> None:
        matrix = build_embedding_matrix(
            [[1, 2, 3], [4, 5, 6]], declared_dimension=3
        )
        self.assertEqual(matrix.shape, (2, 3))
        self.assertEqual(matrix.dtype, np.float32)

    def test_ragged_row_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "EMBEDDING_DIMENSION_MISMATCH"):
            build_embedding_matrix([[1, 2], [3]], declared_dimension=2)

    def test_declared_actual_dimension_mismatch_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "EMBEDDING_DIMENSION_MISMATCH"):
            build_embedding_matrix([[1, 2]], declared_dimension=3)

    def test_empty_embedding_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "EMBEDDING_ROW_EMPTY"):
            build_embedding_matrix([[]], declared_dimension=1)

    def test_non_finite_embedding_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "EMBEDDING_NON_FINITE"):
            build_embedding_matrix([[float("nan")]], declared_dimension=1)

    def test_non_rank_one_embedding_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "EMBEDDING_ROW_RANK_INVALID"):
            build_embedding_matrix([[[1.0]]], declared_dimension=1)

    def test_mixed_encoder_rows_are_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "MIXED_ENCODER_ROWS"):
            build_embedding_matrix(
                [[1.0], [2.0]],
                declared_dimension=1,
                row_encoder_identities=["a", "b"],
            )

    def test_provider_encodes_dynamic_dimension_in_memory(self) -> None:
        matrix = encode_validated_matrix(FakeProvider(9), ["one", "two"])
        self.assertEqual(matrix.shape, (2, 9))

    def test_encoder_descriptor_dimension_mismatch_is_rejected(self) -> None:
        descriptor = FakeProvider(3).descriptor
        with self.assertRaisesRegex(ExperimentError, "ENCODER_DECLARED_DIMENSION_MISMATCH"):
            validate_encoder_descriptor(descriptor, declared_dimension=4)


class DatasetAndFoldTests(unittest.TestCase):
    def test_row_alignment_mismatch_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "ROW_ALIGNMENT_MISMATCH"):
            validate_dataset_arrays(
                labels=[0, 1],
                family_ids=["a"],
                splits=["train", "train"],
                categories=["general", "code"],
                record_ids=["1", "2"],
                require_all_splits=False,
            )

    def test_invalid_label_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "LABEL_INVALID"):
            validate_dataset_arrays(
                labels=[0, 2],
                family_ids=["a", "b"],
                splits=["train", "train"],
                categories=["general", "code"],
                record_ids=["1", "2"],
                require_all_splits=False,
            )

    def test_invalid_category_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "CATEGORY_INVALID"):
            validate_dataset_arrays(
                labels=[0, 1],
                family_ids=["a", "b"],
                splits=["train", "train"],
                categories=["general", "unknown"],
                record_ids=["1", "2"],
                require_all_splits=False,
            )

    def test_empty_family_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "FAMILY_ID_EMPTY"):
            validate_dataset_arrays(
                labels=[0, 1],
                family_ids=["", "b"],
                splits=["train", "train"],
                categories=["general", "code"],
                record_ids=["1", "2"],
                require_all_splits=False,
            )

    def test_current_15000_manifest_is_training_ineligible(self) -> None:
        root = Path(__file__).resolve().parents[3]
        path = root / "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.manifest.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        with self.assertRaises(ExperimentError) as captured:
            validate_dataset_eligibility(manifest)
        self.assertEqual(
            captured.exception.status,
            ExperimentStatus.BLOCKED_DATASET_INELIGIBLE,
        )

    def test_approved_manifest_and_file_hash_are_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "approved.jsonl"
            path.write_bytes(b"safe synthetic fixture\n")
            manifest = {
                "scope": {"training_eligible": True},
                "review": {
                    "production_gold": True,
                    "human_reviewed": True,
                    "review_status": "approved",
                },
                "counts": {"human_reviewed_records": 2},
                "dataset_sha256": __import__("hashlib").sha256(path.read_bytes()).hexdigest(),
            }
            validate_dataset_eligibility(manifest, dataset_file=path)

    def test_cross_split_family_leakage_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "CROSS_SPLIT_FAMILY_LEAKAGE"):
            validate_dataset_arrays(
                labels=[0, 1, 0, 1, 0, 1],
                family_ids=["shared", "b", "shared", "d", "e", "f"],
                splits=["train", "train", "validation", "validation", "test", "test"],
                categories=["general"] * 6,
                record_ids=[str(index) for index in range(6)],
            )

    def test_fold_generation_is_reproducible_and_family_disjoint(self) -> None:
        _, labels, families, records, categories, folds = synthetic_train_arrays()
        second = make_stratified_group_folds(
            labels=labels,
            family_ids=families,
            record_ids=records,
            categories=categories,
        )
        self.assertEqual(fold_set_sha256(folds), fold_set_sha256(second))
        for fold in folds:
            self.assertFalse(set(families[fold.fit_indices]) & set(families[fold.validation_indices]))
            self.assertEqual(set(labels[fold.validation_indices]), {0, 1})

    def test_fold_generation_requires_five_families(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "FOLD_FAMILY_SUPPORT_INSUFFICIENT"):
            make_stratified_group_folds(
                labels=[0, 1, 0, 1],
                family_ids=["a", "b", "c", "d"],
                record_ids=["1", "2", "3", "4"],
                categories=["general", "code", "translation", "reasoning"],
            )

    def test_feature_alignment_requires_float32(self) -> None:
        arrays = validate_dataset_arrays(
            labels=[0, 1],
            family_ids=["a", "b"],
            splits=["train", "train"],
            categories=["general", "code"],
            record_ids=["1", "2"],
            require_all_splits=False,
        )
        with self.assertRaisesRegex(ExperimentError, "FEATURE_ROW_ALIGNMENT_MISMATCH"):
            validate_feature_alignment(np.zeros((2, 3), dtype=np.float64), arrays)

    def test_safe_row_identity_changes_with_order(self) -> None:
        first = safe_row_identity_sha256(
            record_ids=["a", "b"], labels=[0, 1], categories=["general", "code"]
        )
        second = safe_row_identity_sha256(
            record_ids=["b", "a"], labels=[1, 0], categories=["code", "general"]
        )
        self.assertNotEqual(first, second)


class SearchProtocolTests(unittest.TestCase):
    def test_frozen_candidate_set_is_reproducible_and_exactly_80(self) -> None:
        first = frozen_search_candidates()
        second = frozen_search_candidates()
        self.assertEqual(first, second)
        self.assertEqual(len(first), 80)
        self.assertEqual(len({item.candidate_id for item in first}), 80)

    def test_every_search_candidate_satisfies_depth_constraint(self) -> None:
        for candidate in frozen_search_candidates():
            depth = candidate.parameters["max_depth"]
            leaves = candidate.parameters["num_leaves"]
            self.assertTrue(depth == -1 or leaves <= 2**depth)

    def test_candidate_set_hash_is_stable(self) -> None:
        first = candidate_set_manifest(frozen_search_candidates())
        second = candidate_set_manifest(frozen_search_candidates())
        self.assertEqual(first["candidateSetSha256"], second["candidateSetSha256"])
        self.assertEqual(first["canonicalCombinationCount"], len(all_valid_combinations()))

    def _result(self, candidate_id: str, mean: float, std: float, iterations=(3, 5, 7, 9, 11)):
        return CandidateResult(
            candidate_id=candidate_id,
            parameters={"learning_rate": 0.1},
            fold_average_precision=(mean,) * 5,
            fold_binary_log_loss=(0.5,) * 5,
            fold_best_iteration=tuple(iterations),
            mean_average_precision=mean,
            std_average_precision=std,
            median_best_iteration=int(np.median(iterations)),
            warning_count=0,
            error_count=0,
            elapsed_seconds=1.0,
            fold_set_sha256="f" * 64,
        )

    def test_candidate_ranking_uses_mean_then_std(self) -> None:
        selected = select_best_candidate(
            [self._result("a", 0.8, 0.2), self._result("b", 0.8, 0.1)]
        )
        self.assertEqual(selected.candidate_id, "b")

    def test_exact_tie_uses_lexical_candidate_id(self) -> None:
        selected = select_best_candidate(
            [self._result("candidate-b", 0.8, 0.1), self._result("candidate-a", 0.8, 0.1)]
        )
        self.assertEqual(selected.candidate_id, "candidate-a")

    def test_final_iteration_is_fold_median(self) -> None:
        self.assertEqual(final_best_iteration(self._result("a", 0.8, 0.1)), 7)

    def test_failed_candidates_are_aggregated_and_never_replaced(self) -> None:
        matrix, labels, _, _, _, folds = synthetic_train_arrays(records=40)
        candidates = frozen_search_candidates()
        with patch(
            "gatelm_difficulty_model.lightgbm_embedding_search.evaluate_candidate",
            side_effect=ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "SYNTHETIC_CANDIDATE_FAILURE",
            ),
        ), self.assertRaises(SearchIncompleteError) as captured:
            run_random_search(matrix, labels, folds, candidates)
        self.assertEqual(len(captured.exception.results), 80)
        self.assertEqual(
            {result.candidate_id for result in captured.exception.results},
            {candidate.candidate_id for candidate in candidates},
        )
        self.assertTrue(all(result.status == "failed" for result in captured.exception.results))


_HAS_LIGHTGBM_460 = (
    importlib.util.find_spec("lightgbm") is not None
    and importlib.metadata.version("lightgbm") == "4.6.0"
)


@unittest.skipUnless(_HAS_LIGHTGBM_460, "official LightGBM 4.6.0 is not installed")
class SyntheticLightGBMIntegrationTests(unittest.TestCase):
    def test_baseline_refit_oof_and_model_parity_on_synthetic_vectors(self) -> None:
        matrix, labels, families, _, _, folds = synthetic_train_arrays(records=60)
        baseline = evaluate_baseline(
            matrix,
            labels,
            folds,
            test_round_override=8,
            test_stopping_override=3,
        )
        self.assertEqual(len(baseline.fold_average_precision), 5)
        candidate = SearchCandidate("synthetic", BASELINE_PARAMS)
        result = CandidateResult(
            candidate_id=candidate.candidate_id,
            parameters=candidate.parameters,
            fold_average_precision=baseline.fold_average_precision,
            fold_binary_log_loss=baseline.fold_binary_log_loss,
            fold_best_iteration=(4, 4, 4, 4, 4),
            mean_average_precision=baseline.mean_average_precision,
            std_average_precision=baseline.std_average_precision,
            median_best_iteration=4,
            warning_count=0,
            error_count=0,
            elapsed_seconds=baseline.elapsed_seconds,
            fold_set_sha256=baseline.fold_set_sha256,
        )
        booster = refit_full_train(matrix, labels, result)
        oof = generate_oof_probabilities(
            matrix,
            labels,
            families,
            folds,
            result,
            test_round_override=4,
        )
        self.assertEqual(oof.shape, labels.shape)
        self.assertTrue(np.all(np.isfinite(oof)))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "synthetic-test-model.txt"
            save_model_with_parity(
                booster,
                path,
                parity_matrix=matrix[:10],
                best_iteration=4,
            )
            self.assertTrue(path.is_file())


if __name__ == "__main__":
    unittest.main()
