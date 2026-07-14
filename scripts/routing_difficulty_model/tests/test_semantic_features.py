import math
import unittest

from gatelm_difficulty_model.semantic_features import (
    RULE_VECTOR_V1_DIMENSION,
    SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1,
    SEMANTIC_HEAD_SPECS_V1,
    OfflineFeatureCandidate,
    OfflineFeatureShape,
    OfflineFeatureValues,
    SemanticHeadSpec,
)


def make_shape(projection_dimension: int = 8) -> OfflineFeatureShape:
    return OfflineFeatureShape(
        projection_dimension=projection_dimension,
        projection_version="difficulty-projection.test-v1",
        semantic_heads_version="difficulty-semantic-heads.test-v1",
    )


def one_hot_heads() -> dict[str, tuple[float, ...]]:
    return {
        spec.name: (1.0,) + (0.0,) * (len(spec.classes) - 1)
        for spec in SEMANTIC_HEAD_SPECS_V1
    }


class OfflineFeatureShapeTest(unittest.TestCase):
    def test_declares_fixed_candidate_dimensions_and_offsets(self) -> None:
        shape = make_shape(projection_dimension=8)
        baseline = shape.descriptor(OfflineFeatureCandidate.RULE_VECTOR_V1)
        projection = shape.descriptor(
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION
        )
        combined = shape.descriptor(
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS
        )

        self.assertEqual(RULE_VECTOR_V1_DIMENSION, 42)
        self.assertEqual(SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1, 46)
        self.assertEqual(baseline.total_dimension, 42)
        self.assertEqual(projection.total_dimension, 50)
        self.assertEqual(combined.total_dimension, 96)
        self.assertEqual(
            [(segment.name, segment.offset, segment.dimension) for segment in combined.segments],
            [
                ("ruleVectorV1", 0, 42),
                ("semanticProjection", 42, 8),
                ("semanticHeads.semanticTaskBucket", 50, 6),
                ("semanticHeads.semanticConstraintBucket", 56, 7),
                ("semanticHeads.semanticScopeBucket", 63, 5),
                ("semanticHeads.semanticDependencyBucket", 68, 6),
                ("semanticHeads.semanticCodeOperation", 74, 10),
                ("semanticHeads.semanticDomainTerminology", 84, 3),
                ("semanticHeads.semanticSynthesisLevel", 87, 3),
                ("semanticHeads.semanticReasoningDepth", 90, 6),
            ],
        )

    def test_assembles_candidates_without_overwriting_rule_vector_v1(self) -> None:
        shape = make_shape(projection_dimension=2)
        rule = tuple(float(index) / 42.0 for index in range(42))
        projection = (0.25, -0.5)
        heads = one_hot_heads()
        values = OfflineFeatureValues(
            rule_vector_v1=rule,
            semantic_projection=projection,
            semantic_head_probabilities=heads,
        )

        baseline = shape.assemble(OfflineFeatureCandidate.RULE_VECTOR_V1, values)
        projected = shape.assemble(
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION, values
        )
        combined = shape.assemble(
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS,
            values,
        )

        self.assertEqual(baseline, rule)
        self.assertEqual(projected[:42], rule)
        self.assertEqual(combined[:42], rule)
        self.assertEqual(projected[42:], projection)
        self.assertEqual(combined[42:44], projection)
        self.assertEqual(len(combined), 42 + 2 + 46)

    def test_uses_distinct_deterministic_feature_names(self) -> None:
        shape = make_shape(projection_dimension=2)
        names = shape.feature_names(
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS
        )

        self.assertEqual(len(names), 90)
        self.assertEqual(names[0], "ruleVectorV1.payloadEmpty")
        self.assertEqual(names[41], "ruleVectorV1.reasoningUncertaintyScenarioCount")
        self.assertEqual(names[42:44], ("semanticProjection[0]", "semanticProjection[1]"))
        self.assertEqual(
            names[44],
            "semanticHeads.semanticTaskBucket.count_0.probability",
        )
        self.assertEqual(
            names[-1],
            "semanticHeads.semanticReasoningDepth.depth_5_plus.probability",
        )
        self.assertEqual(len(names), len(set(names)))

    def test_requires_candidate_specific_inputs_without_silent_fallback(self) -> None:
        shape = make_shape()
        rule_only = OfflineFeatureValues(rule_vector_v1=(0.0,) * 42)

        self.assertEqual(
            len(shape.assemble(OfflineFeatureCandidate.RULE_VECTOR_V1, rule_only)),
            42,
        )
        with self.assertRaisesRegex(ValueError, "semanticProjection is required"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION,
                rule_only,
            )

        projection_only = OfflineFeatureValues(
            rule_vector_v1=(0.0,) * 42,
            semantic_projection=(0.0,) * 8,
        )
        with self.assertRaisesRegex(ValueError, "head probabilities are required"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS,
                projection_only,
            )

    def test_rejects_dimension_and_numeric_errors(self) -> None:
        shape = make_shape(projection_dimension=2)
        with self.assertRaisesRegex(ValueError, "ruleVectorV1 dimension"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1,
                OfflineFeatureValues(rule_vector_v1=(0.0,) * 41),
            )
        with self.assertRaisesRegex(ValueError, r"ruleVectorV1 values must be within \[0, 1\]"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1,
                OfflineFeatureValues(rule_vector_v1=(-0.1,) + (0.0,) * 41),
            )
        with self.assertRaisesRegex(ValueError, "semanticProjection dimension"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION,
                OfflineFeatureValues(
                    rule_vector_v1=(0.0,) * 42,
                    semantic_projection=(0.0,),
                ),
            )
        with self.assertRaisesRegex(ValueError, "finite"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION,
                OfflineFeatureValues(
                    rule_vector_v1=(0.0,) * 42,
                    semantic_projection=(math.nan, 0.0),
                ),
            )

    def test_rejects_missing_extra_or_invalid_head_probabilities(self) -> None:
        shape = make_shape(projection_dimension=1)
        base = OfflineFeatureValues(
            rule_vector_v1=(0.0,) * 42,
            semantic_projection=(0.0,),
        )

        missing = one_hot_heads()
        missing.pop("semanticTaskBucket")
        with self.assertRaisesRegex(ValueError, "missing=.*semanticTaskBucket"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS,
                OfflineFeatureValues(
                    base.rule_vector_v1, base.semantic_projection, missing
                ),
            )

        extra = one_hot_heads()
        extra["semanticUnknown"] = (1.0,)
        with self.assertRaisesRegex(ValueError, "extra=.*semanticUnknown"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS,
                OfflineFeatureValues(base.rule_vector_v1, base.semantic_projection, extra),
            )

        bad_sum = one_hot_heads()
        bad_sum["semanticSynthesisLevel"] = (0.2, 0.2, 0.2)
        with self.assertRaisesRegex(ValueError, "must sum to 1"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS,
                OfflineFeatureValues(
                    base.rule_vector_v1, base.semantic_projection, bad_sum
                ),
            )

        out_of_range = one_hot_heads()
        out_of_range["semanticDomainTerminology"] = (1.1, -0.1, 0.0)
        with self.assertRaisesRegex(ValueError, r"within \[0, 1\]"):
            shape.assemble(
                OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS,
                OfflineFeatureValues(
                    base.rule_vector_v1, base.semantic_projection, out_of_range
                ),
            )

    def test_requires_versioned_positive_shape_configuration(self) -> None:
        with self.assertRaisesRegex(ValueError, "positive integer"):
            make_shape(projection_dimension=0)
        with self.assertRaisesRegex(ValueError, "positive integer"):
            make_shape(projection_dimension=1.5)  # type: ignore[arg-type]
        with self.assertRaisesRegex(ValueError, "projection version"):
            OfflineFeatureShape(
                projection_dimension=8,
                projection_version=" ",
                semantic_heads_version="difficulty-semantic-heads.test-v1",
            )
        with self.assertRaisesRegex(ValueError, "semantic heads version"):
            OfflineFeatureShape(
                projection_dimension=8,
                projection_version="difficulty-projection.test-v1",
                semantic_heads_version=" ",
            )
        changed_last_head = SemanticHeadSpec(
            "semanticReasoningDepth",
            tuple(reversed(SEMANTIC_HEAD_SPECS_V1[-1].classes)),
        )
        with self.assertRaisesRegex(ValueError, "fixed v1 name, class, and ordering"):
            OfflineFeatureShape(
                projection_dimension=8,
                projection_version="difficulty-projection.test-v1",
                semantic_heads_version="difficulty-semantic-heads.test-v1",
                semantic_head_specs=SEMANTIC_HEAD_SPECS_V1[:-1]
                + (changed_last_head,),
            )


if __name__ == "__main__":
    unittest.main()
