#!/usr/bin/env python3
"""Create a KoAlpaca-RealQA cacheability relabeling review packet.

KoAlpaca-RealQA is gated on Hugging Face. Accept the dataset conditions first,
then provide HF_TOKEN, HUGGINGFACE_HUB_TOKEN, or HF_HUB_TOKEN for download.

The generated review files may contain real-user-style Korean prompts, so they
are written under build/ by default and should not be committed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parents[1]
DATASET_ID = "beomi/KoAlpaca-RealQA"
DEFAULT_SOURCE_URL = (
    "https://huggingface.co/datasets/beomi/KoAlpaca-RealQA/resolve/main/"
    "data/train-00000-of-00001.parquet"
)
DEFAULT_SOURCE_FILE = REPO_ROOT / ".tmp" / "koalpaca_realqa" / "train-00000-of-00001.parquet"
DEFAULT_OUTPUT_DIR = BASE_DIR / "build" / "koalpaca_realqa_review"

LABEL_PREFIX = "__label__"
LABELS = {
    "cacheable_static",
    "cacheable_policy",
    "dynamic_user_state",
    "unsafe_or_unknown",
}

SECRET_OR_PII_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{10,}", re.IGNORECASE),
    re.compile(r"(api[_ -]?key|token|authorization|bearer|password|비밀번호|토큰|인증키|액세스키)", re.IGNORECASE),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b\d{6}-\d{7}\b"),
    re.compile(r"\b\d{13,19}\b"),
]

UNSAFE_TERMS = [
    "api key",
    "apikey",
    "authorization",
    "bearer",
    "raw error",
    "raw response",
    "raw prompt",
    "secret",
    "token",
    "감지된 값",
    "그대로",
    "민감",
    "비밀번호",
    "사용자 식별",
    "시크릿",
    "원문",
    "인증키",
    "주민등록",
    "카드번호",
    "토큰",
    "프롬프트 조각",
]

DYNAMIC_TERMS = [
    "latest",
    "live",
    "now",
    "recent",
    "today",
    "tomorrow",
    "account",
    "balance",
    "calendar",
    "exchange rate",
    "inventory",
    "news",
    "order",
    "permission",
    "quota",
    "stock",
    "weather",
    "계정",
    "권한",
    "그저께",
    "금액",
    "날씨",
    "내 ",
    "내가",
    "내일",
    "뉴스",
    "방금",
    "배포",
    "상태",
    "오늘",
    "우리",
    "이번",
    "잔액",
    "재고",
    "주가",
    "주문",
    "지금",
    "최근",
    "캘린더",
    "쿼터",
    "환율",
    "확인",
    "현재",
]

DYNAMIC_STRONG_TERMS = [
    "latest",
    "live",
    "now",
    "recent",
    "today",
    "tomorrow",
    "그저께",
    "내일",
    "방금",
    "실시간",
    "오늘",
    "이번",
    "지금",
    "최근",
    "최신",
    "현재",
]

LIVE_DATA_TERMS = [
    "exchange rate",
    "inventory",
    "news",
    "stock",
    "weather",
    "날씨",
    "뉴스",
    "재고",
    "주가",
    "환율",
]

USER_STATE_TERMS = [
    "account",
    "balance",
    "calendar",
    "order",
    "permission",
    "quota",
    "계정",
    "권한",
    "금액",
    "잔액",
    "주문",
    "캘린더",
    "쿼터",
]

USER_SCOPE_TERMS = [
    "my ",
    "our ",
    "내 ",
    "내가",
    "우리",
]

POLICY_TERMS = [
    "boundary",
    "policy",
    "retention",
    "version",
    "규정",
    "기준",
    "버전",
    "약관",
    "정책",
]

STATIC_TERMS = [
    "concept",
    "define",
    "definition",
    "difference",
    "explain",
    "meaning",
    "overview",
    "tutorial",
    "개념",
    "뜻",
    "방법",
    "설명",
    "예시",
    "요약",
    "의미",
    "일반",
    "정의",
    "차이",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-file", type=Path, default=DEFAULT_SOURCE_FILE)
    parser.add_argument("--source-url", default=DEFAULT_SOURCE_URL)
    parser.add_argument("--download", action="store_true", help="Download the gated HF parquet file.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--sample-per-label", type=int, default=200)
    parser.add_argument("--max-rows", type=int, help="Optional cap for quick local experiments.")
    return parser.parse_args()


def normalize_text(value: str) -> str:
    return " ".join(value.split())


def stable_id(text: str, source_id: str) -> str:
    digest = hashlib.sha256(f"{source_id}\0{text}".encode("utf-8")).hexdigest()
    return f"koalpaca-realqa-{digest[:16]}"


def stable_sort_key(row: dict[str, Any]) -> str:
    return hashlib.sha256(f"{row['suggestedLabel']}\0{row['question']}".encode("utf-8")).hexdigest()


def hf_token() -> str | None:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or os.environ.get("HF_HUB_TOKEN")


def download_if_needed(source_file: Path, source_url: str, should_download: bool) -> None:
    if source_file.exists():
        return
    if not should_download:
        raise SystemExit(f"source file not found: {source_file}. Pass --download after accepting HF dataset access.")
    token = hf_token()
    if not token:
        raise SystemExit("HF token not found. Set HF_TOKEN after accepting access to beomi/KoAlpaca-RealQA.")
    source_file.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(source_url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request) as response, source_file.open("wb") as handle:
        handle.write(response.read())


def require_pyarrow() -> Any:
    try:
        import pyarrow.parquet as parquet  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "pyarrow is required to read the KoAlpaca-RealQA parquet file. "
            "Install it in the tooling venv, for example: "
            ".tmp\\semantic-cache-fasttext-venv\\Scripts\\python.exe -m pip install pyarrow"
        ) from exc
    return parquet


def read_source_rows(source_file: Path, max_rows: int | None) -> list[dict[str, Any]]:
    suffix = source_file.suffix.lower()
    if suffix == ".jsonl":
        return read_jsonl_rows(source_file, max_rows)
    if suffix != ".parquet":
        raise SystemExit(f"unsupported source file type: {source_file.suffix}; expected .parquet or .jsonl")

    parquet = require_pyarrow()
    table = parquet.read_table(source_file, columns=["custom_id", "question", "answer"])
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(table.to_pylist()):
        question = normalize_text(str(item.get("question", "")))
        if not question:
            continue
        source_id = normalize_text(str(item.get("custom_id", ""))) or str(index)
        rows.append(
            {
                "id": stable_id(question, source_id),
                "source": "koalpaca_realqa",
                "sourceId": source_id,
                "question": question,
            }
        )
        if max_rows and len(rows) >= max_rows:
            break
    return rows


def read_jsonl_rows(source_file: Path, max_rows: int | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with source_file.open("r", encoding="utf-8-sig") as handle:
        for index, line in enumerate(handle):
            if not line.strip():
                continue
            item = json.loads(line)
            question = normalize_text(str(item.get("question") or item.get("text") or item.get("instruction") or ""))
            if not question:
                continue
            source_id = normalize_text(str(item.get("custom_id") or item.get("id") or index))
            rows.append(
                {
                    "id": stable_id(question, source_id),
                    "source": "koalpaca_realqa",
                    "sourceId": source_id,
                    "question": question,
                }
            )
            if max_rows and len(rows) >= max_rows:
                break
    return rows


def contains_any(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    return any(term.lower() in lowered for term in terms)


def has_secret_or_pii_shape(text: str) -> bool:
    return any(pattern.search(text) for pattern in SECRET_OR_PII_PATTERNS)


def has_dynamic_signal(question: str, has_static_signal: bool) -> bool:
    if contains_any(question, DYNAMIC_STRONG_TERMS):
        return True
    if contains_any(question, USER_SCOPE_TERMS) and contains_any(question, USER_STATE_TERMS):
        return True
    if contains_any(question, LIVE_DATA_TERMS) and not has_static_signal:
        return True
    return contains_any(question, DYNAMIC_TERMS) and not has_static_signal


def suggest_label(question: str) -> dict[str, str]:
    has_static_signal = contains_any(question, STATIC_TERMS)
    if has_secret_or_pii_shape(question) or contains_any(question, UNSAFE_TERMS):
        return {
            "suggestedLabel": "unsafe_or_unknown",
            "mapConfidence": "high",
            "reviewStatus": "review_required",
            "reason": "Secret/PII/raw-context shape or unsafe term detected. Fail closed until reviewed.",
        }
    if has_dynamic_signal(question, has_static_signal):
        return {
            "suggestedLabel": "dynamic_user_state",
            "mapConfidence": "medium",
            "reviewStatus": "review_required",
            "reason": "Question appears time-sensitive, live-data dependent, user-specific, or boundary-dependent.",
        }
    if contains_any(question, POLICY_TERMS):
        return {
            "suggestedLabel": "cacheable_policy",
            "mapConfidence": "low",
            "reviewStatus": "review_required",
            "reason": "Policy-like wording detected, but store eligibility needs verified policy/version/hash boundary.",
        }
    if has_static_signal:
        return {
            "suggestedLabel": "cacheable_static",
            "mapConfidence": "medium",
            "reviewStatus": "review_required",
            "reason": "Question looks like a reusable concept, explanation, definition, or tutorial request.",
        }
    return {
        "suggestedLabel": "unsafe_or_unknown",
        "mapConfidence": "low",
        "reviewStatus": "review_required",
        "reason": "No strong cacheable signal. Fail closed until reviewed.",
    }


def attach_suggestions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for row in rows:
        suggestion = suggest_label(row["question"])
        enriched.append(
            {
                **row,
                **suggestion,
                "finalLabel": "",
                "reviewerNotes": "",
            }
        )
    return enriched


def make_review_sample(rows: list[dict[str, Any]], sample_per_label: int) -> list[dict[str, Any]]:
    by_label: dict[str, list[dict[str, Any]]] = {label: [] for label in sorted(LABELS)}
    for row in rows:
        by_label[row["suggestedLabel"]].append(row)

    sample: list[dict[str, Any]] = []
    for label in sorted(by_label):
        sample.extend(sorted(by_label[label], key=stable_sort_key)[:sample_per_label])
    return sample


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "id",
        "sourceId",
        "question",
        "suggestedLabel",
        "mapConfidence",
        "reason",
        "finalLabel",
        "reviewerNotes",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def summarize(rows: list[dict[str, Any]], sample_rows: list[dict[str, Any]], source_file: Path) -> dict[str, Any]:
    suggested_counts = Counter(row["suggestedLabel"] for row in rows)
    confidence_counts = Counter(row["mapConfidence"] for row in rows)
    secret_shape_count = sum(1 for row in rows if has_secret_or_pii_shape(row["question"]))
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": "KoAlpaca-RealQA",
            "datasetId": DATASET_ID,
            "file": str(source_file),
            "url": DEFAULT_SOURCE_URL,
            "license": "CC-BY-SA-4.0",
            "citation": "KoAlpaca-RealQA: A Korean Instruction Dataset Reflecting Real User Scenarios.",
        },
        "totalRows": len(rows),
        "reviewSampleRows": len(sample_rows),
        "suggestedLabelCounts": dict(sorted(suggested_counts.items())),
        "mapConfidenceCounts": dict(sorted(confidence_counts.items())),
        "secretOrPiiShapeCount": secret_shape_count,
        "reviewPolicy": "All suggested labels are draft labels and must be manually reviewed before use as training data.",
        "commitPolicy": "Do not commit raw KoAlpaca-RealQA review outputs unless attribution/license and privacy review are complete.",
    }


def main() -> int:
    args = parse_args()
    if args.sample_per_label < 1:
        raise SystemExit("--sample-per-label must be at least 1")

    source_file = args.source_file.resolve()
    output_dir = args.output_dir.resolve()
    download_if_needed(source_file, args.source_url, args.download)

    rows = attach_suggestions(read_source_rows(source_file, args.max_rows))
    sample_rows = make_review_sample(rows, args.sample_per_label)
    summary = summarize(rows, sample_rows, source_file)

    write_json(output_dir / "koalpaca_realqa_summary.json", summary)
    write_jsonl(output_dir / "cacheability_koalpaca_realqa_relabel_draft.jsonl", rows)
    write_csv(output_dir / "koalpaca_realqa_review_sample.csv", sample_rows)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
