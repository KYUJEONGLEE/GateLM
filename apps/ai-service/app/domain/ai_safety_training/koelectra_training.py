from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from app.domain.ai_safety_training.koelectra_dataset import (
    DATASET_SCHEMA_VERSION,
    MANIFEST_SCHEMA_VERSION,
    SPLITS,
)


ENTITY_LABELS = ("ADDR", "EMA", "ORG", "PER", "PHN", "RRN")
BIO_LABELS = ("O",) + tuple(
    label for entity in ENTITY_LABELS for label in (f"B-{entity}", f"I-{entity}")
)
IGNORE_LABEL_ID = -100
TRAINING_REPORT_VERSION = "gatelm.pii-ner-training-report.v1"


def label_maps() -> tuple[dict[str, int], dict[int, str]]:
    label_to_id = {label: index for index, label in enumerate(BIO_LABELS)}
    return label_to_id, {index: label for label, index in label_to_id.items()}


def load_and_verify_dataset(
    dataset_dir: Path,
    *,
    include_splits: Sequence[str] = ("train", "validation"),
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    manifest_path = dataset_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != MANIFEST_SCHEMA_VERSION:
        raise ValueError("PII NER training manifest version mismatch")
    if manifest.get("syntheticOnly") is not True or manifest.get("customerPromptUsed") is not False:
        raise ValueError("PII NER training dataset must be synthetic-only")
    requested = tuple(dict.fromkeys(include_splits))
    if not requested or any(split not in SPLITS for split in requested):
        raise ValueError("invalid PII NER training split selection")

    loaded: dict[str, list[dict[str, Any]]] = {}
    for split in requested:
        path = dataset_dir / f"{split}.jsonl"
        serialized = path.read_text(encoding="utf-8")
        expected_digest = manifest["splits"][split]["dataFileSha256"]
        actual_digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        if actual_digest != expected_digest:
            raise ValueError(f"PII NER training split {split!r} checksum mismatch")
        records = [json.loads(line) for line in serialized.splitlines() if line.strip()]
        expected_count = manifest["splits"][split]["recordCount"]
        if len(records) != expected_count:
            raise ValueError(f"PII NER training split {split!r} count mismatch")
        for record in records:
            validate_serialized_record(record, expected_split=split)
        loaded[split] = records
    return loaded, manifest


def validate_serialized_record(record: Mapping[str, Any], *, expected_split: str) -> None:
    if record.get("schemaVersion") != DATASET_SCHEMA_VERSION:
        raise ValueError("PII NER training record version mismatch")
    if record.get("split") != expected_split or record.get("syntheticOnly") is not True:
        raise ValueError("PII NER training record split or provenance mismatch")
    case_id = record.get("caseId")
    text = record.get("text")
    spans = record.get("spans")
    if not isinstance(case_id, str) or not case_id:
        raise ValueError("PII NER training record case id is invalid")
    if not isinstance(text, str) or not text:
        raise ValueError(f"{case_id}: PII NER training text is invalid")
    if not isinstance(spans, list):
        raise ValueError(f"{case_id}: PII NER training spans are invalid")
    previous_end = 0
    for span in spans:
        if not isinstance(span, dict) or set(span) != {"start", "end", "label"}:
            raise ValueError(f"{case_id}: PII NER training span fields mismatch")
        start, end, label = span["start"], span["end"], span["label"]
        if (
            not isinstance(start, int)
            or not isinstance(end, int)
            or start < previous_end
            or end <= start
            or end > len(text)
            or label not in ENTITY_LABELS
        ):
            raise ValueError(f"{case_id}: PII NER training span is invalid")
        previous_end = end


def align_bio_label_ids(
    offsets: Iterable[Sequence[int]],
    spans: Sequence[Mapping[str, Any]],
    label_to_id: Mapping[str, int],
) -> list[int]:
    aligned: list[int] = []
    active_span_index: int | None = None
    for raw_offset in offsets:
        start, end = int(raw_offset[0]), int(raw_offset[1])
        if end <= start:
            aligned.append(IGNORE_LABEL_ID)
            active_span_index = None
            continue
        matching_index = next(
            (
                index
                for index, span in enumerate(spans)
                if start < int(span["end"]) and end > int(span["start"])
            ),
            None,
        )
        if matching_index is None:
            aligned.append(label_to_id["O"])
            active_span_index = None
            continue
        label = str(spans[matching_index]["label"])
        marker = "I" if active_span_index == matching_index else "B"
        aligned.append(label_to_id[f"{marker}-{label}"])
        active_span_index = matching_index
    return aligned


def entity_chunks(
    label_ids: Sequence[int],
    id_to_label: Mapping[int, str],
) -> set[tuple[str, int, int]]:
    chunks: set[tuple[str, int, int]] = set()
    current_entity: str | None = None
    current_start: int | None = None

    def flush(end_index: int) -> None:
        nonlocal current_entity, current_start
        if current_entity is not None and current_start is not None:
            chunks.add((current_entity, current_start, end_index))
        current_entity = None
        current_start = None

    for index, label_id in enumerate(label_ids):
        label = id_to_label.get(int(label_id), "O")
        if label == "O" or label_id == IGNORE_LABEL_ID:
            flush(index)
            continue
        marker, separator, entity = label.partition("-")
        if separator == "" or entity not in ENTITY_LABELS:
            flush(index)
            continue
        if marker == "B" or current_entity != entity:
            flush(index)
            current_entity = entity
            current_start = index
    flush(len(label_ids))
    return chunks


def span_metric_report(
    expected_chunks: Iterable[set[tuple[str, int, int]]],
    actual_chunks: Iterable[set[tuple[str, int, int]]],
) -> dict[str, Any]:
    totals = Counter(tp=0, fp=0, fn=0)
    by_entity = {entity: Counter(tp=0, fp=0, fn=0) for entity in ENTITY_LABELS}
    for expected, actual in zip(expected_chunks, actual_chunks, strict=True):
        true_positive = expected.intersection(actual)
        false_positive = actual - expected
        false_negative = expected - actual
        totals.update(tp=len(true_positive), fp=len(false_positive), fn=len(false_negative))
        for entity, _, _ in true_positive:
            by_entity[entity]["tp"] += 1
        for entity, _, _ in false_positive:
            by_entity[entity]["fp"] += 1
        for entity, _, _ in false_negative:
            by_entity[entity]["fn"] += 1
    return {
        "micro": metrics_from_counts(totals),
        "byEntity": {
            entity: metrics_from_counts(counts)
            for entity, counts in by_entity.items()
        },
    }


def exact_span_metric_report(
    expected_spans: Iterable[set[tuple[str, int, int]]],
    actual_spans: Iterable[set[tuple[str, int, int]]],
    *,
    entity_types: Sequence[str],
) -> dict[str, Any]:
    totals = Counter(tp=0, fp=0, fn=0)
    by_entity = {entity: Counter(tp=0, fp=0, fn=0) for entity in entity_types}
    for expected, actual in zip(expected_spans, actual_spans, strict=True):
        true_positive = expected.intersection(actual)
        false_positive = actual - expected
        false_negative = expected - actual
        totals.update(tp=len(true_positive), fp=len(false_positive), fn=len(false_negative))
        for entity, _, _ in true_positive:
            if entity in by_entity:
                by_entity[entity]["tp"] += 1
        for entity, _, _ in false_positive:
            if entity in by_entity:
                by_entity[entity]["fp"] += 1
        for entity, _, _ in false_negative:
            if entity in by_entity:
                by_entity[entity]["fn"] += 1
    return {
        "micro": metrics_from_counts(totals),
        "byEntity": {
            entity: metrics_from_counts(counts)
            for entity, counts in by_entity.items()
        },
    }


def metrics_from_counts(counts: Mapping[str, int]) -> dict[str, int | float | None]:
    tp = int(counts.get("tp", 0))
    fp = int(counts.get("fp", 0))
    fn = int(counts.get("fn", 0))
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision is not None and recall is not None and precision + recall
        else None
    )
    return {
        "truePositive": tp,
        "falsePositive": fp,
        "falseNegative": fn,
        "precision": round(precision, 6) if precision is not None else None,
        "recall": round(recall, 6) if recall is not None else None,
        "f1": round(f1, 6) if f1 is not None else None,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
