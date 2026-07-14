import unittest

from gatelm_difficulty_model.encoder_benchmark import (
    _forbidden_key_paths,
    choose_projection,
    quantization_decision,
)


def evaluation(dimension, accuracy, regressions, p95=10.0, rss=1000, size=1000, language=0.8):
    return {
        "projectionDimension": dimension,
        "projectionVersion": "test",
        "projectionSha256": f"sha256:{dimension:064x}",
        "quality": {
            "overall": {"accuracy": accuracy, "complexToSimpleCount": regressions},
            "minimumLanguageAccuracy": language,
        },
        "latency": {"p95Millis": p95},
        "memory": {"steadyStateRssBytes": rss, "peakRssBytes": rss},
        "runtimeArtifactSizeBytes": size,
    }


class EncoderBenchmarkTest(unittest.TestCase):
    def test_projection_selection_uses_safety_accuracy_tolerance_then_smallest(self) -> None:
        worker = {
            "projectionEvaluations": [
                evaluation(384, 0.90, 1),
                evaluation(256, 0.899, 1),
                evaluation(128, 0.897, 1),
                evaluation(64, 0.88, 0),
            ]
        }
        selected = choose_projection(worker, 0.005)
        self.assertEqual(selected["projectionDimension"], 64)

        worker["projectionEvaluations"][-1] = evaluation(64, 0.88, 1)
        selected = choose_projection(worker, 0.005)
        self.assertEqual(selected["projectionDimension"], 128)

    def test_quantization_requires_quality_and_resource_gate(self) -> None:
        policy = {
            "maximumAccuracyDrop": 0.005,
            "maximumMinimumLanguageAccuracyDrop": 0.01,
            "maximumComplexToSimpleCountIncrease": 0,
            "minimumP95LatencyImprovementRatio": 0.05,
            "minimumSteadyRssReductionRatio": 0.1,
            "minimumArtifactSizeReductionRatio": 0.5,
        }
        fp32 = evaluation(128, 0.9, 1, p95=10, rss=1000, size=1000, language=0.85)
        quantized = evaluation(128, 0.898, 1, p95=8, rss=900, size=400, language=0.845)
        self.assertTrue(quantization_decision(fp32, quantized, policy)["selected"])

        unsafe = evaluation(128, 0.89, 2, p95=5, rss=400, size=200, language=0.80)
        decision = quantization_decision(fp32, unsafe, policy)
        self.assertFalse(decision["selected"])
        self.assertFalse(decision["qualityGatePassed"])

    def test_forbidden_report_material_is_rejected_recursively(self) -> None:
        self.assertEqual(_forbidden_key_paths({"aggregate": {"accuracy": 1.0}}), [])
        paths = _forbidden_key_paths({"candidate": {"embedding": [0.1], "samples": []}})
        self.assertEqual(paths, ["$.candidate.embedding", "$.candidate.samples"])


if __name__ == "__main__":
    unittest.main()
