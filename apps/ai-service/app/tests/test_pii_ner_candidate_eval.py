from __future__ import annotations

import unittest

from app.services.pii_ner_candidate_eval_cli import (
    TARGET_TYPES,
    evaluate_candidate_gates,
    nearest_rank,
)


class PiiNerCandidateEvalTests(unittest.TestCase):
    def test_candidate_gate_blocks_zero_recall_model(self) -> None:
        holdout, latency, screening = passing_inputs()
        holdout["spanMetrics"]["micro"]["f1"] = None
        holdout["spanMetrics"]["byEntity"]["person_name"] = {
            "truePositive": 0,
            "falsePositive": 0,
            "falseNegative": 1,
            "precision": None,
            "recall": 0.0,
            "f1": None,
        }

        result = evaluate_candidate_gates(
            holdout=holdout,
            latency=latency,
            screening=screening,
            peak_rss_mib=300,
            max_warm_p95_ms=50,
            max_peak_rss_mib=512,
            min_holdout_micro_f1=0.85,
            min_holdout_type_recall=0.5,
        )

        self.assertEqual(result["decision"], "fail")
        self.assertFalse(result["stage6DeploymentAllowed"])
        self.assertIn("holdoutMicroF1", result["failedChecks"])
        self.assertIn("holdoutPerTypeRecall", result["failedChecks"])

    def test_candidate_gate_allows_only_complete_passing_evidence(self) -> None:
        holdout, latency, screening = passing_inputs()

        result = evaluate_candidate_gates(
            holdout=holdout,
            latency=latency,
            screening=screening,
            peak_rss_mib=300,
            max_warm_p95_ms=50,
            max_peak_rss_mib=512,
            min_holdout_micro_f1=0.85,
            min_holdout_type_recall=0.5,
        )

        self.assertEqual(result["decision"], "pass")
        self.assertTrue(result["stage6DeploymentAllowed"])
        self.assertEqual(result["failedChecks"], [])

    def test_nearest_rank_is_deterministic(self) -> None:
        self.assertEqual(nearest_rank([4, 1, 3, 2], 0.95), 4)


def passing_inputs() -> tuple[dict, dict, dict]:
    perfect = {
        "truePositive": 1,
        "falsePositive": 0,
        "falseNegative": 0,
        "precision": 1.0,
        "recall": 1.0,
        "f1": 1.0,
    }
    holdout = {
        "negativeFalsePositiveCaseCount": 0,
        "spanMetrics": {
            "micro": dict(perfect),
            "byEntity": {
                detector_type: dict(perfect) for detector_type in TARGET_TYPES
            },
        },
    }
    comparison_types = {
        detector_type: {
            "rescuedTruePositiveCases": 0,
            "newHardNegativeFalsePositiveCases": 0,
        }
        for detector_type in TARGET_TYPES
    }
    comparison_types["person_name"]["rescuedTruePositiveCases"] = 1
    screening = {
        "comparison": {
            "summaryDelta": {"passedCases": 1},
            "newFalsePositiveCaseIds": [],
            "byDetectorType": comparison_types,
        }
    }
    return holdout, {"p95Ms": 10.0}, screening


if __name__ == "__main__":
    unittest.main()
