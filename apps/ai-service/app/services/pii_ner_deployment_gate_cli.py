from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from app.adapters.safety.privacy_filter_adapter import (
    GATELM_KOELECTRA_PII_NER_MODEL,
)
from app.domain.ai_safety_training.koelectra_training import sha256_file
from app.domain.safety_eval.report import scan_text_for_forbidden_sensitive_values


DEPLOYMENT_REPORT_VERSION = "gatelm.pii-ner-deployment-gate.v1"
CANDIDATE_REPORT_VERSION = "gatelm.pii-ner-candidate-evaluation.v1"
PROMOTION_REPORT_VERSION = "pii-production-promotion-evidence.v1"
DEFAULT_RUNTIME_MODEL_PATH = (
    ".cache/onnx/gatelm--koelectra-small-v3-pii-ner-quantized"
)
TARGET_TYPES = (
    "email",
    "organization_name",
    "person_name",
    "phone_number",
    "postal_address",
    "resident_registration_number",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fail-closed deployment gate for the GateLM KoELECTRA PII NER candidate."
    )
    parser.add_argument("--candidate-evaluation", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--promotion-evidence", type=Path, default=None)
    parser.add_argument("--runtime-model-path", default=DEFAULT_RUNTIME_MODEL_PATH)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--expect-blocked", action="store_true")
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        runtime_model_path = validate_runtime_model_path(args.runtime_model_path)
        candidate = read_object(args.candidate_evaluation)
        promotion = (
            read_object(args.promotion_evidence)
            if args.promotion_evidence is not None
            else None
        )
        report = evaluate_deployment_gate(
            candidate=candidate,
            promotion=promotion,
            model_dir=args.model_dir,
        )
        args.out.mkdir(parents=True, exist_ok=True)
        rollback_text = render_rollback_env()
        scan_text_for_forbidden_sensitive_values(
            rollback_text,
            "PII NER rules-only rollback env",
        )
        rollback_path = args.out / "rules-only-rollback.env"
        rollback_path.write_text(rollback_text, encoding="utf-8")

        candidate_path: Path | None = None
        if report["decision"] == "ready":
            candidate_text = render_candidate_env(runtime_model_path)
            scan_text_for_forbidden_sensitive_values(
                candidate_text,
                "PII NER candidate activation env",
            )
            candidate_path = args.out / "candidate-activation.env"
            candidate_path.write_text(candidate_text, encoding="utf-8")

        report["outputs"] = {
            "rulesOnlyRollbackEnvWritten": True,
            "candidateActivationEnvWritten": candidate_path is not None,
        }
        report_text = json.dumps(
            report,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ) + "\n"
        scan_text_for_forbidden_sensitive_values(
            report_text,
            "PII NER deployment gate report",
        )
        report_path = args.out / "deployment-gate.json"
        report_path.write_text(report_text, encoding="utf-8")
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: PII NER deployment gate could not run ({type(exc).__name__})", file=sys.stderr)
        return 2

    print(
        "PII NER deployment gate completed: "
        f"decision={report['decision']}, reasons={len(report['reasonCodes'])}, "
        f"report={report_path}"
    )
    blocked = report["decision"] != "ready"
    if args.expect_blocked:
        return 0 if blocked else 1
    return 1 if blocked else 0


def evaluate_deployment_gate(
    *,
    candidate: Mapping[str, Any],
    promotion: Mapping[str, Any] | None,
    model_dir: Path,
) -> dict[str, Any]:
    reasons: list[str] = []
    model_path = model_dir / "model.onnx"
    if candidate.get("reportVersion") != CANDIDATE_REPORT_VERSION:
        reasons.append("candidate_report_version_invalid")
    if candidate.get("status") != "complete":
        reasons.append("candidate_report_incomplete")
    if candidate.get("customerPromptUsed") is not False:
        reasons.append("candidate_provenance_invalid")
    if not model_path.is_file():
        reasons.append("candidate_model_missing")
    else:
        expected_digest = candidate.get("artifact", {}).get("modelSha256")
        if expected_digest != sha256_file(model_path):
            reasons.append("candidate_model_checksum_mismatch")

    candidate_gate = candidate.get("candidateGate")
    candidate_passed = (
        isinstance(candidate_gate, Mapping)
        and candidate_gate.get("decision") == "pass"
        and candidate_gate.get("stage6DeploymentAllowed") is True
        and candidate_gate.get("failedChecks") == []
    )
    if not candidate_passed:
        reasons.append("candidate_engineering_gate_failed")
    else:
        reasons.extend(promotion_reasons(promotion))

    unique_reasons = sorted(set(reasons))
    return {
        "reportVersion": DEPLOYMENT_REPORT_VERSION,
        "decision": "ready" if not unique_reasons else "blocked",
        "reasonCodes": unique_reasons,
        "failClosed": True,
        "rulesOnlyRollbackRequired": bool(unique_reasons),
        "candidateActivationAllowed": not unique_reasons,
        "customerPromptUsed": False,
        "rawContentIncluded": False,
        "detectedValueIncluded": False,
        "requestIdentifierIncluded": False,
    }


def promotion_reasons(promotion: Mapping[str, Any] | None) -> list[str]:
    if promotion is None:
        return ["production_promotion_evidence_missing"]
    reasons: list[str] = []
    if promotion.get("schemaVersion") != PROMOTION_REPORT_VERSION:
        reasons.append("production_promotion_version_invalid")
    if promotion.get("aggregateOnly") is not True:
        reasons.append("production_promotion_not_aggregate_only")
    checks = promotion.get("checks")
    if (
        promotion.get("decision") != "ready"
        or promotion.get("readyForProduction") is not True
        or promotion.get("gateCounts", {}).get("blocked") != 0
        or not isinstance(checks, list)
        or len(checks) != 6
        or any(
            not isinstance(check, Mapping)
            or check.get("status") != "passed"
            or check.get("reasonCodes") != []
            for check in checks
        )
    ):
        reasons.append("production_promotion_gate_failed")
    return reasons


def render_candidate_env(runtime_model_path: str) -> str:
    values = {
        "GATEWAY_AI_SAFETY_SIDECAR_ENABLED": "true",
        "GATEWAY_AI_SAFETY_SIDECAR_MODEL_ID": GATELM_KOELECTRA_PII_NER_MODEL,
        "GATEWAY_AI_SAFETY_SIDECAR_DETECTOR_SET": "gatelm-koelectra-pii-ner-v1",
        "GATEWAY_AI_SAFETY_SIDECAR_MODE": "enforce",
        "GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS": "100",
        "AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME": "onnx",
        "AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED": "true",
        "AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE": "1",
        "AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES": ",".join(TARGET_TYPES),
        "AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID": runtime_model_path,
        "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS": "",
    }
    return "".join(f"{key}={value}\n" for key, value in values.items())


def render_rollback_env() -> str:
    return (
        "GATEWAY_AI_SAFETY_SIDECAR_ENABLED=false\n"
        "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=\n"
    )


def validate_runtime_model_path(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    if (
        normalized == ""
        or any(char.isspace() for char in normalized)
        or "=" in normalized
        or not normalized.endswith(
            "/gatelm--koelectra-small-v3-pii-ner-quantized"
        )
    ):
        raise ValueError("runtime model path is invalid")
    return normalized


def read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("deployment gate input must be a JSON object")
    return value


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
