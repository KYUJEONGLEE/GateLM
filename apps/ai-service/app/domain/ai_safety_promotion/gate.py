from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping
from typing import Any

from app.domain.ai_safety_promotion.binding import (
    EvidenceBindingError,
    validate_evidence_binding,
)


EVIDENCE_VERSION = "pii-production-promotion-evidence.v1"
OWNER_POLICY_VERSION = "pii-promotion-owner-policy.v1"
MODEL_PROMOTION_PII_TYPES = frozenset(
    {
        "email",
        "phone_number",
        "resident_registration_number",
        "account_number",
        "postal_address",
        "private_date",
        "private_url",
        "secret",
        "person_name",
        "organization_name",
    }
)
MODEL_PROMOTION_LOCALES = frozenset({"ko-KR", "en-US"})

FORBIDDEN_OUTPUT_FIELDS = {
    "promptText",
    "rawPrompt",
    "rawMessages",
    "rawValue",
    "detectedValue",
    "rawDetectedValue",
    "rawSpan",
    "span",
    "offset",
    "start",
    "end",
    "requestId",
    "traceId",
    "tenantId",
    "userId",
    "employeeId",
    "promptHash",
    "requestBodyHash",
    "endpointUrl",
}
FORBIDDEN_OUTPUT_PATTERNS = {
    "email_like": re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
    "rrn_like": re.compile(r"\b\d{6}[-\s]?[1-8]\d{6}\b"),
    "credential_like": re.compile(r"\b(?:sk-|ghp_|github_pat_|xox[abprs]-)[A-Za-z0-9_\-]{8,}"),
    "url_like": re.compile(r"https?://\S+", re.IGNORECASE),
}


class PromotionEvidenceError(ValueError):
    """Raised when promotion evidence cannot be evaluated safely."""


def build_promotion_evidence(
    *,
    manifest: Mapping[str, Any],
    quality: Mapping[str, Any],
    owner_policy: Mapping[str, Any] | None = None,
    artifact_verification: Mapping[str, Any] | None = None,
    benchmark: Mapping[str, Any] | None = None,
    cold_start: Mapping[str, Any] | None = None,
    tenant_chat_e2e: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    manifest_binding = _manifest_binding(manifest)
    policy_reasons, thresholds, promotion_scope = _owner_policy_reasons(owner_policy)
    quality_reasons = _quality_reasons(
        quality,
        thresholds,
        promotion_scope,
        manifest_binding,
    )
    quality_reasons.extend(
        _git_revision_consistency_reasons(
            artifact_verification,
            quality,
            benchmark,
            cold_start,
            tenant_chat_e2e,
        )
    )

    checks = [
        _check("owner_policy", policy_reasons),
        _check(
            "artifact_integrity",
            _artifact_verification_reasons(artifact_verification, manifest, manifest_binding),
        ),
        _check(
            "quality",
            quality_reasons,
        ),
        _check(
            "warm_runtime",
            _benchmark_reasons(benchmark, thresholds, manifest_binding),
        ),
        _check(
            "cold_runtime",
            _cold_start_reasons(cold_start, thresholds, manifest_binding),
        ),
        _check(
            "tenant_chat_e2e",
            _tenant_chat_e2e_reasons(tenant_chat_e2e, manifest_binding),
        ),
    ]
    blocked_count = sum(check["status"] == "blocked" for check in checks)
    passed_count = len(checks) - blocked_count
    evidence = {
        "schemaVersion": EVIDENCE_VERSION,
        "aggregateOnly": True,
        "decision": "ready" if blocked_count == 0 else "blocked",
        "readyForProduction": blocked_count == 0,
        "gateCounts": {
            "passed": passed_count,
            "blocked": blocked_count,
        },
        "checks": checks,
        "policy": {
            "source": "owner_supplied" if owner_policy is not None else "missing",
            "thresholdsApplied": owner_policy is not None and not policy_reasons,
            "repositoryDefaultThresholdsApplied": False,
        },
        "contentSafety": {
            "rawContentIncluded": False,
            "detectedValuesIncluded": False,
            "requestIdentifiersIncluded": False,
            "artifactDigestsIncluded": False,
            "endpointLocationsIncluded": False,
        },
    }
    scan_promotion_output(evidence)
    return evidence


def scan_promotion_output(evidence: Mapping[str, Any]) -> None:
    serialized = json.dumps(evidence, ensure_ascii=False, sort_keys=True)
    for field_name in FORBIDDEN_OUTPUT_FIELDS:
        if re.search(rf'"{re.escape(field_name)}"\s*:', serialized):
            raise PromotionEvidenceError(
                f"promotion output contains forbidden field category: {field_name}"
            )
    for category, pattern in FORBIDDEN_OUTPUT_PATTERNS.items():
        if pattern.search(serialized):
            raise PromotionEvidenceError(
                f"promotion output contains forbidden literal category: {category}"
            )


def _check(name: str, reasons: list[str]) -> dict[str, Any]:
    unique_reasons = sorted(set(reasons))
    return {
        "name": name,
        "status": "blocked" if unique_reasons else "passed",
        "reasonCodes": unique_reasons,
    }


def _manifest_binding(manifest: Mapping[str, Any]) -> dict[str, Any] | None:
    version = _non_empty_string(manifest.get("manifestVersion"))
    models = manifest.get("models")
    if version is None or not isinstance(models, list) or not models:
        return None
    revisions: dict[str, str] = {}
    expected_files = 0
    for model in models:
        if not isinstance(model, Mapping):
            return None
        model_key = _non_empty_string(model.get("modelId"))
        revision = _non_empty_string(model.get("revision"))
        files = model.get("files")
        if model_key is None or revision is None or not isinstance(files, list) or not files:
            return None
        if any(not _valid_manifest_file(item) for item in files):
            return None
        revisions[model_key] = revision
        expected_files += len(files)
    return {
        "manifestVersion": version,
        "modelRevisions": revisions,
        "expectedFiles": expected_files,
    }


def _valid_manifest_file(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    size = value.get("bytes")
    checksum = value.get("sha256")
    return (
        _non_empty_string(value.get("path")) is not None
        and isinstance(size, int)
        and not isinstance(size, bool)
        and size > 0
        and isinstance(checksum, str)
        and re.fullmatch(r"[0-9a-f]{64}", checksum) is not None
    )


def _owner_policy_reasons(
    owner_policy: Mapping[str, Any] | None,
) -> tuple[list[str], Mapping[str, Any] | None, Mapping[str, frozenset[str]] | None]:
    if owner_policy is None:
        return ["owner_policy_missing"], None, None
    reasons: list[str] = []
    if set(owner_policy) != {
        "policyVersion",
        "approvedForProduction",
        "scope",
        "thresholds",
    }:
        reasons.append("owner_policy_shape_invalid")
    if owner_policy.get("policyVersion") != OWNER_POLICY_VERSION:
        reasons.append("owner_policy_version_invalid")
    if owner_policy.get("approvedForProduction") is not True:
        reasons.append("owner_policy_not_approved")
    scope = owner_policy.get("scope")
    promotion_scope: Mapping[str, frozenset[str]] | None = None
    if not isinstance(scope, Mapping) or set(scope) != {
        "requiredPiiTypes",
        "requiredLocales",
    }:
        reasons.append("owner_scope_invalid")
    else:
        pii_types = scope.get("requiredPiiTypes")
        locales = scope.get("requiredLocales")
        if not _valid_unique_string_list(pii_types, pii_type=True) or not _valid_unique_string_list(
            locales, pii_type=False
        ):
            reasons.append("owner_scope_invalid")
        elif set(pii_types) != MODEL_PROMOTION_PII_TYPES:
            reasons.append("owner_scope_incomplete")
        elif set(locales) != MODEL_PROMOTION_LOCALES:
            reasons.append("owner_locale_scope_incomplete")
        else:
            promotion_scope = {
                "requiredPiiTypes": frozenset(pii_types),
                "requiredLocales": frozenset(locales),
            }
    thresholds = owner_policy.get("thresholds")
    if not isinstance(thresholds, Mapping):
        return [*reasons, "owner_thresholds_missing"], None, None
    expected_threshold_names = {
        "minimumOverallPassRate",
        "minimumPrecisionByPiiType",
        "minimumRecallByPiiType",
        "maximumWarmSidecarP95Ms",
        "maximumColdP95Ms",
        "maximumPeakRssMb",
        "maximumStartupFailureRate",
        "minimumColdStartRuns",
    }
    if set(thresholds) != expected_threshold_names:
        reasons.append("owner_threshold_keys_invalid")
    positive_names = (
        "maximumWarmSidecarP95Ms",
        "maximumColdP95Ms",
        "maximumPeakRssMb",
    )
    minimum_runs = thresholds.get("minimumColdStartRuns")
    if (
        not _rate(thresholds.get("minimumOverallPassRate"))
        or not _rate(thresholds.get("maximumStartupFailureRate"))
        or any(
            not _non_negative_number(thresholds.get(name))
            or float(thresholds[name]) <= 0
            for name in positive_names
        )
        or not isinstance(minimum_runs, int)
        or isinstance(minimum_runs, bool)
        or minimum_runs <= 0
    ):
        reasons.append("owner_thresholds_invalid")
    precision = thresholds.get("minimumPrecisionByPiiType")
    recall = thresholds.get("minimumRecallByPiiType")
    if not _valid_rate_map(precision) or not _valid_rate_map(recall):
        reasons.append("owner_threshold_coverage_invalid")
    elif promotion_scope is not None and (
        set(precision) != promotion_scope["requiredPiiTypes"]
        or set(recall) != promotion_scope["requiredPiiTypes"]
    ):
        reasons.append("owner_threshold_coverage_incomplete")
    if reasons:
        return reasons, None, None
    return reasons, thresholds, promotion_scope


def _artifact_verification_reasons(
    evidence: Mapping[str, Any] | None,
    manifest: Mapping[str, Any],
    manifest_binding: Mapping[str, Any] | None,
) -> list[str]:
    if manifest_binding is None:
        return ["model_manifest_invalid"]
    if evidence is None:
        return ["artifact_verification_missing"]
    reasons = _binding_reasons(evidence, manifest_binding)
    if set(evidence) != {
        "schemaVersion",
        "aggregateOnly",
        "filesExpected",
        "filesVerified",
        "checksumFailures",
        "evidenceBinding",
    }:
        reasons.append("artifact_verification_shape_invalid")
    if evidence.get("schemaVersion") != "pii-artifact-verification.v1":
        reasons.append("artifact_verification_version_invalid")
    if evidence.get("aggregateOnly") is not True:
        reasons.append("artifact_verification_not_aggregate_only")
    expected = manifest_binding["expectedFiles"]
    files_expected = evidence.get("filesExpected")
    files_verified = evidence.get("filesVerified")
    checksum_failures = evidence.get("checksumFailures")
    if not _positive_integer(files_expected) or files_expected != expected:
        reasons.append("artifact_file_count_mismatch")
    if (
        not _non_negative_integer(files_verified)
        or files_verified != expected
        or not _non_negative_integer(checksum_failures)
        or checksum_failures != 0
    ):
        reasons.append("artifact_checksum_verification_failed")
    return reasons


def _quality_reasons(
    quality: Mapping[str, Any],
    thresholds: Mapping[str, Any] | None,
    promotion_scope: Mapping[str, frozenset[str]] | None,
    manifest_binding: Mapping[str, Any] | None,
) -> list[str]:
    reasons = _binding_reasons(quality, manifest_binding)
    quality_scope = quality.get("scope")
    if not isinstance(quality_scope, Mapping) or set(quality_scope) != {
        "piiTypes",
        "locales",
    }:
        reasons.append("quality_scope_missing")
    else:
        pii_types = quality_scope.get("piiTypes")
        locales = quality_scope.get("locales")
        if not _valid_unique_string_list(pii_types, pii_type=True) or not _valid_unique_string_list(
            locales, pii_type=False
        ):
            reasons.append("quality_scope_invalid")
        elif promotion_scope is None:
            reasons.append("quality_scope_not_applied")
        elif (
            set(pii_types) != promotion_scope["requiredPiiTypes"]
            or set(locales) != promotion_scope["requiredLocales"]
        ):
            reasons.append("quality_scope_mismatch")
    corpus = quality.get("corpus")
    if not isinstance(corpus, Mapping) or corpus.get("untouchedHoldout") is not True:
        reasons.append("untouched_holdout_missing")
    if not isinstance(corpus, Mapping) or corpus.get("governanceApproved") is not True:
        reasons.append("holdout_governance_missing")
    metric_unit = str(quality.get("metricUnit", "")).lower()
    if "span-level" not in metric_unit or "not span-level" in metric_unit:
        reasons.append("span_level_metrics_missing")
    ablation = quality.get("ablation")
    if (
        not isinstance(ablation, Mapping)
        or ablation.get("rulesOnlyMeasured") is not True
        or ablation.get("hybridMeasured") is not True
        or ablation.get("incrementalBenefitMeasured") is not True
    ):
        reasons.append("rules_hybrid_ablation_missing")
    if "not production-grade" in str(quality.get("promotionDecision", "")).lower():
        reasons.append("quality_self_assessment_blocked")
    overall = quality.get("overall")
    by_type = quality.get("byPiiType")
    if not isinstance(overall, Mapping) or not _rate(overall.get("passRate")):
        reasons.append("quality_metrics_invalid")
    if not isinstance(by_type, Mapping) or not by_type:
        reasons.append("per_type_quality_missing")
    if thresholds is None:
        reasons.append("quality_thresholds_not_applied")
        return reasons
    if isinstance(overall, Mapping) and _rate(overall.get("passRate")):
        minimum_pass = thresholds.get("minimumOverallPassRate")
        if _non_negative_number(minimum_pass) and float(overall["passRate"]) < float(minimum_pass):
            reasons.append("overall_quality_below_owner_threshold")
    if isinstance(by_type, Mapping) and by_type:
        reasons.extend(_per_type_threshold_reasons(by_type, thresholds))
    return reasons


def _per_type_threshold_reasons(
    by_type: Mapping[str, Any], thresholds: Mapping[str, Any]
) -> list[str]:
    precision_thresholds = thresholds.get("minimumPrecisionByPiiType")
    recall_thresholds = thresholds.get("minimumRecallByPiiType")
    if not isinstance(precision_thresholds, Mapping) or not isinstance(recall_thresholds, Mapping):
        return ["owner_threshold_coverage_invalid"]
    measured_types = set(by_type)
    if measured_types != set(precision_thresholds) or measured_types != set(recall_thresholds):
        return ["owner_threshold_coverage_incomplete"]
    reasons: list[str] = []
    for pii_type, metrics in by_type.items():
        if not isinstance(metrics, Mapping):
            reasons.append("per_type_quality_invalid")
            continue
        precision = metrics.get("precision")
        recall = metrics.get("recall")
        if not _rate(precision) or not _rate(recall):
            reasons.append("per_type_quality_invalid")
            continue
        if float(precision) < float(precision_thresholds[pii_type]):
            reasons.append("precision_below_owner_threshold")
        if float(recall) < float(recall_thresholds[pii_type]):
            reasons.append("recall_below_owner_threshold")
    return reasons


def _benchmark_reasons(
    benchmark: Mapping[str, Any] | None,
    thresholds: Mapping[str, Any] | None,
    manifest_binding: Mapping[str, Any] | None,
) -> list[str]:
    if benchmark is None:
        return ["warm_runtime_evidence_missing"]
    reasons = _binding_reasons(benchmark, manifest_binding)
    metadata = benchmark.get("metadata")
    if not isinstance(metadata, Mapping) or metadata.get("reportVersion") != "ai-safety-resource-latency-benchmark.v2":
        reasons.append("warm_runtime_evidence_version_invalid")
    binding = benchmark.get("evidenceBinding")
    if isinstance(metadata, Mapping) and isinstance(binding, Mapping):
        try:
            normalized_binding = validate_evidence_binding(binding)
        except EvidenceBindingError:
            normalized_binding = None
        if (
            normalized_binding is not None
            and metadata.get("gitSha") != normalized_binding["gitRevision"]
        ):
            reasons.append("warm_runtime_git_revision_mismatch")
    runtime = _selected_runtime(benchmark)
    decision = benchmark.get("decisionSummary")
    if runtime is None or runtime.get("status") != "pass":
        reasons.append("warm_runtime_gate_failed")
    if not isinstance(decision, Mapping):
        reasons.append("warm_runtime_decision_missing")
    else:
        required_pass_gates = (
            "sidecarLatencyGate",
            "targetLatencyGate",
            "evidenceCompletenessGate",
            "rawValueExposureGate",
        )
        if any(decision.get(name) != "pass" for name in required_pass_gates) or decision.get(
            "timeoutFallbackGate"
        ) not in {"pass", "not_exercised"}:
            reasons.append("warm_runtime_observation_incomplete")
    if thresholds is None:
        reasons.append("warm_runtime_thresholds_not_applied")
    elif runtime is not None:
        p95 = runtime.get("p95SidecarLatencyMs")
        peak = runtime.get("resource", {}).get("peakRssMb") if isinstance(runtime.get("resource"), Mapping) else None
        if not _non_negative_number(p95) or float(p95) > float(thresholds["maximumWarmSidecarP95Ms"]):
            reasons.append("warm_latency_above_owner_threshold")
        if not _non_negative_number(peak) or float(peak) > float(thresholds["maximumPeakRssMb"]):
            reasons.append("warm_memory_above_owner_threshold")
    return reasons


def _cold_start_reasons(
    evidence: Mapping[str, Any] | None,
    thresholds: Mapping[str, Any] | None,
    manifest_binding: Mapping[str, Any] | None,
) -> list[str]:
    if evidence is None:
        return ["cold_runtime_evidence_missing"]
    reasons = _binding_reasons(evidence, manifest_binding)
    if set(evidence) != {
        "schemaVersion",
        "aggregateOnly",
        "runs",
        "successfulRuns",
        "failedRuns",
        "startupFailureRate",
        "coldP50Ms",
        "coldP95Ms",
        "peakRssMb",
        "evidenceBinding",
        "contentSafety",
    }:
        reasons.append("cold_runtime_shape_invalid")
    if evidence.get("schemaVersion") != "pii-repeated-cold-evidence.v1":
        reasons.append("cold_runtime_evidence_version_invalid")
    if evidence.get("aggregateOnly") is not True:
        reasons.append("cold_runtime_not_aggregate_only")
    expected_content_safety = {
        "rawContentIncluded": False,
        "requestIdentifiersIncluded": False,
        "endpointLocationsIncluded": False,
        "artifactDigestsIncluded": False,
        "childErrorDetailIncluded": False,
    }
    if evidence.get("contentSafety") != expected_content_safety:
        reasons.append("cold_runtime_content_safety_invalid")
    runs = evidence.get("runs")
    successful_runs = evidence.get("successfulRuns")
    failed_runs = evidence.get("failedRuns")
    counts_valid = (
        _positive_integer(runs)
        and _non_negative_integer(successful_runs)
        and _non_negative_integer(failed_runs)
        and successful_runs + failed_runs == runs
    )
    if not counts_valid:
        reasons.append("cold_run_counts_inconsistent")
    failure_rate = evidence.get("startupFailureRate")
    if (
        not counts_valid
        or not _rate(failure_rate)
        or abs(float(failure_rate) - round(failed_runs / runs, 6)) > 0.0000005
    ):
        reasons.append("cold_failure_rate_inconsistent")
    cold_p50 = evidence.get("coldP50Ms")
    cold_p95 = evidence.get("coldP95Ms")
    peak_rss = evidence.get("peakRssMb")
    if counts_valid and successful_runs > 0:
        if (
            not _non_negative_integer(cold_p50)
            or not _non_negative_integer(cold_p95)
            or cold_p50 > cold_p95
            or not _finite_number(peak_rss)
            or float(peak_rss) <= 0
        ):
            reasons.append("cold_percentiles_inconsistent")
    elif cold_p50 is not None or cold_p95 is not None or peak_rss is not None:
        reasons.append("cold_percentiles_inconsistent")
    if thresholds is None:
        reasons.append("cold_runtime_thresholds_not_applied")
        return reasons
    if not _positive_integer(runs) or runs < thresholds["minimumColdStartRuns"]:
        reasons.append("cold_run_count_below_owner_threshold")
    if not _rate(failure_rate) or float(failure_rate) > float(thresholds["maximumStartupFailureRate"]):
        reasons.append("cold_failure_rate_above_owner_threshold")
    if not _non_negative_number(cold_p95) or float(cold_p95) > float(thresholds["maximumColdP95Ms"]):
        reasons.append("cold_latency_above_owner_threshold")
    if not _non_negative_number(peak_rss) or float(peak_rss) > float(thresholds["maximumPeakRssMb"]):
        reasons.append("cold_memory_above_owner_threshold")
    return reasons


def _tenant_chat_e2e_reasons(
    evidence: Mapping[str, Any] | None,
    manifest_binding: Mapping[str, Any] | None,
) -> list[str]:
    if evidence is None:
        return ["tenant_chat_e2e_evidence_missing"]
    reasons = _binding_reasons(evidence, manifest_binding)
    if set(evidence) != {
        "schemaVersion",
        "aggregateOnly",
        "tenantChatPathVerified",
        "modelInvocationObserved",
        "enforceRedactionVerified",
        "blockProviderSuppressionVerified",
        "fallbackObserved",
        "noRawPersistenceVerified",
        "evidenceBinding",
    }:
        reasons.append("tenant_chat_e2e_shape_invalid")
    if evidence.get("schemaVersion") != "pii-tenant-chat-model-e2e.v1":
        reasons.append("tenant_chat_e2e_version_invalid")
    if evidence.get("aggregateOnly") is not True:
        reasons.append("tenant_chat_e2e_not_aggregate_only")
    required_flags = (
        "tenantChatPathVerified",
        "modelInvocationObserved",
        "enforceRedactionVerified",
        "blockProviderSuppressionVerified",
        "fallbackObserved",
        "noRawPersistenceVerified",
    )
    if any(evidence.get(flag) is not True for flag in required_flags):
        reasons.append("tenant_chat_e2e_gate_failed")
    return reasons


def _binding_reasons(
    evidence: Mapping[str, Any], manifest_binding: Mapping[str, Any] | None
) -> list[str]:
    if manifest_binding is None:
        return ["model_manifest_invalid"]
    binding = evidence.get("evidenceBinding")
    if not isinstance(binding, Mapping):
        return ["provenance_binding_missing"]
    try:
        normalized_binding = validate_evidence_binding(binding)
    except EvidenceBindingError:
        return ["provenance_binding_invalid"]
    reasons: list[str] = []
    if normalized_binding["manifestVersion"] != manifest_binding["manifestVersion"]:
        reasons.append("manifest_version_mismatch")
    if normalized_binding["modelRevisions"] != manifest_binding["modelRevisions"]:
        reasons.append("model_revision_mismatch")
    return reasons


def _git_revision_consistency_reasons(
    *artifacts: Mapping[str, Any] | None,
) -> list[str]:
    revisions: set[str] = set()
    for artifact in artifacts:
        if not isinstance(artifact, Mapping):
            continue
        binding = artifact.get("evidenceBinding")
        if not isinstance(binding, Mapping):
            continue
        revision = _non_empty_string(binding.get("gitRevision"))
        if revision is not None:
            revisions.add(revision)
    return ["git_revision_mismatch"] if len(revisions) > 1 else []


def _selected_runtime(benchmark: Mapping[str, Any]) -> Mapping[str, Any] | None:
    runtimes = benchmark.get("runtimeResults")
    if not isinstance(runtimes, list):
        return None
    selected = [
        runtime
        for runtime in runtimes
        if isinstance(runtime, Mapping) and runtime.get("status") != "not_run"
    ]
    return selected[0] if len(selected) == 1 else None


def _valid_rate_map(value: Any) -> bool:
    return isinstance(value, Mapping) and bool(value) and all(
        isinstance(key, str)
        and re.fullmatch(r"[a-z][a-z0-9_]*", key) is not None
        and _rate(rate)
        for key, rate in value.items()
    )


def _valid_unique_string_list(value: Any, *, pii_type: bool) -> bool:
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(item, str) for item in value)
        or len(value) != len(set(value))
    ):
        return False
    pattern = (
        re.compile(r"[a-z][a-z0-9_]*")
        if pii_type
        else re.compile(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*")
    )
    return all(
        len(item) <= 64
        and pattern.fullmatch(item) is not None
        for item in value
    )


def _rate(value: Any) -> bool:
    return _finite_number(value) and 0 <= float(value) <= 1


def _non_negative_number(value: Any) -> bool:
    return _finite_number(value) and float(value) >= 0


def _positive_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _non_negative_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def _non_empty_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None
