#!/usr/bin/env python3
"""Create an AI Hub Korean Dialogue cacheability relabeling review packet.

The AI Hub dataset must be downloaded by an approved user. Pass the downloaded
ZIP file or extracted directory with --source-path.

Generated review files may contain Korean dialogue text, so they are written
under build/ by default and should not be committed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parents[1]
DEFAULT_SOURCE_PATH = REPO_ROOT / ".tmp" / "aihub_korean_dialogue"
DEFAULT_OUTPUT_DIR = BASE_DIR / "build" / "aihub_korean_dialogue_review"

DATASET_ID = "AIHub Korean Dialogue"
DATASET_URL = "https://aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&aihubDataSe=data&dataSetSn=116"

LABELS = {
    "cacheable_static",
    "cacheable_policy",
    "dynamic_user_state",
    "unsafe_or_unknown",
}

USER_UTTERANCE_KEYS = {
    "main question",
    "main_question",
    "mainquestion",
    "question",
    "q",
    "query",
    "utterance",
    "user answer",
    "user_answer",
    "useranswer",
    "user utterance",
    "user_utterance",
    "고객질문",
    "고객 질문",
    "메인질문",
    "메인 질문",
    "발화",
    "사용자",
    "사용자답변",
    "사용자 답변",
    "사용자발화",
    "손님질문",
    "손님 질문",
    "질문",
}

ANSWER_OR_SYSTEM_KEYS = {
    "answer",
    "a",
    "response",
    "system answer",
    "system_answer",
    "systemanswer",
    "sub question",
    "sub_question",
    "subquestion",
    "답변",
    "서브질문",
    "서브 질문",
    "시스템",
    "시스템답변",
    "시스템 답변",
    "응답",
    "점원",
}

TEXT_KEY_HINTS = {
    "question",
    "utterance",
    "query",
    "user",
    "고객",
    "메인",
    "발화",
    "사용자",
    "손님",
    "질문",
}

INTENT_KEYS = {
    "intent",
    "main intent",
    "main_intent",
    "mainintent",
    "sub intent",
    "sub_intent",
    "subintent",
    "대분류",
    "메인의도",
    "메인 의도",
    "서브의도",
    "서브 의도",
    "소분류",
    "의도",
    "인텐트",
}

SECRET_OR_PII_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{10,}", re.IGNORECASE),
    re.compile(r"(api[_ -]?key|token|authorization|bearer|password|비밀번호|토큰|인증키|액세스키)", re.IGNORECASE),
    re.compile(r"\b\d{2,3}-\d{3,4}-\d{4}\b"),
    re.compile(r"\b\d{6}-\d{7}\b"),
    re.compile(r"\b\d{13,19}\b"),
]

UNSAFE_TERMS = [
    "api key",
    "raw error",
    "raw response",
    "secret",
    "token",
    "개인정보",
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
    "대기",
    "민원상태",
    "배송",
    "예약",
    "영업시간",
    "위치",
    "재고",
    "주가",
    "처리상태",
    "환율",
]

USER_STATE_TERMS = [
    "account",
    "balance",
    "calendar",
    "order",
    "permission",
    "계정",
    "권한",
    "금액",
    "내역",
    "민원",
    "신청",
    "예약",
    "잔액",
    "접수",
    "주문",
    "처리",
]

USER_SCOPE_TERMS = [
    "my ",
    "our ",
    "내 ",
    "제가",
    "저는",
    "우리",
]

POLICY_TERMS = [
    "policy",
    "rule",
    "version",
    "규정",
    "기준",
    "법",
    "방법",
    "버전",
    "약관",
    "요건",
    "절차",
    "정책",
    "제도",
]

STATIC_TERMS = [
    "concept",
    "definition",
    "difference",
    "explain",
    "overview",
    "개념",
    "뜻",
    "무엇",
    "설명",
    "안내",
    "예시",
    "요약",
    "의미",
    "일반",
    "정의",
    "차이",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-path", type=Path, default=DEFAULT_SOURCE_PATH, help="Downloaded ZIP, extracted directory, or single JSON/CSV file.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--sample-per-label", type=int, default=200)
    parser.add_argument("--max-rows", type=int, help="Optional cap for quick local experiments.")
    parser.add_argument("--include-system", action="store_true", help="Also extract likely system/answer text. Off by default.")
    return parser.parse_args()


def normalize_key(value: str) -> str:
    return re.sub(r"[\s_\-(){}\[\].:]+", " ", str(value).strip().lower()).strip()


def compact_key(value: str) -> str:
    return re.sub(r"[\s_\-(){}\[\].:]+", "", str(value).strip().lower())


def normalize_text(value: str) -> str:
    return " ".join(str(value).split())


def contains_any(text: str, terms: Iterable[str]) -> bool:
    lowered = text.lower()
    return any(term.lower() in lowered for term in terms)


def has_secret_or_pii_shape(text: str) -> bool:
    return any(pattern.search(text) for pattern in SECRET_OR_PII_PATTERNS)


def likely_user_key(key: str) -> bool:
    normalized = normalize_key(key)
    compact = compact_key(key)
    return normalized in USER_UTTERANCE_KEYS or compact in {compact_key(item) for item in USER_UTTERANCE_KEYS}


def likely_answer_key(key: str) -> bool:
    normalized = normalize_key(key)
    compact = compact_key(key)
    return normalized in ANSWER_OR_SYSTEM_KEYS or compact in {compact_key(item) for item in ANSWER_OR_SYSTEM_KEYS}


def key_has_text_hint(key: str) -> bool:
    normalized = normalize_key(key)
    compact = compact_key(key)
    return any(hint in normalized or compact_key(hint) in compact for hint in TEXT_KEY_HINTS)


def likely_intent_key(key: str) -> bool:
    normalized = normalize_key(key)
    compact = compact_key(key)
    return normalized in INTENT_KEYS or compact in {compact_key(item) for item in INTENT_KEYS}


def stable_id(source_file: str, text: str, source_index: str) -> str:
    digest = hashlib.sha256(f"{source_file}\0{source_index}\0{text}".encode("utf-8")).hexdigest()
    return f"aihub-kor-dialogue-{digest[:16]}"


def stable_sort_key(row: dict[str, Any]) -> str:
    return hashlib.sha256(f"{row['suggestedLabel']}\0{row['text']}".encode("utf-8")).hexdigest()


def iter_input_files(source_path: Path) -> Iterable[tuple[str, bytes]]:
    if source_path.is_dir():
        for path in sorted(source_path.rglob("*")):
            if path.is_file() and path.suffix.lower() in {".json", ".jsonl", ".csv", ".tsv", ".zip"}:
                yield from iter_input_files(path)
        return
    if not source_path.exists():
        raise SystemExit(f"source path not found: {source_path}")
    if source_path.suffix.lower() == ".zip":
        with zipfile.ZipFile(source_path) as archive:
            for name in sorted(archive.namelist()):
                suffix = Path(name).suffix.lower()
                if suffix in {".json", ".jsonl", ".csv", ".tsv"} and not name.endswith("/"):
                    yield name, archive.read(name)
        return
    if source_path.suffix.lower() in {".json", ".jsonl", ".csv", ".tsv"}:
        yield str(source_path), source_path.read_bytes()
        return
    raise SystemExit(f"unsupported source path: {source_path}")


def decode_text(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def read_json_rows(source_name: str, text: str, include_system: bool) -> list[dict[str, Any]]:
    payload = json.loads(text)
    rows: list[dict[str, Any]] = []
    walk_json(payload, source_name, "$", {}, include_system, rows)
    return rows


def walk_json(value: Any, source_name: str, path: str, context: dict[str, str], include_system: bool, rows: list[dict[str, Any]]) -> None:
    if isinstance(value, dict):
        next_context = dict(context)
        for key, item in value.items():
            if isinstance(item, str) and likely_intent_key(key):
                next_context[normalize_key(key)] = normalize_text(item)
        for key, item in value.items():
            if isinstance(item, str):
                text = normalize_text(item)
                if not text or len(text) < 2:
                    continue
                role = candidate_role(key, include_system)
                if role:
                    rows.append(make_source_row(source_name, f"{path}.{key}", text, role, next_context))
            elif isinstance(item, (dict, list)):
                walk_json(item, source_name, f"{path}.{key}", next_context, include_system, rows)
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            walk_json(item, source_name, f"{path}[{index}]", context, include_system, rows)


def candidate_role(key: str, include_system: bool) -> str:
    if likely_intent_key(key):
        return ""
    if likely_user_key(key):
        return "user"
    if likely_answer_key(key):
        return "system" if include_system else ""
    if key_has_text_hint(key) and not likely_answer_key(key):
        return "user"
    return ""


def read_delimited_rows(source_name: str, text: str, delimiter: str, include_system: bool) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    for index, row in enumerate(reader, start=1):
        context = {
            normalize_key(key): normalize_text(value)
            for key, value in row.items()
            if value and likely_intent_key(key)
        }
        for key, value in row.items():
            if value is None:
                continue
            candidate = normalize_text(value)
            if not candidate or len(candidate) < 2:
                continue
            role = candidate_role(key, include_system)
            if role:
                rows.append(make_source_row(source_name, f"row{index}.{key}", candidate, role, context))
    return rows


def read_jsonl_rows(source_name: str, text: str, include_system: bool) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        payload = json.loads(line)
        walk_json(payload, source_name, f"${index}", {}, include_system, rows)
    return rows


def make_source_row(source_name: str, source_index: str, text: str, role: str, context: dict[str, str]) -> dict[str, Any]:
    return {
        "id": stable_id(source_name, text, source_index),
        "source": "aihub_korean_dialogue",
        "sourceFile": source_name,
        "sourceIndex": source_index,
        "speakerRole": role,
        "text": text,
        "intentHints": "; ".join(f"{key}={value}" for key, value in sorted(context.items()) if value),
    }


def load_rows(source_path: Path, include_system: bool, max_rows: int | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source_name, raw in iter_input_files(source_path):
        suffix = Path(source_name).suffix.lower()
        text = decode_text(raw)
        if suffix == ".json":
            file_rows = read_json_rows(source_name, text, include_system)
        elif suffix == ".jsonl":
            file_rows = read_jsonl_rows(source_name, text, include_system)
        elif suffix == ".csv":
            file_rows = read_delimited_rows(source_name, text, ",", include_system)
        elif suffix == ".tsv":
            file_rows = read_delimited_rows(source_name, text, "\t", include_system)
        else:
            continue
        for row in file_rows:
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            rows.append(row)
            if max_rows and len(rows) >= max_rows:
                return rows
    return rows


def has_static_signal(text: str) -> bool:
    return contains_any(text, STATIC_TERMS)


def has_dynamic_signal(text: str, static_signal: bool) -> bool:
    if contains_any(text, DYNAMIC_STRONG_TERMS):
        return True
    if contains_any(text, USER_SCOPE_TERMS) and contains_any(text, USER_STATE_TERMS):
        return True
    if contains_any(text, LIVE_DATA_TERMS) and not static_signal:
        return True
    return False


def suggest_label(text: str, intent_hints: str) -> dict[str, str]:
    combined = f"{text} {intent_hints}".strip()
    static_signal = has_static_signal(combined)
    if has_secret_or_pii_shape(combined) or contains_any(combined, UNSAFE_TERMS):
        return {
            "suggestedLabel": "unsafe_or_unknown",
            "mapConfidence": "high",
            "reviewStatus": "review_required",
            "reason": "Secret/PII/raw-context shape or unsafe term detected. Fail closed until reviewed.",
        }
    if has_dynamic_signal(combined, static_signal):
        return {
            "suggestedLabel": "dynamic_user_state",
            "mapConfidence": "medium",
            "reviewStatus": "review_required",
            "reason": "Utterance appears time-sensitive, live-data dependent, user-specific, or boundary-dependent.",
        }
    if contains_any(combined, POLICY_TERMS):
        return {
            "suggestedLabel": "cacheable_policy",
            "mapConfidence": "low",
            "reviewStatus": "review_required",
            "reason": "Policy/procedure-like wording detected; verified policy/version/hash boundary is still required.",
        }
    if static_signal:
        return {
            "suggestedLabel": "cacheable_static",
            "mapConfidence": "medium",
            "reviewStatus": "review_required",
            "reason": "Utterance looks like reusable guidance, explanation, definition, or general information.",
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
        suggestion = suggest_label(row["text"], row.get("intentHints", ""))
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
        "sourceFile",
        "sourceIndex",
        "speakerRole",
        "text",
        "intentHints",
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


def summarize(rows: list[dict[str, Any]], sample_rows: list[dict[str, Any]], source_path: Path) -> dict[str, Any]:
    suggested_counts = Counter(row["suggestedLabel"] for row in rows)
    confidence_counts = Counter(row["mapConfidence"] for row in rows)
    role_counts = Counter(row["speakerRole"] for row in rows)
    file_counts = Counter(row["sourceFile"] for row in rows)
    secret_shape_count = sum(1 for row in rows if has_secret_or_pii_shape(row["text"]))
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "name": DATASET_ID,
            "url": DATASET_URL,
            "sourcePath": str(source_path),
            "licenseNote": "Use is subject to AI Hub dataset terms. Keep raw data and review outputs out of git until license/privacy review is complete.",
        },
        "totalRows": len(rows),
        "reviewSampleRows": len(sample_rows),
        "sourceFileCount": len(file_counts),
        "topSourceFiles": dict(file_counts.most_common(20)),
        "speakerRoleCounts": dict(sorted(role_counts.items())),
        "suggestedLabelCounts": dict(sorted(suggested_counts.items())),
        "mapConfidenceCounts": dict(sorted(confidence_counts.items())),
        "secretOrPiiShapeCount": secret_shape_count,
        "reviewPolicy": "All suggested labels are draft labels and must be manually reviewed before use as training data.",
        "commitPolicy": "Do not commit raw AI Hub Korean Dialogue review outputs unless license and privacy review are complete.",
    }


def main() -> int:
    args = parse_args()
    if args.sample_per_label < 1:
        raise SystemExit("--sample-per-label must be at least 1")

    source_path = args.source_path.resolve()
    output_dir = args.output_dir.resolve()
    rows = attach_suggestions(load_rows(source_path, args.include_system, args.max_rows))
    if not rows:
        raise SystemExit(
            "No user utterance candidates found. Check --source-path or rerun with --include-system only for format inspection."
        )
    sample_rows = make_review_sample(rows, args.sample_per_label)
    summary = summarize(rows, sample_rows, source_path)

    write_json(output_dir / "aihub_korean_dialogue_summary.json", summary)
    write_jsonl(output_dir / "cacheability_aihub_korean_dialogue_relabel_draft.jsonl", rows)
    write_csv(output_dir / "aihub_korean_dialogue_review_sample.csv", sample_rows)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
