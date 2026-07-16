from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Sequence

from app.domain.ai_safety_eval.master_corpus import load_master_eval_corpus
from app.domain.ai_safety_training.koelectra_dataset import (
    SPLITS,
    build_training_dataset,
    build_training_manifest,
    serialize_training_records,
)
from app.services.ai_safety_master_eval_runner import DEFAULT_CORPUS_PATH


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build synthetic-only KoELECTRA PII NER span datasets."
    )
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--out", type=Path, required=True)
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        cases = load_master_eval_corpus(args.corpus)
        dataset = build_training_dataset(cases)
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

