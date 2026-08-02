from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.domain.ai_safety_eval.master_corpus import load_master_eval_corpus
from app.domain.ai_safety_training.koelectra_dataset import (
    POSITIVE_VARIANTS_PER_RECORD,
    SPLITS,
    TARGET_LABEL_BY_DETECTOR_TYPE,
    build_training_dataset,
    build_training_manifest,
    serialize_training_records,
    training_record_from_case,
)
from app.domain.ai_safety_training.pii_error_curation import (
    CURATED_HARD_NEGATIVE_VARIANTS_PER_CASE,
    CURATION_REPORT_VERSION,
    MODEL_SHA256,
    REVIEW_SCHEMA_VERSION,
    TARGET_THRESHOLDS,
    sha256_canonical_text_file,
)
from app.services.pii_ner_training_dataset_cli import DEFAULT_CORPUS_PATH, run


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

    def test_positive_records_are_augmented_with_split_disjoint_values(self) -> None:
        dataset = build_training_dataset(self.cases)
        base_positive_counts = {
            split: sum(
                bool(record.spans)
                for case in self.cases
                if (record := training_record_from_case(case)).split == split
            )
            for split in SPLITS
        }
        values_by_split: dict[str, set[str]] = {}

        for split in SPLITS:
            positives = [record for record in dataset[split] if record.spans]
            self.assertEqual(
                len(positives),
                base_positive_counts[split] * POSITIVE_VARIANTS_PER_RECORD,
            )
            values_by_split[split] = {
                record.text[span.start : span.end]
                for record in positives
                for span in record.spans
            }

        for index, split in enumerate(SPLITS):
            for other_split in SPLITS[index + 1 :]:
                self.assertTrue(
                    values_by_split[split].isdisjoint(values_by_split[other_split])
                )

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

    def test_cli_adds_only_dataset_owner_approved_curation_records(self) -> None:
        case_id = "gen_private_date_external_share_block_07"
        candidate = {
            "caseId": case_id,
            "proposedTrainingDisposition": "hard_negative",
            "recommendedDecision": "confirmed_model_error",
            "recommendationReason": "non_target_fixture_detected_as_target",
        }
        report = {
            "reportVersion": CURATION_REPORT_VERSION,
            "status": "review_required",
            "syntheticOnly": True,
            "productionPromotionEvidence": False,
            "model": {
                "version": "v0.1.1",
                "sha256": MODEL_SHA256,
                "thresholds": TARGET_THRESHOLDS,
                "canonicalRegistrySha256": "d" * 64,
                "artifactManifestSha256": "e" * 64,
                "artifactFileCount": 7,
            },
            "source": {
                "corpusSha256": sha256_canonical_text_file(DEFAULT_CORPUS_PATH),
                "subsetManifestSha256": "c" * 64,
            },
            "regressionGuards": {
                "caseCount": 13,
                "passedCaseCount": 13,
                "failedCaseIds": [],
                "passed": True,
            },
            "screening": {"mismatchCandidates": [candidate]},
        }
        report_text = json.dumps(report, sort_keys=True) + "\n"
        review = {
            "schemaVersion": REVIEW_SCHEMA_VERSION,
            "status": "approved",
            "trainingEligible": True,
            "reviewerRole": "dataset_owner",
            "reviewedAt": "2026-08-02T00:00:00Z",
            "approvalMechanism": "manual_json_attestation",
            "reviewerIdentityVerified": False,
            "repositoryApprovalEvidenceRequired": True,
            "syntheticOnly": True,
            "modelVersion": "v0.1.1",
            "modelSha256": MODEL_SHA256,
            "curationReportSha256": hashlib.sha256(
                report_text.encode("utf-8")
            ).hexdigest(),
            "sourceCorpusSha256": report["source"]["corpusSha256"],
            "subsetManifestSha256": "c" * 64,
            "candidateCount": 1,
            "decisions": [
                {
                    **candidate,
                    "decision": "confirmed_model_error",
                }
            ],
        }
        base = build_training_dataset(self.cases)
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            report_path = root / "report.json"
            review_path = root / "review.json"
            out_dir = root / "dataset"
            report_path.write_text(report_text, encoding="utf-8")
            review_path.write_text(
                json.dumps(review, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            exit_code = run(
                [
                    "--out",
                    str(out_dir),
                    "--curation-report",
                    str(report_path),
                    "--curation-review",
                    str(review_path),
                ]
            )
            manifest = json.loads(
                (out_dir / "manifest.json").read_text(encoding="utf-8")
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(manifest["errorCuration"]["approvedCaseCount"], 1)
        self.assertEqual(
            manifest["errorCuration"]["addedRecordCount"],
            CURATED_HARD_NEGATIVE_VARIANTS_PER_CASE,
        )
        self.assertEqual(
            sum(item["recordCount"] for item in manifest["splits"].values()),
            sum(len(base[split]) for split in SPLITS)
            + CURATED_HARD_NEGATIVE_VARIANTS_PER_CASE,
        )


if __name__ == "__main__":
    unittest.main()
