import unittest

import numpy as np

from gatelm_difficulty_model.encoder_runtime import (
    HeadTailTokenizer,
    LocalEncoderRuntime,
    fit_projection,
    l2_normalize,
    masked_mean,
)


class FakeTokenizer:
    cls_token_id = 101
    bos_token_id = None
    sep_token_id = 102
    eos_token_id = None

    def num_special_tokens_to_add(self, pair=False):
        return 2

    def encode(self, text, add_special_tokens=False, truncation=False, padding=False):
        return [int(value) for value in text.split()] if text.strip() else []

    def build_inputs_with_special_tokens(self, values):
        return [101, *values, 102]

    def create_token_type_ids_from_sequences(self, values):
        return [0] * (len(values) + 2)


class EncoderRuntimeTest(unittest.TestCase):
    def test_exact_head_tail_truncation_uses_token_ids(self) -> None:
        tokenizer = HeadTailTokenizer(FakeTokenizer(), 128)
        result = tokenizer.tokenize(" ".join(str(value) for value in range(1, 132)))

        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result.truncated)
        self.assertEqual(result.content_token_count, 131)
        self.assertEqual(len(result.input_ids), 128)
        self.assertEqual(result.input_ids[:4], (101, 1, 2, 3))
        self.assertEqual(result.input_ids[63], 63)
        self.assertEqual(result.input_ids[64], 69)
        self.assertEqual(result.input_ids[-4:], (129, 130, 131, 102))

    def test_empty_input_does_not_create_special_token_only_input(self) -> None:
        tokenizer = HeadTailTokenizer(FakeTokenizer(), 128)
        self.assertIsNone(tokenizer.tokenize(" \n\t"))

    def test_runtime_rejects_empty_input_instead_of_inventing_zero_representation(self) -> None:
        runtime = object.__new__(LocalEncoderRuntime)
        runtime.tokenizer = HeadTailTokenizer(FakeTokenizer(), 128)
        runtime.native_dimension = 8

        with self.assertRaisesRegex(ValueError, "semantic input must not be empty"):
            runtime.encode_raw(" \n\t")

    def test_masked_mean_excludes_padding_and_zeroes_invalid_mask(self) -> None:
        hidden = np.asarray([[[1, 2], [3, 4], [100, 100]]], dtype=np.float32)
        actual = masked_mean(hidden, np.asarray([[1, 1, 0]], dtype=np.int64))
        np.testing.assert_array_equal(actual, np.asarray([[2, 3]], dtype=np.float32))
        zero = masked_mean(hidden, np.asarray([[0, 0, 0]], dtype=np.int64))
        np.testing.assert_array_equal(zero, np.zeros((1, 2), dtype=np.float32))

    def test_l2_normalization_is_post_projection_safe_for_zero_vector(self) -> None:
        actual = l2_normalize(np.asarray([[3, 4], [0, 0]], dtype=np.float32))
        np.testing.assert_allclose(actual[0], np.asarray([0.6, 0.8], dtype=np.float32))
        np.testing.assert_array_equal(actual[1], np.zeros(2, dtype=np.float32))
        self.assertEqual(actual.dtype, np.float32)

    def test_projection_shape_hash_and_replay_are_deterministic(self) -> None:
        rng = np.random.default_rng(20260714)
        train = rng.normal(size=(12, 8)).astype(np.float32)
        projection = fit_projection(train, 4)
        replay = fit_projection(train, 4)

        self.assertEqual(projection.sha256, replay.sha256)
        self.assertEqual(projection.transform(train).shape, (12, 4))
        self.assertEqual(projection.serialize(), replay.serialize())
        with self.assertRaisesRegex(ValueError, "input dimension"):
            projection.transform(np.zeros((1, 7), dtype=np.float32))

    def test_projection_rejects_larger_than_native_dimension(self) -> None:
        with self.assertRaisesRegex(ValueError, "no larger than native"):
            fit_projection(np.zeros((20, 8), dtype=np.float32), 9)


if __name__ == "__main__":
    unittest.main()
