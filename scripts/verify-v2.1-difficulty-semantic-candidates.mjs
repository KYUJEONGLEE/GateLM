import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateDirectory = "scripts/routing_difficulty_model/artifacts/candidates";
const reportPath = `${candidateDirectory}/difficulty-candidate-comparison.owner-approved-500.v3.json`;
const semanticHeadsPath = `${candidateDirectory}/difficulty-semantic-heads.owner-approved-500.v2.json`;
const policyPath = "scripts/routing_difficulty_model/training-policy.semantic-candidates.v3.json";
const encoderManifestPath =
  "scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json";
const datasetManifestPath =
  "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json";
const candidateArtifacts = [
  {
    name: "42d-rule-vector-v1",
    dimension: 42,
    path: `${candidateDirectory}/difficulty-candidate-a-42d.owner-approved-500.v3.json`,
  },
  {
    name: "42d-rule-vector-v1-plus-projection",
    dimension: 106,
    path: `${candidateDirectory}/difficulty-candidate-b-106d.owner-approved-500.v3.json`,
  },
  {
    name: "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities",
    dimension: 118,
    path: `${candidateDirectory}/difficulty-candidate-c-118d.owner-approved-500.v3.json`,
  },
];
const expectedSplitRecords = { train: 300, calibration: 100, holdout: 100 };
const forbiddenReportKeys = new Set([
  "redactedPrompt",
  "instructionText",
  "payloadText",
  "rawEmbedding",
  "projectedEmbedding",
  "semanticHeadProbabilities",
  "vector",
  "rawProbability",
  "logit",
  "featureContributions",
  "sampleId",
  "perSample",
]);

function readJson(rootDir, relativePath, failures) {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, ...relativePath.split("/")), "utf8"));
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function splitRecords(value) {
  return Object.fromEntries(
    Object.keys(expectedSplitRecords).map((split) => [split, value?.[split]?.records]),
  );
}

function splitSamples(value) {
  return Object.fromEntries(
    Object.keys(expectedSplitRecords).map((split) => [split, value?.[split]?.samples]),
  );
}

function sameSplitCounts(left, right) {
  return Object.keys(expectedSplitRecords).every(
    (split) =>
      left?.[split]?.records === right?.[split]?.records &&
      left?.[split]?.families === right?.[split]?.families,
  );
}

function selectedCalibrationEvaluation(candidateReport) {
  const selectedType = candidateReport?.training?.calibrationSelection?.selectedType;
  return candidateReport?.training?.calibrationSelection?.candidates?.find(
    (candidate) => candidate?.type === selectedType && candidate?.status === "valid",
  );
}

function selectByCalibrationEvidence(candidateReports, tolerance) {
  if (!Number.isFinite(tolerance) || tolerance < 0) return null;
  const scored = Object.entries(candidateReports).map(([name, report]) => ({
    name,
    logLoss: report?.selectionEvidence?.groupCvLogLoss,
    brierScore: report?.selectionEvidence?.groupCvBrierScore,
    dimension: report?.totalDimension,
  }));
  if (
    scored.length === 0 ||
    scored.some(
      ({ logLoss, brierScore, dimension }) =>
        !Number.isFinite(logLoss) ||
        logLoss < 0 ||
        !Number.isFinite(brierScore) ||
        brierScore < 0 ||
        !Number.isInteger(dimension) ||
        dimension <= 0,
    )
  ) {
    return null;
  }
  const bestLogLoss = Math.min(...scored.map(({ logLoss }) => logLoss));
  let contenders = scored.filter(({ logLoss }) => Math.abs(logLoss - bestLogLoss) <= tolerance);
  const bestBrier = Math.min(...contenders.map(({ brierScore }) => brierScore));
  contenders = contenders.filter(({ brierScore }) => Math.abs(brierScore - bestBrier) <= tolerance);
  const bestDimension = Math.min(...contenders.map(({ dimension }) => dimension));
  contenders = contenders.filter(({ dimension }) => dimension === bestDimension);
  return contenders.length === 1 ? contenders[0].name : null;
}

function expectedPromotionSafetyGate(candidate, baseline) {
  function comparison(candidateRow, baselineRow) {
    return {
      candidateCount: candidateRow?.complexToSimpleCount,
      baselineCount: baselineRow?.complexToSimpleCount,
      candidateRate: candidateRow?.complexToSimpleRate,
      baselineRate: baselineRow?.complexToSimpleRate,
      passed:
        candidateRow?.complexToSimpleCount <= baselineRow?.complexToSimpleCount &&
        candidateRow?.complexToSimpleRate <= baselineRow?.complexToSimpleRate,
    };
  }
  const candidateCategories = candidate?.byExpectedCategory;
  const baselineCategories = baseline?.byExpectedCategory;
  if (!candidateCategories || !baselineCategories) return null;
  const categories = Object.keys(candidateCategories).sort();
  if (JSON.stringify(categories) !== JSON.stringify(Object.keys(baselineCategories).sort())) return null;
  const overall = comparison(candidate, baseline);
  const byExpectedCategory = Object.fromEntries(
    categories.map((category) => [
      category,
      comparison(candidateCategories[category], baselineCategories[category]),
    ]),
  );
  return {
    policy: "complex_to_simple_non_increase_overall_and_each_expected_category",
    overall,
    byExpectedCategory,
    passed: overall.passed && Object.values(byExpectedCategory).every(({ passed }) => passed),
  };
}

function findForbiddenReportKeys(value, location, failures) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenReportKeys(item, `${location}[${index}]`, failures));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenReportKeys.has(key)) {
      failures.push(`${reportPath}: forbidden report key ${location}.${key}`);
    }
    findForbiddenReportKeys(child, `${location}.${key}`, failures);
  }
}

export function verifyDifficultySemanticCandidates(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const failures = [];
  const report = readJson(rootDir, reportPath, failures);
  const semanticHeads = readJson(rootDir, semanticHeadsPath, failures);
  const policy = readJson(rootDir, policyPath, failures);
  const encoderManifest = readJson(rootDir, encoderManifestPath, failures);
  const datasetManifest = readJson(rootDir, datasetManifestPath, failures);
  const artifacts = candidateArtifacts.map((candidate) => ({
    ...candidate,
    artifact: readJson(rootDir, candidate.path, failures),
  }));
  if (
    !report ||
    !semanticHeads ||
    !policy ||
    !encoderManifest ||
    !datasetManifest ||
    artifacts.some(({ artifact }) => !artifact)
  ) {
    return failures;
  }

  if (
    report.schemaVersion !== "gatelm.difficulty-offline-candidate-comparison.v2" ||
    report.status !==
      "offline_single_request_retraining_with_diagnostic_holdout_not_runtime_promotion" ||
    report.productRuntimeChanged !== false ||
    report.finalPromotionHoldoutRequiredAfterSelection !== true ||
    report.holdoutUsedForCandidateSelection !== false ||
    report.runtimePromotionEligible !== false ||
    !Array.isArray(report.runtimePromotionBlockers) ||
    !report.runtimePromotionBlockers.includes(
      "runtime_packaging_latency_failure_isolation_not_evaluated",
    ) ||
    !report.runtimePromotionBlockers.includes(
      "new_untouched_holdout_required_after_single_request_artifact_change",
    ) ||
    !report.runtimePromotionBlockers.includes("active_runtime_contract_not_approved")
  ) {
    failures.push(`${reportPath}: report identity/runtime boundary is invalid`);
  }
  const expectedExecutionShape = {
    policyVersion: "difficulty-e5-single-request-execution.2026-07-15.v1",
    unit: "single_request",
    batchSize: 1,
    paddingScope: "within_request_only",
    appliesTo: [
      "pca_fit",
      "semantic_head_training",
      "difficulty_candidate_training",
      "calibration",
      "diagnostic_evaluation",
      "gateway_replay",
    ],
  };
  if (
    JSON.stringify(report.executionShape) !== JSON.stringify(expectedExecutionShape) ||
    JSON.stringify(encoderManifest.executionShape) !== JSON.stringify(expectedExecutionShape)
  ) {
    failures.push(`${reportPath}: every embedding stage must use the canonical single-request shape`);
  }
  if (JSON.stringify(splitRecords(report.splitCounts)) !== JSON.stringify(expectedSplitRecords)) {
    failures.push(`${reportPath}: split records must be exactly 300/100/100`);
  }
  if (
    report.datasetVersion !== datasetManifest.datasetVersion ||
    report.datasetSha256 !== datasetManifest.datasetSha256 ||
    report.splitPolicyVersion !== datasetManifest.splitPolicyVersion ||
    report.splitSeed !== datasetManifest.splitSeed ||
    !sameSplitCounts(report.splitCounts, datasetManifest.splitCounts)
  ) {
    failures.push(`${reportPath}: dataset/split provenance does not match the owner-approved manifest`);
  }
  if (
    encoderManifest.dataset?.version !== report.datasetVersion ||
    encoderManifest.dataset?.sha256 !== report.datasetSha256 ||
    encoderManifest.dataset?.splitPolicyVersion !== report.splitPolicyVersion ||
    encoderManifest.dataset?.splitSeed !== report.splitSeed ||
    !sameSplitCounts(encoderManifest.dataset?.splitCounts, report.splitCounts)
  ) {
    failures.push(`${encoderManifestPath}: PCA dataset/split provenance does not match candidate evidence`);
  }
  if (
    policy.policyVersion !==
      "difficulty-logistic-training.semantic-candidates.single-request.2026-07-15.v3" ||
    JSON.stringify(policy.embeddingExecution) !== JSON.stringify(expectedExecutionShape) ||
    policy.splitPolicyVersion !== report.splitPolicyVersion ||
    policy.threshold?.value !== 0.45 ||
    policy.candidateSelection?.policyVersion !==
      "difficulty-semantic-candidate-selection.single-request.2026-07-15.v2" ||
    policy.candidateSelection?.selectionMode !== "fixed_candidate_retrain" ||
    policy.candidateSelection?.fixedCandidate !==
      "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities" ||
    policy.candidateSelection?.evidenceSplit !== "calibration" ||
    policy.candidateSelection?.selectionMetric !==
      "selected_calibrator_group_cv_log_loss" ||
    !Number.isFinite(policy.candidateSelection?.tieTolerance) ||
    policy.candidateSelection.tieTolerance < 0 ||
    JSON.stringify(policy.candidateSelection?.tieBreakers) !==
      JSON.stringify(["selected_calibrator_group_cv_brier_score", "lower_dimension"]) ||
    policy.candidateSelection?.holdoutUsage !==
      "diagnostic_only_after_candidate_freeze_new_untouched_holdout_required" ||
    JSON.stringify(report.selectionPolicy) !== JSON.stringify(policy.candidateSelection)
  ) {
    failures.push(`${policyPath}: semantic candidate training policy is inconsistent`);
  }
  if (
    semanticHeads.schemaVersion !== "gatelm.difficulty-semantic-heads-artifact.v1" ||
    semanticHeads.semanticHeadProbabilityDimension !== 12 ||
    semanticHeads.inputDimension !== 64 ||
    semanticHeads.training?.trainSamples !== 300 ||
    report.semanticHeads?.splits?.calibration?.sampleCount !== 100 ||
    report.semanticHeads?.splits?.holdout !== undefined
  ) {
    failures.push(
      `${semanticHeadsPath}: selection phase must use train 300, calibration 100, no holdout diagnostics, and canonical E5/PCA 64D→12D material`,
    );
  }

  const membershipHashes = new Set();
  for (const { name, dimension, path: artifactPath, artifact } of artifacts) {
    const candidateReport = report.candidates?.[name];
    if (
      artifact.schemaVersion !== "gatelm.difficulty-offline-model-artifact.v1" ||
      artifact.candidateName !== name ||
      artifact.totalDimension !== dimension ||
      artifact.projectionDimension !== 64 ||
      artifact.semanticHeadInputDimension !== 64 ||
      artifact.trainingDatasetVersion !== report.datasetVersion ||
      artifact.trainingDatasetSha256 !== report.datasetSha256 ||
      artifact.splitPolicyVersion !== report.splitPolicyVersion ||
      artifact.trainingPolicyVersion !== policy.policyVersion ||
      artifact.threshold !== 0.45 ||
      artifact.thresholdEquality !== "greater_than_or_equal"
    ) {
      failures.push(`${artifactPath}: candidate identity/dimension/provenance is invalid`);
    }
    if (
      !candidateReport ||
      candidateReport.totalDimension !== dimension ||
      candidateReport.contentHash !== artifact.contentHash ||
      candidateReport.bundleHash !== artifact.bundleHash ||
      JSON.stringify(splitSamples(candidateReport.training?.splitCounts)) !==
        JSON.stringify(expectedSplitRecords) ||
      candidateReport.training?.holdoutEvaluationDeferred !== true ||
      candidateReport.training?.holdout !== undefined ||
      candidateReport.holdoutClassification !== undefined ||
      candidateReport.deltaVsRule !== undefined
    ) {
      failures.push(
        `${reportPath}: ${name} report must match its artifact and defer all holdout outcomes`,
      );
    }
    const calibrationEvaluation = selectedCalibrationEvaluation(candidateReport);
    if (
      candidateReport?.selectionEvidence?.evidenceSplit !== "calibration" ||
      candidateReport?.selectionEvidence?.evaluationMethod !==
        "selected_calibrator_family_grouped_cross_validation" ||
      candidateReport?.selectionEvidence?.selectedCalibratorType !==
        candidateReport?.training?.calibrationSelection?.selectedType ||
      candidateReport?.selectionEvidence?.groupCvLogLoss !== calibrationEvaluation?.logLoss ||
      candidateReport?.selectionEvidence?.groupCvBrierScore !== calibrationEvaluation?.brierScore
    ) {
      failures.push(`${reportPath}: ${name} selection evidence must come only from calibration group-CV`);
    }
    membershipHashes.add(candidateReport?.membershipHash);
  }
  if (membershipHashes.size !== 1 || !membershipHashes.has(report.membershipHash)) {
    failures.push(`${reportPath}: all candidates must share one membership hash`);
  }
  if (
    JSON.stringify(report.candidateDimensions) !==
    JSON.stringify(Object.fromEntries(candidateArtifacts.map(({ name, dimension }) => [name, dimension])))
  ) {
    failures.push(`${reportPath}: candidate dimensions must be exactly 42/106/118`);
  }
  const expectedSelectedCandidate = policy.candidateSelection?.fixedCandidate;
  if (!expectedSelectedCandidate || report.selectedCandidate !== expectedSelectedCandidate) {
    failures.push(`${reportPath}: single-request retraining must preserve the frozen 118D architecture`);
  }
  const selectedArtifact = artifacts.find(({ name }) => name === report.selectedCandidate)?.artifact;
  const freeze = report.selectedCandidateFreeze;
  const finalHoldout = report.finalHoldoutEvaluation;
  const expectedSafetyGate = expectedPromotionSafetyGate(
    finalHoldout?.selectedCandidateClassification,
    finalHoldout?.ruleBaselineClassification,
  );
  if (
    !selectedArtifact ||
    freeze?.candidateName !== report.selectedCandidate ||
    freeze?.artifactVersion !== selectedArtifact.artifactVersion ||
    freeze?.contentHash !== selectedArtifact.contentHash ||
    freeze?.bundleHash !== selectedArtifact.bundleHash ||
    freeze?.calibratorType !== selectedArtifact.calibrator?.type ||
    freeze?.threshold !== selectedArtifact.threshold ||
    finalHoldout?.status !== "diagnostic_replay_after_single_request_artifact_change" ||
    finalHoldout?.accessPolicy !== "previously_observed_holdout_diagnostic_only_not_promotion" ||
    finalHoldout?.candidateName !== report.selectedCandidate ||
    finalHoldout?.artifactVersion !== selectedArtifact.artifactVersion ||
    finalHoldout?.contentHash !== selectedArtifact.contentHash ||
    finalHoldout?.bundleHash !== selectedArtifact.bundleHash ||
    finalHoldout?.samples !== 100 ||
    finalHoldout?.families !== datasetManifest.splitCounts?.holdout?.families ||
    finalHoldout?.selectedCandidateClassification?.samples !== 100 ||
    finalHoldout?.ruleBaselineClassification?.samples !== 100 ||
    !expectedSafetyGate ||
    JSON.stringify(finalHoldout?.promotionSafetyGate) !== JSON.stringify(expectedSafetyGate) ||
    (expectedSafetyGate.passed ===
      report.runtimePromotionBlockers.includes(
        "holdout_per_category_complex_to_simple_regression",
      ))
  ) {
    failures.push(
      `${reportPath}: diagnostic holdout must evaluate only the frozen 118D candidate over all 100 records`,
    );
  }
  findForbiddenReportKeys(report, "report", failures);
  return failures;
}

function main() {
  const failures = verifyDifficultySemanticCandidates();
  if (failures.length > 0) {
    console.error("v2.1 difficulty semantic candidate verification failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log("v2.1 difficulty semantic candidate verification passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
