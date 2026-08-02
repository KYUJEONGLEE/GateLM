from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Sequence

from app.domain.ai_safety_eval.master_corpus import load_master_eval_corpus
from app.domain.ai_safety_training.pii_error_curation import (
    build_curated_training_records,
    load_approved_review,
    merge_curated_training_records,
    sha256_canonical_text_file,
)
from app.domain.ai_safety_training.koelectra_dataset import (
    SPLITS,
    build_training_dataset,
    build_training_manifest,
    serialize_training_records,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CORPUS_PATH = (
    REPO_ROOT / "docs" / "ai-safety-lab" / "fixtures" / "master-safety-eval-corpus.jsonl"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build synthetic-only KoELECTRA PII NER span datasets."
    )
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--curation-report", type=Path)
    parser.add_argument("--curation-review", type=Path)
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if (args.curation_report is None) != (args.curation_review is None):
            raise ValueError(
                "PII curation report and dataset-owner review must be provided together"
            )
        cases = load_master_eval_corpus(args.corpus)
        dataset = build_training_dataset(cases)
        curation_summary = None
        if args.curation_report is not None and args.curation_review is not None:
            approved = load_approved_review(
                args.curation_review,
                curation_report_path=args.curation_report,
            )
            report = json.loads(args.curation_report.read_text(encoding="utf-8"))
            if (
                sha256_canonical_text_file(args.corpus)
                != report["source"]["corpusSha256"]
            ):
                raise ValueError("PII curation source corpus checksum mismatch")
            curated = build_curated_training_records(cases, approved)
            dataset = merge_curated_training_records(dataset, curated)
            curated_records = [
                record for split in SPLITS for record in curated[split]
            ]
            curation_summary = {
                "reportSha256": sha256_canonical_text_file(args.curation_report),
                "reviewSha256": sha256_canonical_text_file(args.curation_review),
                "approvedCaseCount": len(approved),
                "hardNegativeCaseCount": sum(
                    disposition == "hard_negative"
                    for disposition in approved.values()
                ),
                "positiveCaseCount": sum(
                    disposition == "positive" for disposition in approved.values()
                ),
                "addedRecordCount": len(curated_records),
                "rawTextIncludedInManifest": False,
            }
        args.out.mkdir(parents=True, exist_ok=True)
        data_file_digests: dict[str, str] = {}
        for split in SPLITS:
            serialized = serialize_training_records(dataset[split])
            path = args.out / f"{split}.jsonl"
            path.write_text(serialized, encoding="utf-8")
            data_file_digests[split] = hashlib.sha256(
                serialized.encode("utf-8")
            ).hexdigest()
        manifest = build_training_manifest(
            dataset,
            source_corpus_path=args.corpus,
            data_file_digests=data_file_digests,
        )
        if curation_summary is not None:
            manifest["errorCuration"] = curation_summary
        manifest_path = args.out / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    split_counts = ", ".join(
        f"{split}={len(dataset[split])}" for split in SPLITS
    )
    print(f"PII NER training dataset built: {split_counts}, manifest={manifest_path}")
    return 0


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
