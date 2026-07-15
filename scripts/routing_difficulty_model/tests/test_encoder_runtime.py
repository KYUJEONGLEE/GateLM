from __future__ import annotations

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

import numpy as np

from gatelm_difficulty_model.encoder_runtime import (
    EXECUTION_SHAPE_POLICY_VERSION,
    INPUT_PREFIX,
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_MANIFEST_PATH,
    InvalidEmbedding,
    PCAProjection,
    SemanticInputNotApplicable,
    E5EncoderRuntime,
    canonical_hash,
    encode_pooled_single_requests,
    fit_pca,
    masked_mean,
    read_json,
    sha256_file,
    validate_manifest,
)


class FakeTokenizer:
    def __init__(self) -> None:
        self.calls = []

    def __call__(self, texts, **kwargs):
        self.calls.append((texts, kwargs))
        lengths = [min(128, max(2, len(text.split()) + 2)) for text in texts]
        width = max(lengths)
        input_ids = np.zeros((len(texts), width), dtype=np.int64)
        attention_mask = np.zeros_like(input_ids)
        for index, length in enumerate(lengths):
            input_ids[index, :length] = np.arange(1, length + 1)
            attention_mask[index, :length] = 1
        return {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "token_type_ids": np.zeros_like(input_ids),
        }


class FakeSession:
    def run(self, output_names, inputs):
        assert output_names == ["last_hidden_state"]
        batch, sequence = inputs["input_ids"].shape
        hidden = np.ones((batch, sequence, 384), dtype=np.float32)
        hidden *= inputs["input_ids"][..., None]
        return [hidden]


class EncoderRuntimeTests(unittest.TestCase):
    def test_single_request_embedding_helper_never_microbatches(self) -> None:
        class Runtime:
            def __init__(self) -> None:
                self.calls = []

            def encode_pooled_one(self, instruction_text):
                self.calls.append(instruction_text)
                return np.full(384, len(self.calls), dtype=np.float32)

        runtime = Runtime()
        actual = encode_pooled_single_requests(runtime, ["one", "two", "three"])
        self.assertEqual(actual.shape, (3, 384))
        self.assertEqual(actual.dtype, np.float32)
        self.assertEqual(runtime.calls, ["one", "two", "three"])

    def test_masked_mean_excludes_padding(self) -> None:
        hidden = np.zeros((1, 3, 384), dtype=np.float32)
        hidden[0, 0, :] = 1.0
        hidden[0, 1, :] = 3.0
        hidden[0, 2, :] = 100.0
        actual = masked_mean(hidden, np.asarray([[1, 1, 0]], dtype=np.int64))
        np.testing.assert_allclose(actual, np.full((1, 384), 2.0, dtype=np.float32))
        with self.assertRaises(InvalidEmbedding):
            masked_mean(hidden, np.zeros((1, 3), dtype=np.int64))

    def test_tokenizer_adds_query_prefix_for_exactly_one_request(self) -> None:
        runtime = object.__new__(E5EncoderRuntime)
        runtime.tokenizer = FakeTokenizer()
        encoded = runtime.tokenize(["compare the requirements in detail"])
        texts, kwargs = runtime.tokenizer.calls[0]
        self.assertEqual(texts, [INPUT_PREFIX + "compare the requirements in detail"])
        self.assertEqual(kwargs["max_length"], 128)
        self.assertTrue(kwargs["truncation"])
        self.assertTrue(kwargs["padding"])
        self.assertEqual(encoded["input_ids"].shape, encoded["attention_mask"].shape)
        self.assertEqual(encoded["input_ids"].shape[0], 1)

        with self.assertRaisesRegex(ValueError, "exactly one request"):
            runtime.tokenize(["one", "two"])

    def test_empty_instruction_is_not_applicable(self) -> None:
        runtime = object.__new__(E5EncoderRuntime)
        runtime.tokenizer = FakeTokenizer()
        with self.assertRaises(SemanticInputNotApplicable):
            runtime.tokenize([" "])

    def test_single_request_encode_returns_normalized_float32_64d(self) -> None:
        rng = np.random.default_rng(20260715)
        projection = PCAProjection(
            mean=np.zeros(384, dtype=np.float32),
            components=rng.normal(size=(64, 384)).astype(np.float32),
        )
        runtime = object.__new__(E5EncoderRuntime)
        runtime.tokenizer = FakeTokenizer()
        runtime.session = FakeSession()
        runtime.input_names = {"input_ids", "attention_mask", "token_type_ids"}
        runtime.projection = projection
        result = runtime.encode(["second request with more words"])
        pooled = runtime.encode_pooled(["second request with more words"])
        self.assertEqual(result.shape, (1, 64))
        self.assertEqual(result.dtype, np.float32)
        self.assertEqual(pooled.shape, (1, 384))
        self.assertEqual(pooled.dtype, np.float32)
        np.testing.assert_allclose(np.linalg.norm(result, axis=1), np.ones(1), atol=1e-6)
        np.testing.assert_allclose(runtime.encode_one("second request with more words"), result[0], atol=1e-6)
        np.testing.assert_allclose(runtime.encode_pooled_one("second request with more words"), pooled[0], atol=1e-6)

    def test_projection_rejects_degenerate_output(self) -> None:
        projection = PCAProjection(
            mean=np.zeros(384, dtype=np.float32),
            components=np.zeros((64, 384), dtype=np.float32),
        )
        with self.assertRaises(InvalidEmbedding):
            projection.transform(np.ones((1, 384), dtype=np.float32))

    def test_fit_pca_uses_300_raw_embeddings_and_npz_round_trips(self) -> None:
        rng = np.random.default_rng(20260715)
        embeddings = rng.normal(size=(300, 384)).astype(np.float32)
        projection = fit_pca(embeddings)
        transformed = projection.transform(embeddings[:3])
        self.assertEqual(transformed.shape, (3, 64))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "projection.npz"
            second_path = Path(directory) / "projection-second.npz"
            projection.save(path)
            projection.save(second_path)
            loaded = PCAProjection.load(path)
            self.assertEqual(sha256_file(path), sha256_file(second_path))
            self.assertEqual(loaded.parameter_hash, projection.parameter_hash)
            np.testing.assert_allclose(loaded.transform(embeddings[:3]), transformed, atol=1e-6)

    def test_manifest_rejects_rehashed_contract_tampering(self) -> None:
        manifest = deepcopy(read_json(DEFAULT_MANIFEST_PATH))
        manifest["encoder"]["outputDimension"] = 383
        material = dict(manifest)
        material.pop("bundleSha256")
        manifest["bundleSha256"] = canonical_hash(material)
        with self.assertRaisesRegex(ValueError, "encoder contract mismatch"):
            validate_manifest(
                manifest,
                artifact_root=DEFAULT_ARTIFACT_ROOT,
                verify_files=False,
            )

    def test_manifest_rejects_non_runtime_equivalent_batch_shape(self) -> None:
        manifest = deepcopy(read_json(DEFAULT_MANIFEST_PATH))
        manifest["executionShape"]["batchSize"] = 16
        material = dict(manifest)
        material.pop("bundleSha256")
        manifest["bundleSha256"] = canonical_hash(material)
        with self.assertRaisesRegex(ValueError, "execution shape contract mismatch"):
            validate_manifest(
                manifest,
                artifact_root=DEFAULT_ARTIFACT_ROOT,
                verify_files=False,
            )
        self.assertEqual(
            read_json(DEFAULT_MANIFEST_PATH)["executionShape"]["policyVersion"],
            EXECUTION_SHAPE_POLICY_VERSION,
        )


if __name__ == "__main__":
    unittest.main()
