import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const approvalPaths = Object.freeze({
  artifact: path.join(
    root,
    "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v3.json",
  ),
  promotionReport: path.join(
    root,
    "docs/testing/difficulty-promotion-holdout-100-result.json",
  ),
  approval: path.join(root, "docs/testing/difficulty-live-shadow-owner-approval.json"),
  runbook: path.join(root, "docs/testing/difficulty-live-shadow-runbook.md"),
});

const expectedMemoryGuardrails = Object.freeze({
  containerHardLimitBytes: 2 * 1024 ** 3,
  processRssRollbackThresholdBytes: Math.round(1.25 * 1024 ** 3),
  cgroupCurrentRollbackThresholdBytes: Math.round(1.75 * 1024 ** 3),
  sustainSeconds: 300,
  enforcement: "deployment_platform_required_before_enable",
});

const expectedImmediateTriggers = Object.freeze([
  "container_oom_or_restart",
  "authoritative_routing_or_model_ref_mismatch_count_gte_1",
  "sensitive_data_exposure_count_gte_1",
  "shadow_failure_affects_request_or_provider_path_count_gte_1",
]);

const expectedSustainedTriggers = Object.freeze([
  "process_rss_bytes_gt_1342177280_for_300_seconds",
  "cgroup_current_bytes_gt_1879048192_for_300_seconds",
]);

const expectedRollbackActions = Object.freeze([
  "clear_exact_pair_allowlist_or_set_shadow_enabled_false",
  "restart_gateway",
  "confirm_rule_only_routing_and_provider_health_before_reenable",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireValue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireExactObject(actual, expected, message) {
  requireValue(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function assertNoForbiddenApprovalKeys(value, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoForbiddenApprovalKeys(item, [...pathParts, String(index)]),
    );
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const forbidden = new Set([
    "tenantId",
    "applicationId",
    "requestId",
    "traceId",
    "sampleId",
    "prompt",
    "response",
    "embedding",
    "vector",
    "weights",
    "complexityScore",
    "individualScore",
    "modelRef",
    "providerId",
    "errorDetail",
  ]);
  for (const [key, child] of Object.entries(value)) {
    requireValue(
      !forbidden.has(key),
      `owner approval contains forbidden key ${[...pathParts, key].join(".")}`,
    );
    assertNoForbiddenApprovalKeys(child, [...pathParts, key]);
  }
}

export function validateApproval({ artifactBytes, promotionReport, approval, runbook }) {
  const artifact = JSON.parse(artifactBytes.toString("utf8"));

  requireValue(
    approval.schemaVersion === "gatelm.difficulty-live-shadow-owner-approval.v1" &&
      approval.status === "owner_approved_limited_development_shadow_guardrails" &&
      approval.approvedOn === "2026-07-15",
    "unsupported or incomplete live-shadow owner approval",
  );
  requireValue(
    approval.approval?.scope === "limited_development_exact_pair_live_shadow_guardrails" &&
      approval.approval?.basis === "explicit_routing_owner_approval_in_current_codex_task" &&
      approval.approval?.humanReviewerCount === 1 &&
      approval.approval?.reviewerIdentityStored === false,
    "owner approval provenance drifted",
  );
  requireValue(
    approval.integratedBaselineCommit === "b0815249b1b79b253a8c4216dc6705eb98c95af4",
    "owner approval integrated baseline drifted",
  );

  for (const field of [
    "artifactVersion",
    "bundleHash",
    "contentHash",
    "thresholdPolicyVersion",
    "threshold",
    "totalDimension",
  ]) {
    requireValue(
      approval.artifact?.[field] === artifact[field] &&
        approval.artifact?.[field] === promotionReport.artifact?.[field],
      `owner-approved artifact ${field} drifted`,
    );
  }
  requireValue(
    approval.artifact?.artifactFileSha256 === sha256(artifactBytes) &&
      approval.artifact?.artifactFileSha256 === promotionReport.artifact?.artifactFileSha256,
    "owner-approved artifact file identity drifted",
  );
  requireValue(
    approval.artifact?.executionShapePolicyVersion ===
      promotionReport.executionShape?.policyVersion &&
      approval.artifact?.executionUnit === promotionReport.executionShape?.unit &&
      approval.artifact?.batchSize === promotionReport.executionShape?.batchSize,
    "owner-approved single-request execution shape drifted",
  );

  requireValue(
    approval.scope?.limitedDevelopmentExactPairsOnly === true &&
      approval.scope?.authoritativeRouting === "rule_based" &&
      approval.scope?.productRoutingPromotionApproved === false &&
      approval.scope?.holdoutPromotionGatePassed === false &&
      approval.scope?.liveEvidenceStillRequired === true,
    "live-shadow approval scope widened",
  );
  requireValue(
    promotionReport.status === "promotion_holdout_gate_failed_artifact_unchanged" &&
      promotionReport.gate?.passed === false &&
      promotionReport.productRuntimeChanged === false &&
      promotionReport.runtimePromotionAutomatic === false,
    "failed promotion gate must remain authoritative",
  );

  requireExactObject(
    approval.ownerApprovedMemoryGuardrails,
    expectedMemoryGuardrails,
    "owner-approved memory guardrails drifted",
  );
  requireValue(
    approval.diagnosticMemoryEvidence?.runCount === 3 &&
      approval.diagnosticMemoryEvidence?.observedPeakRssBytes === 1008566272 &&
      approval.diagnosticMemoryEvidence?.observedPeakCgroupCurrentBytes === 1540128768 &&
      approval.diagnosticMemoryEvidence?.evidenceRole ===
        "diagnostic_runtime_measurement_not_promotion_evidence",
    "diagnostic memory context drifted",
  );
  requireExactObject(
    approval.rollback?.immediateTriggers,
    expectedImmediateTriggers,
    "immediate rollback triggers drifted",
  );
  requireExactObject(
    approval.rollback?.sustainedTriggers,
    expectedSustainedTriggers,
    "sustained rollback triggers drifted",
  );
  requireExactObject(
    approval.rollback?.actions,
    expectedRollbackActions,
    "rollback actions drifted",
  );
  requireValue(
    approval.rollback?.automaticProductPromotion === false &&
      approval.doesNotApprove?.includes("ml_authoritative_routing") &&
      approval.doesNotApprove?.includes("runtime_model_selection_change") &&
      approval.doesNotApprove?.includes("retuning_on_consumed_holdout") &&
      approval.doesNotApprove?.includes("production_or_global_shadow_enablement"),
    "owner approval exclusions drifted",
  );
  requireValue(
    approval.dataSafety?.aggregateOnly === true &&
      approval.dataSafety?.containsRawPromptOrResponse === false &&
      approval.dataSafety?.containsEmbeddingOrFeatureMaterial === false &&
      approval.dataSafety?.containsModelParameters === false &&
      approval.dataSafety?.containsIndividualScores === false &&
      approval.dataSafety?.containsTenantOrApplicationIdentifiers === false,
    "owner approval data-safety declaration is unsafe",
  );
  assertNoForbiddenApprovalKeys(approval);

  for (const requiredText of [
    "owner guardrails approved, live evidence pending",
    "2 GiB",
    "2147483648",
    "1.25 GiB",
    "1342177280",
    "1.75 GiB",
    "1879048192",
    "5 minutes",
    "GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES",
    "GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=false",
    "failed promotion gate",
  ]) {
    requireValue(runbook.includes(requiredText), `live-shadow runbook is missing ${requiredText}`);
  }
}

export function verifyCanonicalApproval(paths = approvalPaths) {
  const artifactBytes = readFileSync(paths.artifact);
  const promotionReport = JSON.parse(readFileSync(paths.promotionReport, "utf8"));
  const approval = JSON.parse(readFileSync(paths.approval, "utf8"));
  const runbook = readFileSync(paths.runbook, "utf8");
  validateApproval({ artifactBytes, promotionReport, approval, runbook });
  return approval;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const approval = verifyCanonicalApproval();
  console.log(
    `difficulty live-shadow owner approval verified (${approval.status}, hard limit ${approval.ownerApprovedMemoryGuardrails.containerHardLimitBytes} bytes)`,
  );
}
