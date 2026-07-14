from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from gatelm_difficulty_model import semantic_heads_cli


class DummyRuntime:
    def encode_one(self, _text):
        return [1.0] * 64

    def encode_pooled_one(self, _text):
        raise AssertionError("semantic heads must not bypass the canonical PCA projection")


class SemanticHeadsCliTests(unittest.TestCase):
    def test_run_uses_canonical_projected_64d_encoder_output(self) -> None:
        args = SimpleNamespace(
            dataset="dataset",
            manifest="dataset-manifest",
            go="go",
            artifact_version="heads-v1",
            calibration_bins=10,
            artifact_output="artifact",
            report_output="report",
        )
        runtime = DummyRuntime()
        encoder_manifest = {
            "bundleVersion": "difficulty-e5-encoder-pca64.2026-07-15.v1",
            "bundleSha256": "a" * 64,
            "pooling": {"version": "difficulty-attention-masked-mean.v2"},
        }
        captured = {}

        def train(exported, encoder, **kwargs):
            captured["encoder"] = encoder
            captured["kwargs"] = kwargs
            return {"artifact": True}, {"report": True}

        with (
            patch.object(semantic_heads_cli, "load_training_input", return_value={"samples": []}),
            patch.object(semantic_heads_cli, "install_network_guard"),
            patch.object(
                semantic_heads_cli,
                "load_selected_runtime",
                return_value=(runtime, encoder_manifest),
            ),
            patch.object(semantic_heads_cli, "train_and_evaluate_semantic_heads", side_effect=train),
            patch.object(semantic_heads_cli, "write_json"),
        ):
            semantic_heads_cli.run(args)

        self.assertIs(captured["encoder"].__self__, runtime)
        self.assertIs(captured["encoder"].__func__, DummyRuntime.encode_one)
        self.assertEqual(
            captured["kwargs"]["encoder_version"],
            "difficulty-e5-encoder-pca64.2026-07-15.v1",
        )


if __name__ == "__main__":
    unittest.main()
