"""Run the local openai/privacy-filter detector with sanitized output.

This script is for local AI Safety Lab experiments only. Do not pass real
customer text, real email addresses, tokens, credentials, or production logs.
The script does not print raw detected spans from the model output.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any


MERGEABLE_INFIX_CHARS = frozenset("._-+@:/?=&%#")

LABEL_MAP = {
    "private_email": ("email", "redact", "[EMAIL_REDACTED]"),
    "private_phone": ("phone_number", "redact", "[PHONE_NUMBER_REDACTED]"),
    "private_person": ("person_name", "redact", "[PERSON_NAME_REDACTED]"),
    "private_address": ("postal_address", "redact", "[ADDRESS_REDACTED]"),
    "account_number": ("account_number", "block", "[ACCOUNT_NUMBER_REDACTED]"),
    "private_date": ("private_date", "redact", "[PRIVATE_DATE_REDACTED]"),
    "private_url": ("private_url", "redact", "[PRIVATE_URL_REDACTED]"),
    "secret": ("secret", "block", "[SECRET_REDACTED]"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run openai/privacy-filter locally and print sanitized JSON."
    )
    parser.add_argument(
        "--text",
        help="Synthetic text to scan. If omitted, text is read from stdin.",
    )
    parser.add_argument(
        "--model",
        default="openai/privacy-filter",
        help="Hugging Face model id. Defaults to openai/privacy-filter.",
    )
    return parser.parse_args()


def read_input(text_arg: str | None) -> str:
    if text_arg is not None:
        return text_arg

    text = sys.stdin.read()
    if not text:
        raise SystemExit("No input text. Pass --text or pipe text on stdin.")
    return text


def normalize_detection(item: dict[str, Any]) -> dict[str, Any] | None:
    model_label = item.get("entity_group") or item.get("entity")
    if not isinstance(model_label, str):
        return None

    mapping = LABEL_MAP.get(model_label)
    if mapping is None:
        return None

    detector_type, action, placeholder = mapping
    return {
        "detectorType": detector_type,
        "modelLabel": model_label,
        "source": "openai_privacy_filter",
        "confidence": float(item.get("score", 0.0)),
        "action": action,
        "mode": "shadow",
        "placeholder": placeholder,
        "start": item.get("start"),
        "end": item.get("end"),
    }


def redact_text(text: str, detections: list[dict[str, Any]]) -> str:
    redacted = text
    span_detections = normalize_redaction_detections(text, detections)

    for detection in sorted(span_detections, key=lambda item: item["start"], reverse=True):
        redacted = (
            redacted[: detection["start"]]
            + detection["placeholder"]
            + redacted[detection["end"] :]
        )

    return redacted


def normalize_redaction_detections(
    text: str,
    detections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized = [
        normalized_detection
        for detection in detections
        if (normalized_detection := normalize_detection_span(text, detection)) is not None
    ]
    normalized.sort(
        key=lambda detection: (
            detection["start"],
            detection["end"],
            -float(detection.get("confidence", 0.0)),
        )
    )

    selected: list[dict[str, Any]] = []
    for detection in normalized:
        if selected and detection["start"] < selected[-1]["end"]:
            previous = selected[-1]
            previous_confidence = float(previous.get("confidence", 0.0))
            current_confidence = float(detection.get("confidence", 0.0))
            previous_length = previous["end"] - previous["start"]
            current_length = detection["end"] - detection["start"]
            if (current_confidence, current_length) > (previous_confidence, previous_length):
                selected[-1] = detection
            continue
        selected.append(detection)

    merged: list[dict[str, Any]] = []
    for detection in selected:
        if merged and should_merge_adjacent_detection(merged[-1], detection, text):
            merged[-1]["end"] = detection["end"]
            merged[-1]["confidence"] = max(
                float(merged[-1].get("confidence", 0.0)),
                float(detection.get("confidence", 0.0)),
            )
            continue
        merged.append(detection)
    return merged


def normalize_detection_span(text: str, detection: dict[str, Any]) -> dict[str, Any] | None:
    start = detection.get("start")
    end = detection.get("end")
    if not isinstance(start, int) or not isinstance(end, int):
        return None
    if start < 0 or end <= start or end > len(text):
        return None

    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    if end <= start:
        return None

    normalized = dict(detection)
    normalized["start"] = start
    normalized["end"] = end
    return normalized


def should_merge_adjacent_detection(
    previous: dict[str, Any],
    current: dict[str, Any],
    text: str,
) -> bool:
    if previous.get("detectorType") != current.get("detectorType"):
        return False
    if previous.get("action") != current.get("action"):
        return False
    if previous.get("placeholder") != current.get("placeholder"):
        return False
    gap = text[previous["end"] : current["start"]]
    return gap == "" or all(char in MERGEABLE_INFIX_CHARS for char in gap)


def strip_internal_fields(detection: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in detection.items()
        if key not in {"start", "end", "placeholder"}
    }


def main() -> None:
    args = parse_args()
    input_text = read_input(args.text)

    from transformers import pipeline

    classifier = pipeline(
        task="token-classification",
        model=args.model,
        aggregation_strategy="simple",
    )

    raw_items = classifier(input_text)
    raw_detections = [
        detection
        for item in raw_items
        if (detection := normalize_detection(item)) is not None
    ]
    detections = normalize_redaction_detections(input_text, raw_detections)
    detector_categories = sorted({detection["detectorType"] for detection in detections})
    outcome = "blocked" if any(d["action"] == "block" for d in detections) else "redacted"
    if not detections:
        outcome = "passed"

    output = {
        "contractVersion": "ai-safety-detector.v1",
        "model": {
            "modelId": args.model,
            "runtime": "cpu_only",
        },
        "outcome": outcome,
        "mode": "shadow",
        "redactedPrompt": redact_text(input_text, detections),
        "detectorSummary": {
            "detectedCount": len(detections),
            "detectorCategories": detector_categories,
        },
        "detections": [strip_internal_fields(detection) for detection in detections],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
