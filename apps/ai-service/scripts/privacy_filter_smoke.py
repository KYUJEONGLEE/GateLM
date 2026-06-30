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

from app.adapters.safety.privacy_filter_adapter import (
    DEFAULT_PRIVACY_FILTER_SOURCE,
    normalize_label,
)
from app.domain.safety.detections import Detection, normalized_confidence, safety_signals_from_detections
from app.domain.safety.policy import effective_signals, redact_prompt
from app.domain.safety.signals import SafetySignal
from app.services.ai_safety_detector import DEFAULT_PRIVACY_FILTER_DETECTORS


DETECTOR_CONFIG = {detector.type: detector for detector in DEFAULT_PRIVACY_FILTER_DETECTORS}


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


def normalize_detection(item: dict[str, Any], text_length: int) -> dict[str, Any] | None:
    model_label = item.get("entity_group") or item.get("entity")
    if not isinstance(model_label, str):
        return None

    detector_type = normalize_label(model_label)
    if detector_type is None:
        return None
    start = coerce_int(item.get("start"))
    end = coerce_int(item.get("end"))
    if start is None or end is None:
        return None
    if start < 0 or end <= start or end > text_length:
        return None

    return {
        "detection": Detection(
            detector_type=detector_type,
            source=DEFAULT_PRIVACY_FILTER_SOURCE,
            start=start,
            end=end,
            confidence=normalized_confidence(coerce_float(item.get("score"))),
        ),
        "modelLabel": model_label,
    }


def coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def coerce_float(value: object) -> float:
    if isinstance(value, bool):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def output_detection(signal: SafetySignal, raw_detections: list[dict[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {
        "detectorType": signal.detector_type,
        "source": signal.source,
        "confidence": signal.confidence,
        "action": signal.action,
        "mode": "shadow",
    }
    model_label = model_label_for_signal(signal, raw_detections)
    if model_label is not None:
        output["modelLabel"] = model_label
    return output


def model_label_for_signal(
    signal: SafetySignal,
    raw_detections: list[dict[str, Any]],
) -> str | None:
    labels = {
        str(raw_detection["modelLabel"])
        for raw_detection in raw_detections
        if detection_overlaps_signal(raw_detection["detection"], signal)
    }
    if len(labels) == 1:
        return next(iter(labels))
    return None


def detection_overlaps_signal(detection: Detection, signal: SafetySignal) -> bool:
    if detection.detector_type != signal.detector_type:
        return False
    return detection.start < signal.end and signal.start < detection.end


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
        if (detection := normalize_detection(item, len(input_text))) is not None
    ]
    detections = [raw_detection["detection"] for raw_detection in raw_detections]
    signals = effective_signals(
        safety_signals_from_detections(detections, DETECTOR_CONFIG),
        prompt_text=input_text,
    )
    detector_categories = sorted({signal.detector_type for signal in signals})
    outcome = "blocked" if any(signal.action == "block" for signal in signals) else "redacted"
    if not signals:
        outcome = "passed"

    output = {
        "contractVersion": "ai-safety-detector.v1",
        "model": {
            "modelId": args.model,
            "runtime": "cpu_only",
        },
        "outcome": outcome,
        "mode": "shadow",
        "redactedPrompt": redact_prompt(input_text, signals),
        "detectorSummary": {
            "detectedCount": len(signals),
            "detectorCategories": detector_categories,
        },
        "detections": [output_detection(signal, raw_detections) for signal in signals],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
