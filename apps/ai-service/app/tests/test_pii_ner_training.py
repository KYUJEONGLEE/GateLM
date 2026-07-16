from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.domain.ai_safety_training.koelectra_training import (
    BIO_LABELS,
    align_bio_label_ids,
    entity_chunks,
    exact_span_metric_report,
    label_maps,
    load_and_verify_dataset,
    span_metric_report,
)
from app.services.pii_ner_export_cli import build_export_report, find_exported_model


class PiiNerTrainingTests(unittest.TestCase):
    def test_aligns_offsets_to_bio_labels_and_ignores_special_tokens(self) -> None:
        label_to_id, id_to_label = label_maps()
        offsets = [(0, 0), (0, 2), (2, 3), (3, 4), (0, 0)]
        spans = [{"start": 0, "end": 3, "label": "PER"}]

        actual = align_bio_label_ids(offsets, spans, label_to_id)

        self.assertEqual(
            [id_to_label.get(label, "IGNORE") for label in actual],
            ["IGNORE", "B-PER", "I-PER", "O", "IGNORE"],
        )

    def test_entity_chunks_recovers_from_leading_inside_label(self) -> None:
        label_to_id, id_to_label = label_maps()

        chunks = entity_chunks(
            [label_to_id["I-ORG"], label_to_id["I-ORG"], label_to_id["O"]],
            id_to_label,
        )

        self.assertEqual(chunks, {("ORG", 0, 2)})

    def test_span_metric_report_counts_exact_chunks(self) -> None:
        expected = [{("PER", 0, 2), ("ORG", 4, 6)}]
        actual = [{("PER", 0, 2), ("ORG", 5, 6)}]

        report = span_metric_report(expected, actual)

        self.assertEqual(report["micro"]["truePositive"], 1)
        self.assertEqual(report["micro"]["falsePositive"], 1)
        self.assertEqual(report["micro"]["falseNegative"], 1)
        self.assertEqual(report["micro"]["f1"], 0.5)

    def test_exact_span_metric_report_uses_character_boundaries(self) -> None:
        report = exact_span_metric_report(
            [{("person_name", 2, 5)}],
            [{("person_name", 2, 5), ("organization_name", 7, 9)}],
            entity_types=("person_name", "organization_name"),
        )

        self.assertEqual(report["micro"]["truePositive"], 1)
        self.assertEqual(report["micro"]["falsePositive"], 1)
        self.assertEqual(
            report["byEntity"]["organization_name"]["falsePositive"],
            1,
        )

    def test_dataset_verifier_rejects_checksum_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            record = {
                "schemaVersion": "gatelm.pii-ner-training.v1",
                "caseId": "synthetic_case",
                "split": "train",
                "locale": "ko-KR",
                "groupId": "a" * 16,
                "syntheticOnly": True,
                "text": "synthetic",
                "spans": [],
            }
            serialized = json.dumps(record) + "\n"
            (root / "train.jsonl").write_text(serialized, encoding="utf-8")
            manifest = {
                "schemaVersion": "gatelm.pii-ner-training-manifest.v1",
                "syntheticOnly": True,
                "customerPromptUsed": False,
                "splits": {
                    "train": {"dataFileSha256": "0" * 64, "recordCount": 1}
                },
            }
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                load_and_verify_dataset(root, include_splits=("train",))

    def test_label_contract_is_stable(self) -> None:
        self.assertEqual(
            BIO_LABELS,
            (
                "O",
                "B-ADDR",
                "I-ADDR",
                "B-EMA",
                "I-EMA",
                "B-ORG",
                "I-ORG",
                "B-PER",
                "I-PER",
                "B-PHN",
                "I-PHN",
                "B-RRN",
                "I-RRN",
            ),
        )

    def test_export_report_contains_only_aggregate_artifact_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            model_dir = root / "trained"
            output_dir = root / "onnx"
            model_dir.mkdir()
            output_dir.mkdir()
            (model_dir / "training-report.json").write_text("{}\n", encoding="utf-8")
            (output_dir / "model.onnx").write_bytes(b"onnx")
            (output_dir / "config.json").write_text("{}\n", encoding="utf-8")

            report = build_export_report(
                model_dir=model_dir,
                output_dir=output_dir,
                input_names=["attention_mask", "input_ids"],
                max_model_bytes=8,
            )

            self.assertEqual(report["model"]["sizeGate"], "pass")
            self.assertFalse(report["rawTextIncluded"])
            self.assertFalse(report["spanOrOffsetIncluded"])
            self.assertNotIn('"text":', json.dumps(report).lower())

    def test_find_exported_model_rejects_ambiguous_graphs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "a.onnx").write_bytes(b"a")
            (root / "b.onnx").write_bytes(b"b")

            with self.assertRaisesRegex(ValueError, "exactly one"):
                find_exported_model(root)


if __name__ == "__main__":
    unittest.main()
