from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from app.domain.safety_eval.actual import load_actual_fixture, normalize_mode
from app.domain.safety_eval.corpus import filter_cases, load_corpus
from app.domain.safety_eval.evaluator import evaluate_cases
from app.domain.safety_eval.report import (
    build_report,
    scan_path_for_forbidden_sensitive_values,
    write_reports,
)
from app.schemas.safety_eval import SafetyEvalError


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CORPUS_PATH = REPO_ROOT / "docs" / "v1.0.0" / "fixtures" / "safety-eval-corpus.jsonl"
DEFAULT_SCHEMA_PATH = REPO_ROOT / "docs" / "v1.0.0" / "schemas" / "safety-eval-corpus.schema.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run GateLM v1 safety evaluation fixtures.")
    parser.add_argument(
        "--mode",
        required=True,
        choices=["detector-output", "gateway-safety-output"],
        help="Actual fixture mode.",
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        default=DEFAULT_CORPUS_PATH,
        help="Path to safety-eval-corpus.jsonl.",
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        required=True,
        help="Path to detector or gateway actual fixture JSON.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Output directory for JSON and Markdown reports.",
    )
    parser.add_argument("--tag", action="append", default=[], help="Filter corpus cases by tag. Repeatable.")
    parser.add_argument("--case-id", action="append", default=[], help="Filter corpus cases by caseId. Repeatable.")
    parser.add_argument(
        "--no-fail-on-mismatch",
        action="store_true",
        help="Return exit code 0 even when evaluation cases fail.",
    )
    parser.add_argument(
        "--strict-security-scan",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Fail if actual fixture or report includes raw sensitive values.",
    )
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    mode = normalize_mode(args.mode)

    try:
        if args.strict_security_scan:
            scan_path_for_forbidden_sensitive_values(args.fixture)
        cases = load_corpus(args.corpus, DEFAULT_SCHEMA_PATH)
        cases = filter_cases(
            cases,
            tags=set(args.tag) if args.tag else None,
            case_ids=set(args.case_id) if args.case_id else None,
        )
        raw_fixture, actual_by_case_id = load_actual_fixture(args.fixture, mode)
        evaluation = evaluate_cases(cases, actual_by_case_id)
        report = build_report(
            evaluation,
            corpus_path=args.corpus,
            fixture_path=args.fixture,
            mode=mode,
            fixture_name=raw_fixture.get("fixtureName"),
            fixture_version=raw_fixture.get("fixtureVersion"),
        )
        json_path, markdown_path = write_reports(
            report,
            args.out,
            strict_security_scan=args.strict_security_scan,
        )
    except (SafetyEvalError, OSError, UnicodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    summary = evaluation.summary
    print(
        "safety eval completed: "
        f"{summary['passedCases']}/{summary['totalCases']} passed, "
        f"failed={summary['failedCases']}, "
        f"json={json_path}, markdown={markdown_path}"
    )
    if summary["failedCases"] and not args.no_fail_on_mismatch:
        return 1
    return 0


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
