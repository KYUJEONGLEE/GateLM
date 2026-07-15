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
  supersession: path.join(
    root,
    "docs/testing/difficulty-live-shadow-boundary-supersession.json",
  ),
  baselineWaiver: path.join(
    root,
    "docs/testing/difficulty-live-shadow-baseline-e2e-waiver.json",
  ),
  runbook: path.join(root, "docs/testing/difficulty-live-shadow-runbook.md"),
  semanticModel: path.join(
    root,
    "apps/gateway-core/internal/domain/routing/difficulty_semantic_model.go",
  ),
  gatewayConfig: path.join(root, "apps/gateway-core/internal/config/config.go"),
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

const expectedBaselineRollbackActions = Object.freeze([
  "clear_exact_pair_allowlist_or_set_shadow_enabled_false",
  "clear_baseline_waiver",
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

export function validateApproval({
  artifactBytes,
  promotionReport,
  approvalBytes,
  approval,
  supersessionBytes,
  supersession,
  baselineWaiver,
  runbook,
  semanticModel,
  gatewayConfig,
}) {
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

  requireValue(
    supersession?.schemaVersion ===
      "gatelm.difficulty-live-shadow-boundary-supersession.v1" &&
      supersession.status === "historical_owner_approval_inapplicable_to_current_boundary" &&
      supersession.evaluatedOn === "2026-07-15" &&
      supersession.priorApproval?.status === approval.status &&
      supersession.priorApproval?.fileSha256 === sha256(approvalBytes),
    "live-shadow boundary supersession provenance drifted",
  );
  for (const field of [
    "artifactVersion",
    "bundleHash",
    "contentHash",
    "thresholdPolicyVersion",
    "threshold",
  ]) {
    requireValue(
      supersession.artifact?.[field] === approval.artifact?.[field],
      `live-shadow boundary supersession artifact ${field} drifted`,
    );
  }
  requireValue(
    supersession.decisionBoundary?.artifactTrainingBoundaryVersion ===
      "difficulty-decision-boundary.payload-empty-separate-score-3.2026-07-15.v1" &&
      supersession.decisionBoundary?.currentGatewayBoundaryVersion ===
        "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2" &&
      supersession.decisionBoundary?.compatible === false &&
      supersession.enforcement?.checkedBeforeEncoderCreation === true &&
      supersession.enforcement?.currentLiveShadowEnabled === false &&
      supersession.enforcement?.currentProductRouting === "rule_based" &&
      supersession.enforcement?.productRuntimeChanged === false &&
      supersession.enforcement?.newExactBoundaryArtifactAndOwnerApprovalRequired === true,
    "live-shadow boundary supersession drifted",
  );
  requireValue(
    supersession.reportMaterial?.aggregateOnly === true &&
      supersession.reportMaterial?.containsRawPromptOrResponse === false &&
      supersession.reportMaterial?.containsEmbeddingOrFeatureMaterial === false &&
      supersession.reportMaterial?.containsModelParameters === false &&
      supersession.reportMaterial?.containsIndividualScores === false &&
      supersession.reportMaterial?.containsTenantOrApplicationIdentifiers === false,
    "live-shadow boundary supersession data-safety declaration is unsafe",
  );
  assertNoForbiddenApprovalKeys(supersession);

  requireValue(
    baselineWaiver?.schemaVersion ===
      "gatelm.difficulty-live-shadow-baseline-e2e-waiver.v1" &&
      baselineWaiver.status === "owner_approved_one_time_baseline_e2e_shadow_waiver" &&
      baselineWaiver.approvedOn === "2026-07-15" &&
      baselineWaiver.approval?.scope ===
        "limited_development_exact_pair_baseline_e2e_shadow_only" &&
      baselineWaiver.approval?.basis ===
        "explicit_routing_owner_instruction_in_current_codex_task" &&
      baselineWaiver.approval?.humanReviewerCount === 1 &&
      baselineWaiver.approval?.reviewerIdentityStored === false,
    "baseline E2E waiver approval provenance drifted",
  );
  requireValue(
    baselineWaiver.waiver?.id ===
      "difficulty-shadow-baseline-e2e-v3.2026-07-15.v1" &&
      baselineWaiver.waiver?.purpose ===
        "gateway_tokenizer_encoder_pooling_pca_118d_score_aggregate_metric_e2e_only" &&
      baselineWaiver.waiver?.exactArtifactIdentityOnly === true &&
      baselineWaiver.waiver?.decisionBoundaryMismatchAcknowledged === true &&
      baselineWaiver.waiver?.reusableForOtherArtifacts === false &&
      baselineWaiver.waiver?.activationEnvironmentVariable ===
        "GATEWAY_DIFFICULTY_E5_SHADOW_BASELINE_WAIVER" &&
      baselineWaiver.waiver?.defaultEnabled === false,
    "baseline E2E waiver widened or drifted",
  );
  requireValue(
    baselineWaiver.priorGuardrails?.ownerApprovalFileSha256 === sha256(approvalBytes) &&
      baselineWaiver.priorGuardrails?.boundarySupersessionFileSha256 ===
        sha256(supersessionBytes) &&
      baselineWaiver.priorGuardrails?.ownerReconfirmedWithoutWidening === true,
    "baseline E2E waiver guardrail provenance drifted",
  );
  for (const field of [
    "artifactVersion",
    "bundleHash",
    "contentHash",
    "artifactFileSha256",
    "thresholdPolicyVersion",
    "threshold",
    "totalDimension",
  ]) {
    requireValue(
      baselineWaiver.artifact?.[field] === approval.artifact?.[field],
      `baseline E2E waiver artifact ${field} drifted`,
    );
  }
  requireValue(
    baselineWaiver.artifact?.artifactTrainingBoundaryVersion ===
      supersession.decisionBoundary?.artifactTrainingBoundaryVersion &&
      baselineWaiver.artifact?.currentGatewayBoundaryVersion ===
        supersession.decisionBoundary?.currentGatewayBoundaryVersion,
    "baseline E2E waiver boundary identity drifted",
  );
  requireValue(
    baselineWaiver.scope?.limitedDevelopmentExactPairsOnly === true &&
      baselineWaiver.scope?.authoritativeRouting === "rule_based" &&
      baselineWaiver.scope?.productRoutingPromotionApproved === false &&
      baselineWaiver.scope?.qualityPromotionApproved === false &&
      baselineWaiver.scope?.failedAccuracyGateWaivedForThisBaselineE2EOnly === true &&
      baselineWaiver.scope?.futureArtifactAccuracyGateRequired === true &&
      baselineWaiver.scope?.futureMinimumAccuracy === 0.91 &&
      baselineWaiver.scope?.futureMaximumComplexToSimpleCount === 1 &&
      baselineWaiver.scope?.futureCategoryNonRegressionRequired === true &&
      baselineWaiver.scope?.liveEvidenceStillRequired === true,
    "baseline E2E waiver scope widened",
  );
  requireValue(
    baselineWaiver.qualityEvidence?.holdoutRecords === 100 &&
      baselineWaiver.qualityEvidence?.observedAccuracy ===
        promotionReport.selectedCandidateClassification?.accuracy &&
      baselineWaiver.qualityEvidence?.minimumAccuracy ===
        promotionReport.gate?.minimumAccuracy?.minimum &&
      baselineWaiver.qualityEvidence?.observedSimpleToComplexCount ===
        promotionReport.selectedCandidateClassification?.simpleToComplexCount &&
      baselineWaiver.qualityEvidence?.observedComplexToSimpleCount ===
        promotionReport.selectedCandidateClassification?.complexToSimpleCount &&
      baselineWaiver.qualityEvidence?.maximumComplexToSimpleCount ===
        promotionReport.gate?.maximumComplexToSimpleCount?.maximum &&
      baselineWaiver.qualityEvidence?.promotionGatePassed === false &&
      baselineWaiver.qualityEvidence?.evidenceRole ===
        "failed_baseline_quality_evidence_not_overridden",
    "baseline E2E waiver quality failure evidence drifted",
  );
  requireExactObject(
    baselineWaiver.ownerApprovedMemoryGuardrails,
    expectedMemoryGuardrails,
    "baseline E2E waiver memory guardrails drifted",
  );
  requireExactObject(
    baselineWaiver.rollback?.immediateTriggers,
    expectedImmediateTriggers,
    "baseline E2E waiver immediate rollback triggers drifted",
  );
  requireExactObject(
    baselineWaiver.rollback?.sustainedTriggers,
    expectedSustainedTriggers,
    "baseline E2E waiver sustained rollback triggers drifted",
  );
  requireExactObject(
    baselineWaiver.rollback?.actions,
    expectedBaselineRollbackActions,
    "baseline E2E waiver rollback actions drifted",
  );
  requireValue(
    baselineWaiver.rollback?.automaticProductPromotion === false &&
      baselineWaiver.activation?.requiresGlobalEnable === true &&
      baselineWaiver.activation?.requiresNonEmptyExactPairAllowlist === true &&
      baselineWaiver.activation?.requiresExactBaselineWaiver === true &&
      baselineWaiver.activation?.wildcardsAllowed === false &&
      baselineWaiver.activation?.maximumDevelopmentPairs === 3 &&
      baselineWaiver.activation?.startupSmokeTimeoutSeconds === 30 &&
      baselineWaiver.activation?.requestTimeoutMilliseconds === 100 &&
      baselineWaiver.activation?.shadowFailureMayAffectRequestOrProvider === false &&
      baselineWaiver.doesNotApprove?.includes("ml_authoritative_routing") &&
      baselineWaiver.doesNotApprove?.includes("runtime_model_selection_change") &&
      baselineWaiver.doesNotApprove?.includes("quality_gate_pass") &&
      baselineWaiver.doesNotApprove?.includes("future_artifact_waiver") &&
      baselineWaiver.doesNotApprove?.includes("production_or_global_shadow_enablement"),
    "baseline E2E waiver activation or exclusion guardrails drifted",
  );
  requireValue(
    baselineWaiver.dataSafety?.aggregateOnly === true &&
      baselineWaiver.dataSafety?.containsRawPromptOrResponse === false &&
      baselineWaiver.dataSafety?.containsEmbeddingOrFeatureMaterial === false &&
      baselineWaiver.dataSafety?.containsModelParameters === false &&
      baselineWaiver.dataSafety?.containsIndividualScores === false &&
      baselineWaiver.dataSafety?.containsTenantOrApplicationIdentifiers === false,
    "baseline E2E waiver data-safety declaration is unsafe",
  );
  assertNoForbiddenApprovalKeys(baselineWaiver);
  requireValue(
    semanticModel.includes(
      'DifficultySemanticShadowBaselineE2EWaiverV3 = "difficulty-shadow-baseline-e2e-v3.2026-07-15.v1"',
    ) &&
      semanticModel.includes("DifficultySemanticShadowBaselineWaiverAccepted") &&
      gatewayConfig.includes('envString("GATEWAY_DIFFICULTY_E5_SHADOW_BASELINE_WAIVER", "")'),
    "baseline E2E waiver runtime admission drifted",
  );

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
    "difficulty-shadow-baseline-e2e-v3.2026-07-15.v1",
    "GATEWAY_DIFFICULTY_E5_SHADOW_BASELINE_WAIVER",
    "accuracy `0.70`",
    "future artifact",
  ]) {
    requireValue(runbook.includes(requiredText), `live-shadow runbook is missing ${requiredText}`);
  }
}

export function verifyCanonicalApproval(paths = approvalPaths) {
  const artifactBytes = readFileSync(paths.artifact);
  const promotionReport = JSON.parse(readFileSync(paths.promotionReport, "utf8"));
  const approvalBytes = readFileSync(paths.approval);
  const approval = JSON.parse(approvalBytes.toString("utf8"));
  const supersessionBytes = readFileSync(paths.supersession);
  const supersession = JSON.parse(supersessionBytes.toString("utf8"));
  const baselineWaiver = JSON.parse(readFileSync(paths.baselineWaiver, "utf8"));
  const runbook = readFileSync(paths.runbook, "utf8");
  const semanticModel = readFileSync(paths.semanticModel, "utf8");
  const gatewayConfig = readFileSync(paths.gatewayConfig, "utf8");
  validateApproval({
    artifactBytes,
    promotionReport,
    approvalBytes,
    approval,
    supersessionBytes,
    supersession,
    baselineWaiver,
    runbook,
    semanticModel,
    gatewayConfig,
  });
  return { approval, supersession, baselineWaiver };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { approval, supersession, baselineWaiver } = verifyCanonicalApproval();
  console.log(
    `difficulty live-shadow owner guardrails and baseline E2E waiver verified (${approval.status}; ${supersession.status}; ${baselineWaiver.status}; hard limit ${approval.ownerApprovedMemoryGuardrails.containerHardLimitBytes} bytes)`,
  );
}
