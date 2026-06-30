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
    span_detections = [
        detection
        for detection in detections
        if isinstance(detection.get("start"), int) and isinstance(detection.get("end"), int)
    ]

    for detection in sorted(span_detections, key=lambda item: item["start"], reverse=True):
        redacted = (
            redacted[: detection["start"]]
            + detection["placeholder"]
            + redacted[detection["end"] :]
        )

    return redacted


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
    detections = [
        detection
        for item in raw_items
        if (detection := normalize_detection(item)) is not None
    ]
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
