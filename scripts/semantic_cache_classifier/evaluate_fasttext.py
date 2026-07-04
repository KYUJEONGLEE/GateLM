#!/usr/bin/env python3
"""Evaluate a FastText cacheability classifier against a holdout file."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_TEST_FILE = BASE_DIR / "build" / "cacheability.test.txt"
DEFAULT_CRITERIA_FILE = BASE_DIR / "acceptance_criteria.json"

LABEL_PREFIX = "__label__"
LABELS = [
    "cacheable_static",
    "cacheable_policy",
    "dynamic_user_state",
    "unsafe_or_unknown",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-file", type=Path, required=True, help="FastText .bin model artifact.")
    parser.add_argument("--test-file", type=Path, default=DEFAULT_TEST_FILE, help="FastText supervised holdout file.")
    parser.add_argument("--criteria-file", type=Path, default=DEFAULT_CRITERIA_FILE, help="Acceptance criteria JSON.")
    parser.add_argument("--report-file", type=Path, help="Optional JSON report output path.")
    parser.add_argument("--fail-on-threshold", action="store_true", help="Exit non-zero when acceptance thresholds fail.")
    return parser.parse_args()


def import_fasttext() -> Any:
    try:
        import fasttext  # type: ignore
    except ImportError as exc:
        print(
            "Python package 'fasttext' is required for evaluation. "
            "Install it in your local tooling environment, then rerun this script.",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc
    return fasttext


def parse_fasttext_line(line: str, line_number: int) -> tuple[str, str]:
    stripped = line.strip()
    if not stripped:
        raise ValueError(f"line {line_number}: empty line")
    label_token, _, text = stripped.partition(" ")
    if not label_token.startswith(LABEL_PREFIX) or not text:
        raise ValueError(f"line {line_number}: expected '__label__name text'")
    label = label_token.removeprefix(LABEL_PREFIX)
    if label not in LABELS:
        raise ValueError(f"line {line_number}: unknown label {label}")
    return label, text


def load_examples(path: Path) -> list[tuple[str, str]]:
    examples: list[tuple[str, str]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if line.strip():
                examples.append(parse_fasttext_line(line, line_number))
    return examples


def safe_div(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def compute_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    labels = LABELS
    by_label: dict[str, dict[str, float]] = {}
    actual_counts = Counter(row["actual"] for row in rows)
    predicted_counts = Counter(row["predicted"] for row in rows)
    correct = sum(1 for row in rows if row["actual"] == row["predicted"])

    for label in labels:
        tp = sum(1 for row in rows if row["actual"] == label and row["predicted"] == label)
        fp = sum(1 for row in rows if row["actual"] != label and row["predicted"] == label)
        fn = sum(1 for row in rows if row["actual"] == label and row["predicted"] != label)
        precision = safe_div(tp, tp + fp)
        recall = safe_div(tp, tp + fn)
        f1 = safe_div(2 * precision * recall, precision + recall)
        by_label[label] = {
            "support": actual_counts[label],
            "predicted": predicted_counts[label],
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(f1, 6),
        }

    macro_f1 = safe_div(sum(metrics["f1"] for metrics in by_label.values()), len(labels))
    return {
        "total": len(rows),
        "accuracy": round(safe_div(correct, len(rows)), 6),
        "macroF1": round(macro_f1, 6),
        "labels": by_label,
    }


def load_criteria(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def evaluate_thresholds(metrics: dict[str, Any], criteria: dict[str, Any]) -> dict[str, Any]:
    failures: list[str] = []
    if metrics["accuracy"] < criteria.get("minimumOverallAccuracy", 0.0):
        failures.append(
            f"overall accuracy {metrics['accuracy']} < {criteria.get('minimumOverallAccuracy')}"
        )
    if metrics["macroF1"] < criteria.get("minimumMacroF1", 0.0):
        failures.append(f"macroF1 {metrics['macroF1']} < {criteria.get('minimumMacroF1')}")

    label_criteria = criteria.get("labels", {})
    for label, required in label_criteria.items():
        actual = metrics["labels"].get(label, {})
        checks = [
            ("precision", "minPrecision"),
            ("recall", "minRecall"),
            ("f1", "minF1"),
        ]
        for metric_key, threshold_key in checks:
            threshold = required.get(threshold_key)
            if threshold is not None and actual.get(metric_key, 0.0) < threshold:
                failures.append(
                    f"{label} {metric_key} {actual.get(metric_key, 0.0)} < {threshold}"
                )

    return {
        "passed": not failures,
        "failures": failures,
    }


def main() -> int:
    args = parse_args()
    model_file = args.model_file.resolve()
    test_file = args.test_file.resolve()
    criteria_file = args.criteria_file.resolve()

    for required_path, label in (
        (model_file, "model file"),
        (test_file, "test file"),
        (criteria_file, "criteria file"),
    ):
        if not required_path.exists():
            print(f"{label} not found: {required_path}", file=sys.stderr)
            return 2

    fasttext = import_fasttext()
    model = fasttext.load_model(str(model_file))
    examples = load_examples(test_file)

    rows: list[dict[str, Any]] = []
    for actual, text in examples:
        predicted_labels, probabilities = model.predict(text, k=1)
        predicted = predicted_labels[0].removeprefix(LABEL_PREFIX) if predicted_labels else "unsafe_or_unknown"
        confidence = float(probabilities[0]) if len(probabilities) else 0.0
        rows.append(
            {
                "actual": actual,
                "predicted": predicted,
                "confidence": round(confidence, 6),
            }
        )

    metrics = compute_metrics(rows)
    criteria = load_criteria(criteria_file)
    acceptance = evaluate_thresholds(metrics, criteria)
    report = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "modelFile": str(model_file),
        "testFile": str(test_file),
        "criteriaFile": str(criteria_file),
        "metrics": metrics,
        "acceptance": acceptance,
    }

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report_file:
        args.report_file.resolve().parent.mkdir(parents=True, exist_ok=True)
        args.report_file.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)

    if args.fail_on_threshold and not acceptance["passed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
