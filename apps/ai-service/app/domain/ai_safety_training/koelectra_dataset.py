from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from string import Formatter
from typing import Any, Iterable

from app.domain.ai_safety_eval.master_corpus import MasterEvalCase


DATASET_SCHEMA_VERSION = "gatelm.pii-ner-training.v1"
MANIFEST_SCHEMA_VERSION = "gatelm.pii-ner-training-manifest.v1"
SPLITS = ("train", "validation", "holdout")
TRAIN_PERCENT = 80
VALIDATION_PERCENT = 10
MAX_NEGATIVE_TO_POSITIVE_RATIO = 2
TARGET_LABEL_BY_DETECTOR_TYPE = {
    "email": "EMA",
    "organization_name": "ORG",
    "person_name": "PER",
    "phone_number": "PHN",
    "postal_address": "ADDR",
    "resident_registration_number": "RRN",
}
PATTERN_TAG_PREFIX = "pattern-"
PLACEHOLDER_SENTINEL_PATTERN = re.compile(r"\{SYNTHETIC_[A-Z0-9_]+\}")


@dataclass(frozen=True)
class TrainingSpan:
    start: int
    end: int
    label: str

    def to_dict(self) -> dict[str, object]:
        return {"start": self.start, "end": self.end, "label": self.label}


@dataclass(frozen=True)
class TrainingRecord:
    case_id: str
    split: str
    locale: str
    group_id: str
    text: str
    spans: tuple[TrainingSpan, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": DATASET_SCHEMA_VERSION,
            "caseId": self.case_id,
            "split": self.split,
            "locale": self.locale,
            "groupId": self.group_id,
            "syntheticOnly": True,
            "text": self.text,
            "spans": [span.to_dict() for span in self.spans],
        }


SYNTHETIC_VALUES_BY_DETECTOR_TYPE: dict[str, tuple[str, ...]] = {
    "email": (
        "alpha.user@example.test",
        "beta-team@example.test",
        "gamma.notice@example.test",
        "delta.ops@example.test",
        "epsilon.review@example.test",
        "zeta.owner@example.test",
    ),
    "organization_name": (
        "가람테크",
        "나래연구소",
        "다온물류",
        "라온대학교",
        "마루소프트",
        "바른데이터",
        "Synthetic Labs",
        "Example Research",
    ),
    "person_name": (
        "김가온",
        "이나래",
        "박다온",
        "최라온",
        "정마루",
        "한바름",
        "Alex Kim",
        "Jamie Park",
    ),
    "phone_number": (
        "010-0000-0001",
        "010-0000-0002",
        "010-0000-0003",
        "010-0000-0004",
        "010-0000-0005",
        "+82-10-0000-0006",
    ),
    "postal_address": (
        "가람시 나래구 다온로 12",
        "나래시 다온구 라온길 24",
        "다온시 라온구 마루로 36",
        "라온시 마루구 바름길 48",
        "마루시 바름구 가온로 60",
        "Synthetic District 72",
    ),
    "resident_registration_number": (
        "900101-1000001",
        "900101-2000002",
        "010101-3000003",
        "010101-4000004",
        "050505-5000005",
        "050505-6000006",
    ),
}


def build_training_dataset(
    cases: Iterable[MasterEvalCase],
) -> dict[str, list[TrainingRecord]]:
    all_records = [training_record_from_case(case) for case in cases]
    selected: dict[str, list[TrainingRecord]] = {split: [] for split in SPLITS}
    for split in SPLITS:
        split_records = [record for record in all_records if record.split == split]
        positives = [record for record in split_records if record.spans]
        negatives = [record for record in split_records if not record.spans]
        negative_limit = len(positives) * MAX_NEGATIVE_TO_POSITIVE_RATIO
        ranked_negatives = sorted(
            negatives,
            key=lambda record: stable_digest(f"negative:{record.case_id}"),
        )
        selected[split] = sorted(
            [*positives, *ranked_negatives[:negative_limit]],
            key=lambda record: record.case_id,
        )
    validate_training_dataset(selected)
    return selected


def training_record_from_case(case: MasterEvalCase) -> TrainingRecord:
    split = split_for_case(case)
    group_id = group_id_for_case(case)
    rendered_parts: list[str] = []
    spans: list[TrainingSpan] = []
    rendered_length = 0
    formatter = Formatter()
    for literal_text, field_name, format_spec, conversion in formatter.parse(
        case.input_template
    ):
        if format_spec or conversion:
            raise ValueError(f"{case.case_id}: formatted placeholders are not supported")
        rendered_parts.append(literal_text)
        rendered_length += len(literal_text)
        if field_name is None:
            continue
        detector_type = case.placeholder_bindings[field_name]
        value = synthetic_value_for_case(case.case_id, field_name, detector_type)
        value_start = rendered_length
        rendered_parts.append(value)
        rendered_length += len(value)
        label = TARGET_LABEL_BY_DETECTOR_TYPE.get(detector_type)
        if label is not None:
            spans.append(TrainingSpan(value_start, rendered_length, label))

    record = TrainingRecord(
        case_id=case.case_id,
        split=split,
        locale=case.locale,
        group_id=group_id,
        text="".join(rendered_parts),
        spans=tuple(sorted(spans, key=lambda span: (span.start, span.end, span.label))),
    )
    validate_training_record(record)
    return record


def split_for_case(case: MasterEvalCase) -> str:
    bucket = int(stable_digest(f"split:{group_id_for_case(case)}")[:8], 16) % 100
    if bucket < TRAIN_PERCENT:
        return "train"
    if bucket < TRAIN_PERCENT + VALIDATION_PERCENT:
        return "validation"
    return "holdout"


def group_id_for_case(case: MasterEvalCase) -> str:
    pattern_tags = sorted(tag for tag in case.tags if tag.startswith(PATTERN_TAG_PREFIX))
    if pattern_tags:
        source = "|".join(pattern_tags)
    else:
        normalized_template = PLACEHOLDER_SENTINEL_PATTERN.sub(
            "{SYNTHETIC_ENTITY}",
            case.input_template,
        )
        source = f"{case.locale}|{normalized_template}"
    return stable_digest(source)[:16]


def synthetic_value_for_case(
    case_id: str,
    placeholder: str,
    detector_type: str,
) -> str:
    values = SYNTHETIC_VALUES_BY_DETECTOR_TYPE.get(detector_type)
    if values is None:
        return f"SYNTHETIC_{detector_type.upper()}_VALUE"
    index = int(stable_digest(f"value:{case_id}:{placeholder}")[:8], 16) % len(values)
    return values[index]


def validate_training_dataset(dataset: dict[str, list[TrainingRecord]]) -> None:
    if set(dataset) != set(SPLITS):
        raise ValueError("training dataset split set mismatch")
    case_ids: set[str] = set()
    groups_by_split: dict[str, set[str]] = {}
    labels_by_split: dict[str, set[str]] = {}
    for split in SPLITS:
        records = dataset[split]
        if not records:
            raise ValueError(f"training dataset split {split!r} is empty")
        groups_by_split[split] = {record.group_id for record in records}
        labels_by_split[split] = {span.label for record in records for span in record.spans}
        for record in records:
            validate_training_record(record)
            if record.split != split:
                raise ValueError(f"{record.case_id}: split field mismatch")
            if record.case_id in case_ids:
                raise ValueError(f"duplicate training case id {record.case_id!r}")
            case_ids.add(record.case_id)
    for index, split in enumerate(SPLITS):
        for other_split in SPLITS[index + 1 :]:
            if groups_by_split[split].intersection(groups_by_split[other_split]):
                raise ValueError("training group leaked across dataset splits")
    required_labels = set(TARGET_LABEL_BY_DETECTOR_TYPE.values())
    for split, labels in labels_by_split.items():
        missing = sorted(required_labels - labels)
        if missing:
            raise ValueError(f"training split {split!r} is missing labels {missing!r}")


def validate_training_record(record: TrainingRecord) -> None:
    if record.split not in SPLITS:
        raise ValueError(f"{record.case_id}: invalid split")
    if not record.text:
        raise ValueError(f"{record.case_id}: empty training text")
    previous_end = 0
    allowed_labels = set(TARGET_LABEL_BY_DETECTOR_TYPE.values())
    for span in record.spans:
        if span.label not in allowed_labels:
            raise ValueError(f"{record.case_id}: invalid training label")
        if span.start < previous_end or span.end <= span.start or span.end > len(record.text):
            raise ValueError(f"{record.case_id}: invalid or overlapping training span")
        previous_end = span.end


def build_training_manifest(
    dataset: dict[str, list[TrainingRecord]],
    *,
    source_corpus_path: Path,
    data_file_digests: dict[str, str],
) -> dict[str, Any]:
    validate_training_dataset(dataset)
    split_summaries: dict[str, object] = {}
    for split in SPLITS:
        records = dataset[split]
        label_counts = Counter(span.label for record in records for span in record.spans)
        split_summaries[split] = {
            "recordCount": len(records),
            "positiveRecordCount": sum(bool(record.spans) for record in records),
            "negativeRecordCount": sum(not record.spans for record in records),
            "groupCount": len({record.group_id for record in records}),
            "spanCountsByLabel": dict(sorted(label_counts.items())),
            "caseIds": [record.case_id for record in records],
            "dataFileSha256": data_file_digests[split],
        }
    return {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "syntheticOnly": True,
        "trainingEligible": True,
        "customerPromptUsed": False,
        "rawTextIncludedInManifest": False,
        "rawTextStoredInTrainingFiles": True,
        "splitPolicy": {
            "groupedByPattern": True,
            "trainPercent": TRAIN_PERCENT,
            "validationPercent": VALIDATION_PERCENT,
            "holdoutPercent": 100 - TRAIN_PERCENT - VALIDATION_PERCENT,
            "maxNegativeToPositiveRatio": MAX_NEGATIVE_TO_POSITIVE_RATIO,
        },
        "targetLabels": dict(sorted(TARGET_LABEL_BY_DETECTOR_TYPE.items())),
        "sourceCorpus": {
            "path": source_corpus_path.name,
            "sha256": sha256_file(source_corpus_path),
        },
        "splits": split_summaries,
    }


def serialize_training_records(records: Iterable[TrainingRecord]) -> str:
    return "".join(
        json.dumps(record.to_dict(), ensure_ascii=False, sort_keys=True) + "\n"
        for record in records
    )


def stable_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
