from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.domain.safety_eval.evaluator import EvaluationResult
from app.schemas.safety_eval import REPORT_VERSION, SafetyEvalError


FORBIDDEN_FIELD_NAMES = {
    "rawPrompt",
    "rawMessages",
    "messages",
    "rawResponse",
    "fullRequestBody",
    "fullResponseBody",
    "providerApiKey",
    "apiKeyPlaintext",
    "appTokenPlaintext",
    "authorizationHeader",
    "cookie",
    "rawProviderErrorBody",
    "maskingSampleRawValue",
    "rawValue",
    "matchText",
    "detectedValue",
    "sampleHash",
}

FORBIDDEN_LITERAL_PATTERNS = {
    "openai_like_key": re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9_\-]{10,}"),
    "anthropic_like_key": re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{10,}"),
    "google_api_key_like": re.compile(r"\bAIza[A-Za-z0-9_\-]{10,}"),
    "aws_access_key_like": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "github_token_like": re.compile(r"\b(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    "slack_token_like": re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
    "authorization_credential": re.compile(r"Authorization\s*:\s*(?:Bearer|Basic)\s+\S+", re.IGNORECASE),
    "jwt_like": re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b"),
    "private_key_block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "rrn_like": re.compile(r"\b\d{6}[-\s]?[1-8]\d{6}\b"),
}


def build_report(
    evaluation: EvaluationResult,
    *,
    corpus_path: Path,
    fixture_path: Path,
    mode: str,
    fixture_name: str | None,
    fixture_version: str | None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    generated = generated_at or datetime.now(tz=timezone.utc)
    return {
        "reportVersion": REPORT_VERSION,
        "generatedAt": generated.isoformat().replace("+00:00", "Z"),
        "corpus": {
            "path": str(corpus_path),
        },
        "actualFixture": {
            "path": str(fixture_path),
            "mode": mode,
            "fixtureName": fixture_name,
            "fixtureVersion": fixture_version,
        },
        "summary": evaluation.summary,
        "actionConfusion": evaluation.action_confusion,
        "detectors": [
            stats.to_report()
            for _, stats in sorted(evaluation.detectors.items())
        ],
        "cases": evaluation.cases,
    }


def render_markdown_report(report: dict[str, Any]) -> str:
    lines: list[str] = []
    summary = report["summary"]
    lines.append("# Safety Eval Report")
    lines.append("")
    lines.append(f"- Report Version: `{report['reportVersion']}`")
    lines.append(f"- Generated At: `{report['generatedAt']}`")
    lines.append(f"- Mode: `{report['actualFixture']['mode']}`")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|---|---:|")
    for key in [
        "totalCases",
        "passedCases",
        "failedCases",
        "passRate",
        "falsePositiveCases",
        "falseNegativeCases",
        "actionMismatchCases",
        "gatewayEffectMismatchCases",
    ]:
        lines.append(f"| {key} | {summary[key]} |")
    lines.append("")
    lines.append("## Detector Results")
    lines.append("")
    lines.append("| Detector | TP | FP | FN | TN | Precision | Recall | Count Mismatch |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    for detector in report["detectors"]:
        lines.append(
            "| {detectorType} | {truePositiveCases} | {falsePositiveCases} | "
            "{falseNegativeCases} | {trueNegativeCases} | {precision} | {recall} | "
            "{countMismatchCases} |".format(**detector)
        )
    lines.append("")
    lines.append("## Action Confusion")
    lines.append("")
    lines.append("| Expected | Actual | Count |")
    lines.append("|---|---|---:|")
    for expected_action, actual_counts in sorted(report["actionConfusion"].items()):
        for actual_action, count in sorted(actual_counts.items()):
            lines.append(f"| {expected_action} | {actual_action} | {count} |")
    lines.append("")
    lines.append("## Failed Cases")
    lines.append("")
    lines.append("| Case ID | Expected | Actual | Missing Types | Extra Types | Reasons |")
    lines.append("|---|---|---|---|---|---|")
    failed_cases = [case for case in report["cases"] if case["outcome"] == "fail"]
    if not failed_cases:
        lines.append("| _none_ |  |  |  |  |  |")
    for case in failed_cases:
        lines.append(
            "| {caseId} | {expected} | {actual} | {missing} | {extra} | {reasons} |".format(
                caseId=case["caseId"],
                expected=case["expected"]["action"],
                actual=case["actual"]["action"],
                missing=", ".join(case["missingDetectorTypes"]) or "-",
                extra=", ".join(case["extraDetectorTypes"]) or "-",
                reasons=", ".join(case["mismatchReasons"]),
            )
        )
    lines.append("")
    return "\n".join(lines)


def write_reports(report: dict[str, Any], out_dir: Path, *, strict_security_scan: bool = True) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "safety-eval-report.json"
    markdown_path = out_dir / "safety-eval-report.md"
    json_text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    markdown_text = render_markdown_report(report)
    if strict_security_scan:
        scan_text_for_forbidden_sensitive_values(json_text, "JSON report")
        scan_text_for_forbidden_sensitive_values(markdown_text, "Markdown report")
    json_path.write_text(json_text + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_text, encoding="utf-8")
    return json_path, markdown_path


def scan_path_for_forbidden_sensitive_values(path: Path) -> None:
    if not path.exists():
        raise SafetyEvalError(f"scan target not found: {path}")
    scan_text_for_forbidden_sensitive_values(path.read_text(encoding="utf-8"), str(path))


def scan_text_for_forbidden_sensitive_values(text: str, label: str) -> None:
    for field_name in FORBIDDEN_FIELD_NAMES:
        if re.search(rf'"{re.escape(field_name)}"\s*:', text):
            raise SafetyEvalError(f"{label}: forbidden field name {field_name!r} found")
    for pattern_name, pattern in FORBIDDEN_LITERAL_PATTERNS.items():
        if pattern.search(text):
            raise SafetyEvalError(f"{label}: forbidden sensitive literal pattern {pattern_name!r} found")
