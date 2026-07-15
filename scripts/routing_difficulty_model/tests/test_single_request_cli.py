from __future__ import annotations

import unittest

from gatelm_difficulty_model import candidate_cli, e5_encoder_cli


class SingleRequestCliTests(unittest.TestCase):
    def test_candidate_training_defaults_to_one_and_rejects_microbatching(self) -> None:
        self.assertEqual(candidate_cli.parse_args([]).batch_size, 1)
        with self.assertRaises(SystemExit):
            candidate_cli.parse_args(["--batch-size", "16"])

    def test_pca_fit_defaults_to_one_and_rejects_microbatching(self) -> None:
        self.assertEqual(e5_encoder_cli.parse_args(["fit-pca"]).batch_size, 1)
        with self.assertRaises(SystemExit):
            e5_encoder_cli.parse_args(["fit-pca", "--batch-size", "16"])


if __name__ == "__main__":
    unittest.main()
