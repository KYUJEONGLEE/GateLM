#!/usr/bin/env python3
"""Train a FastText supervised cacheability classifier artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_TRAIN_FILE = BASE_DIR / "build" / "cacheability.train.txt"
DEFAULT_OUTPUT_DIR = BASE_DIR / "build" / "artifacts"
DEFAULT_MODEL_VERSION = "cacheability-fasttext-synthetic-v3"

LABELS = [
    "cacheable_static",
    "cacheable_policy",
    "dynamic_user_state",
    "unsafe_or_unknown",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-file", type=Path, default=DEFAULT_TRAIN_FILE, help="FastText supervised training file.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Directory for model artifact and metadata.")
    parser.add_argument("--model-version", default=DEFAULT_MODEL_VERSION, help="Stable modelVersion stored in metadata.")
    parser.add_argument("--epoch", type=int, default=35)
    parser.add_argument("--lr", type=float, default=0.6)
    parser.add_argument("--word-ngrams", type=int, default=1)
    parser.add_argument("--dim", type=int, default=64)
    parser.add_argument("--min-count", type=int, default=1)
    parser.add_argument("--loss", choices=["softmax", "ova", "hs", "ns"], default="softmax")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def slug(value: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip())
    return sanitized.strip("-") or DEFAULT_MODEL_VERSION


def import_fasttext() -> Any:
    try:
        import fasttext  # type: ignore
    except ImportError as exc:
        print(
            "Python package 'fasttext' is required for training. "
            "Install it in your local tooling environment, then rerun this script.",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc
    return fasttext


def main() -> int:
    args = parse_args()
    train_file = args.train_file.resolve()
    output_dir = args.output_dir.resolve()

    if not train_file.exists():
        print(f"training file not found: {train_file}", file=sys.stderr)
        return 2

    fasttext = import_fasttext()
    output_dir.mkdir(parents=True, exist_ok=True)

    model = fasttext.train_supervised(
        input=str(train_file),
        epoch=args.epoch,
        lr=args.lr,
        wordNgrams=args.word_ngrams,
        dim=args.dim,
        minCount=args.min_count,
        loss=args.loss,
    )

    model_stem = f"cacheability-{slug(args.model_version)}"
    model_file = output_dir / f"{model_stem}.bin"
    metadata_file = output_dir / f"{model_stem}.metadata.json"
    model.save_model(str(model_file))

    metadata = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "modelVersion": args.model_version,
        "modelFamily": "fasttext-supervised",
        "classifierLabels": LABELS,
        "artifact": str(model_file),
        "trainFile": str(train_file),
        "trainFileSha256": sha256_file(train_file),
        "hyperparameters": {
            "epoch": args.epoch,
            "lr": args.lr,
            "wordNgrams": args.word_ngrams,
            "dim": args.dim,
            "minCount": args.min_count,
            "loss": args.loss,
        },
        "runtimeBoundary": (
            "Offline training artifact only. Gateway live requests must not execute "
            "this Python training script."
        ),
    }
    metadata_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
