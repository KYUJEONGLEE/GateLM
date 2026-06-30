from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.domain.safety_eval.evaluator import EvaluationResult
from app.schemas.safety_eval import REPORT_VERSION, REPORT_VERSION_V2, SafetyEvalError


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
    "actualCacheHitRate",
    "actualSavedCost",
    "actualProviderBypass",
    "cacheHitRate",
    "savedCost",
    "providerBypass",
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
    semantic_cache_evidence: dict[str, Any] | None = None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    generated = generated_at or datetime.now(tz=timezone.utc)
    report = {
        "reportVersion": report_version_for_mode(mode),
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
    if semantic_cache_evidence is not None:
        validate_semantic_cache_evidence_shape(semantic_cache_evidence, "semantic cache evidence")
        report["semanticCacheEvidence"] = semantic_cache_evidence
    return report


def report_version_for_mode(mode: str) -> str:
    return REPORT_VERSION_V2 if mode.replace("-", "_").endswith("_v2") else REPORT_VERSION


def load_semantic_cache_evidence_fixture(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SafetyEvalError(f"semantic cache evidence fixture not found: {path}")
    try:
        raw_fixture = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SafetyEvalError(f"semantic cache evidence JSON parse failed: {exc}") from exc
    validate_semantic_cache_evidence_shape(raw_fixture, str(path))
    return raw_fixture


def validate_semantic_cache_evidence_shape(value: dict[str, Any], label: str) -> None:
    if not isinstance(value, dict) or set(value) != {"fixtureName", "fixtureVersion", "mode", "evidence"}:
        raise SafetyEvalError(f"{label}: semantic cache evidence fields mismatch")
    if value["mode"] != "semantic_cache_evidence_v2":
        raise SafetyEvalError(f"{label}: semantic cache evidence mode mismatch")
    for field_name in ("fixtureName", "fixtureVersion"):
        field_value = value[field_name]
        if not isinstance(field_value, str) or not field_value:
            raise SafetyEvalError(f"{label}: {field_name} must be a non-empty string")
    evidence = value["evidence"]
    if not isinstance(evidence, dict) or set(evidence) != {
        "evidenceOnly",
        "normalizedRedactedPromptOnly",
        "candidateCount",
        "wouldHaveMatchedCount",
    }:
        raise SafetyEvalError(f"{label}: semantic cache evidence payload fields mismatch")
    if evidence["evidenceOnly"] is not True:
        raise SafetyEvalError(f"{label}: evidenceOnly must be true")
    if evidence["normalizedRedactedPromptOnly"] is not True:
        raise SafetyEvalError(f"{label}: normalizedRedactedPromptOnly must be true")
    candidate_count = evidence["candidateCount"]
    would_have_matched_count = evidence["wouldHaveMatchedCount"]
    if not isinstance(candidate_count, int) or candidate_count < 0:
        raise SafetyEvalError(f"{label}: candidateCount must be non-negative integer")
    if not isinstance(would_have_matched_count, int) or would_have_matched_count < 0:
        raise SafetyEvalError(f"{label}: wouldHaveMatchedCount must be non-negative integer")
    if would_have_matched_count > candidate_count:
        raise SafetyEvalError(f"{label}: wouldHaveMatchedCount cannot exceed candidateCount")


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
    semantic_cache_evidence = report.get("semanticCacheEvidence")
    if semantic_cache_evidence is not None:
        evidence = semantic_cache_evidence["evidence"]
        lines.append("## Semantic Cache Evidence")
        lines.append("")
        lines.append("| Field | Value |")
        lines.append("|---|---:|")
        lines.append(f"| evidenceOnly | {evidence['evidenceOnly']} |")
        lines.append(f"| normalizedRedactedPromptOnly | {evidence['normalizedRedactedPromptOnly']} |")
        lines.append(f"| candidateCount | {evidence['candidateCount']} |")
        lines.append(f"| wouldHaveMatchedCount | {evidence['wouldHaveMatchedCount']} |")
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
