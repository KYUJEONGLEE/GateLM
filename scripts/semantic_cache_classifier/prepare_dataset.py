#!/usr/bin/env python3
"""Prepare FastText supervised files for the cacheability classifier."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET = BASE_DIR / "data" / "cacheability_synthetic_v3.jsonl"
DEFAULT_OUTPUT_DIR = BASE_DIR / "build"

LABELS = {
    "cacheable_static",
    "cacheable_policy",
    "dynamic_user_state",
    "unsafe_or_unknown",
}

PAIR_ROLES = {"positive", "negative"}
SPLITS = {"train", "test"}

FORBIDDEN_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{10,}", re.IGNORECASE),
    re.compile(r"(authorization:\s*bearer|api[_ -]?key\s*[=:]\s*[A-Za-z0-9_-]{8,}|token\s*[=:]\s*[A-Za-z0-9_-]{8,})", re.IGNORECASE),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b\d{13,19}\b"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Input JSONL dataset.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output directory for FastText split files.")
    parser.add_argument("--seed", default="cacheability-synthetic-v3", help="Stable seed used when split is not explicit.")
    parser.add_argument("--test-ratio", type=float, default=0.25, help="Fallback group-aware test split ratio.")
    parser.add_argument("--min-per-label-split", type=int, default=2, help="Minimum examples per label in each split.")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_split(pair_group: str, seed: str, test_ratio: float) -> str:
    digest = hashlib.sha256(f"{seed}:{pair_group}".encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) / 0xFFFFFFFF
    return "test" if bucket < test_ratio else "train"


def normalize_text(value: str) -> str:
    return " ".join(value.split())


def has_forbidden_shape(text: str) -> bool:
    return any(pattern.search(text) for pattern in FORBIDDEN_PATTERNS)


def read_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
            record["_lineNumber"] = line_number
            records.append(record)
    return records


def validate_records(records: list[dict[str, Any]], min_per_label_split: int) -> list[str]:
    errors: list[str] = []
    ids: set[str] = set()
    group_splits: dict[str, set[str]] = defaultdict(set)
    group_roles: dict[str, set[str]] = defaultdict(set)
    group_labels: dict[str, set[str]] = defaultdict(set)

    for record in records:
        line = record.get("_lineNumber", "?")
        record_id = record.get("id")
        label = record.get("label")
        text = record.get("text")
        pair_group = record.get("pairGroup")
        pair_role = record.get("pairRole")
        split = record.get("split")

        if not isinstance(record_id, str) or not record_id.strip():
            errors.append(f"line {line}: id is required")
        elif record_id in ids:
            errors.append(f"line {line}: duplicate id {record_id}")
        else:
            ids.add(record_id)

        if label not in LABELS:
            errors.append(f"line {line}: invalid label {label!r}")

        if not isinstance(text, str) or not normalize_text(text):
            errors.append(f"line {line}: text is required")
        elif has_forbidden_shape(text):
            errors.append(f"line {line}: text has a forbidden secret-like shape")

        if not isinstance(pair_group, str) or not pair_group.strip():
            errors.append(f"line {line}: pairGroup is required")
        else:
            if split in SPLITS:
                group_splits[pair_group].add(split)
            if pair_role in PAIR_ROLES:
                group_roles[pair_group].add(pair_role)
            if label in LABELS:
                group_labels[pair_group].add(label)

        if pair_role not in PAIR_ROLES:
            errors.append(f"line {line}: invalid pairRole {pair_role!r}")

        if split is not None and split not in SPLITS:
            errors.append(f"line {line}: invalid split {split!r}")

    for pair_group, splits in group_splits.items():
        if len(splits) > 1:
            errors.append(f"pairGroup {pair_group}: mixed explicit train/test split is not allowed")

    paired_groups = [
        pair_group
        for pair_group, roles in group_roles.items()
        if roles == PAIR_ROLES and len(group_labels[pair_group]) >= 2
    ]
    if len(paired_groups) < 8:
        errors.append("dataset must include at least 8 positive/negative pairGroups with multiple labels")

    split_counts: dict[str, Counter[str]] = {"train": Counter(), "test": Counter()}
    for record in records:
        split = record.get("_resolvedSplit")
        label = record.get("label")
        if split in SPLITS and label in LABELS:
            split_counts[split][label] += 1

    for split in ("train", "test"):
        for label in sorted(LABELS):
            if split_counts[split][label] < min_per_label_split:
                errors.append(
                    f"{split} split has {split_counts[split][label]} examples for {label}; "
                    f"minimum is {min_per_label_split}"
                )

    return errors


def assign_splits(records: list[dict[str, Any]], seed: str, test_ratio: float) -> None:
    explicit_by_group: dict[str, str] = {}
    for record in records:
        pair_group = str(record.get("pairGroup", ""))
        split = record.get("split")
        if split in SPLITS:
            explicit_by_group[pair_group] = split

    for record in records:
        pair_group = str(record.get("pairGroup", ""))
        record["_resolvedSplit"] = explicit_by_group.get(pair_group) or stable_split(pair_group, seed, test_ratio)


def fasttext_line(record: dict[str, Any]) -> str:
    label = record["label"]
    text = normalize_text(record["text"])
    return f"__label__{label} {text}"


def split_counts(records: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for split in ("train", "test"):
        counter = Counter(record["label"] for record in records if record.get("_resolvedSplit") == split)
        counts[split] = {label: counter.get(label, 0) for label in sorted(LABELS)}
        counts[split]["total"] = sum(counter.values())
    return counts


def main() -> int:
    args = parse_args()
    dataset = args.dataset.resolve()
    output_dir = args.output_dir.resolve()

    if not dataset.exists():
        print(f"dataset not found: {dataset}", file=sys.stderr)
        return 2
    if not 0.0 < args.test_ratio < 1.0:
        print("--test-ratio must be between 0 and 1", file=sys.stderr)
        return 2

    try:
        records = read_records(dataset)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    assign_splits(records, args.seed, args.test_ratio)
    errors = validate_records(records, args.min_per_label_split)
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    train_file = output_dir / "cacheability.train.txt"
    test_file = output_dir / "cacheability.test.txt"
    manifest_file = output_dir / "cacheability.dataset_manifest.json"

    by_split = {
        "train": [record for record in records if record["_resolvedSplit"] == "train"],
        "test": [record for record in records if record["_resolvedSplit"] == "test"],
    }

    train_file.write_text("\n".join(fasttext_line(record) for record in by_split["train"]) + "\n", encoding="utf-8")
    test_file.write_text("\n".join(fasttext_line(record) for record in by_split["test"]) + "\n", encoding="utf-8")

    paired_groups = sorted(
        {
            record["pairGroup"]
            for record in records
            if record.get("pairGroup")
        }
    )
    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": str(dataset),
        "datasetSha256": sha256_file(dataset),
        "labels": sorted(LABELS),
        "splitRule": {
            "groupField": "pairGroup",
            "explicitSplitField": "split",
            "fallback": "sha256(seed:pairGroup) bucket < testRatio",
            "seed": args.seed,
            "testRatio": args.test_ratio,
        },
        "counts": split_counts(records),
        "pairedGroupCount": len(paired_groups),
        "fastTextFiles": {
            "train": str(train_file),
            "test": str(test_file),
        },
    }
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
