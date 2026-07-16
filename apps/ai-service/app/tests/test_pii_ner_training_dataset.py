from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.domain.ai_safety_eval.master_corpus import load_master_eval_corpus
from app.domain.ai_safety_training.koelectra_dataset import (
    SPLITS,
    TARGET_LABEL_BY_DETECTOR_TYPE,
    build_training_dataset,
    build_training_manifest,
    serialize_training_records,
)
from app.services.ai_safety_master_eval_runner import DEFAULT_CORPUS_PATH
from app.services.pii_ner_training_dataset_cli import run


class PiiNerTrainingDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = load_master_eval_corpus(DEFAULT_CORPUS_PATH)

    def test_dataset_is_deterministic_and_keeps_groups_in_one_split(self) -> None:
        first = build_training_dataset(self.cases)
        second = build_training_dataset(self.cases)

        self.assertEqual(first, second)
        groups_by_split = {
            split: {record.group_id for record in first[split]}
            for split in SPLITS
        }
        for index, split in enumerate(SPLITS):
            for other_split in SPLITS[index + 1 :]:
                self.assertTrue(
                    groups_by_split[split].isdisjoint(groups_by_split[other_split])
                )

    def test_every_split_contains_every_target_label_and_valid_spans(self) -> None:
        dataset = build_training_dataset(self.cases)
        expected_labels = set(TARGET_LABEL_BY_DETECTOR_TYPE.values())

        for split in SPLITS:
            actual_labels = {
                span.label for record in dataset[split] for span in record.spans
            }
            self.assertEqual(actual_labels, expected_labels)
            for record in dataset[split]:
                for span in record.spans:
                    self.assertTrue(record.text[span.start : span.end])

    def test_manifest_contains_only_aggregate_and_case_ids(self) -> None:
        dataset = build_training_dataset(self.cases)
        manifest = build_training_manifest(
            dataset,
            source_corpus_path=DEFAULT_CORPUS_PATH,
            data_file_digests={split: split[0] * 64 for split in SPLITS},
        )
        serialized = json.dumps(manifest, ensure_ascii=False)

        self.assertFalse(manifest["rawTextIncludedInManifest"])
        self.assertTrue(manifest["rawTextStoredInTrainingFiles"])
        self.assertNotIn('"text"', serialized)
        self.assertNotIn('"spans"', serialized)
        for split in SPLITS:
            first_record = dataset[split][0]
            self.assertNotIn(first_record.text, serialized)
            self.assertIn(first_record.case_id, serialized)

    def test_cli_writes_three_data_files_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir) / "dataset"

            exit_code = run(
                ["--corpus", str(DEFAULT_CORPUS_PATH), "--out", str(out_dir)]
            )

            self.assertEqual(exit_code, 0)
            self.assertTrue((out_dir / "manifest.json").is_file())
            for split in SPLITS:
                path = out_dir / f"{split}.jsonl"
                self.assertTrue(path.is_file())
                self.assertGreater(path.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
