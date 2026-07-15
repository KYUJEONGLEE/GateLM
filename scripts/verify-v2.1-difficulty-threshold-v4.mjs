import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFrozenHoldoutV2,
  renderFrozenHoldoutV2,
} from "./dev/freeze-v2.1-difficulty-promotion-holdout-v2.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const evidencePaths = Object.freeze({
  sourceArtifact: path.join(
    root,
    "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v3.json",
  ),
  feasibility: path.join(
    root,
    "docs/testing/difficulty-v3-calibration-threshold-feasibility.json",
  ),
  thresholdEvidence: path.join(
    root,
    "docs/testing/difficulty-v4-threshold-selection-evidence.json",
  ),
  candidateArtifact: path.join(
    root,
    "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v4.json",
  ),
  freeze: path.join(
    root,
    "docs/v2.1.0/evaluation/difficulty-promotion-holdout-100.v2.json",
  ),
  result: path.join(
    root,
    "docs/testing/difficulty-promotion-holdout-100-v4-result.json",
  ),
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireValue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateClassification(summary, label, { balancedHoldout = false } = {}) {
  requireValue(summary.samples === 100, `${label} must summarize 100 records`);
  requireValue(
    summary.correct + summary.simpleToComplexCount + summary.complexToSimpleCount === 100,
    `${label} confusion counts do not sum to 100`,
  );
  requireValue(summary.accuracy === summary.correct / 100, `${label} accuracy is inconsistent`);
  requireValue(
    summary.simpleExpectedSamples + summary.complexExpectedSamples === 100,
    `${label} difficulty counts drifted`,
  );
  if (balancedHoldout) {
    requireValue(
      summary.simpleExpectedSamples === 50 && summary.complexExpectedSamples === 50,
      `${label} difficulty balance drifted`,
    );
  }
  requireValue(
    summary.simpleToComplexRate ===
      summary.simpleToComplexCount / summary.simpleExpectedSamples &&
      summary.complexToSimpleRate ===
        summary.complexToSimpleCount / summary.complexExpectedSamples,
    `${label} directional rates are inconsistent`,
  );
  requireValue(
    Object.keys(summary.byExpectedCategory ?? {}).sort().join(",") ===
      "code,general,reasoning,summarization,translation",
    `${label} category coverage drifted`,
  );
  for (const [category, row] of Object.entries(summary.byExpectedCategory)) {
    requireValue(
      row.samples > 0 &&
        row.simpleExpectedSamples + row.complexExpectedSamples === row.samples &&
        row.correct + row.simpleToComplexCount + row.complexToSimpleCount === row.samples,
      `${label} category ${category} counts drifted`,
    );
    if (balancedHoldout) {
      requireValue(
        row.samples === 20 &&
          row.simpleExpectedSamples === 10 &&
          row.complexExpectedSamples === 10,
        `${label} category ${category} balance drifted`,
      );
    }
  }
}

function assertNoForbiddenResultKeys(value, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenResultKeys(item, [...pathParts, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const forbidden = new Set([
    "sampleId",
    "promptFamily",
    "redactedPrompt",
    "instructionText",
    "ruleVectorV1",
    "complexityScore",
    "rawProbability",
    "logit",
    "weights",
    "embedding",
    "vector",
    "individualScore",
  ]);
  for (const [key, child] of Object.entries(value)) {
    requireValue(
      !forbidden.has(key),
      `aggregate threshold-v4 result contains forbidden key ${[...pathParts, key].join(".")}`,
    );
    assertNoForbiddenResultKeys(child, [...pathParts, key]);
  }
}

export function validateThresholdV4Evidence({
  sourceArtifactBytes,
  feasibilityBytes,
  thresholdEvidenceBytes,
  candidateArtifactBytes,
  freezeBytes,
  result,
}) {
  const sourceArtifact = JSON.parse(sourceArtifactBytes.toString("utf8"));
  const feasibility = JSON.parse(feasibilityBytes.toString("utf8"));
  const thresholdEvidence = JSON.parse(thresholdEvidenceBytes.toString("utf8"));
  const candidateArtifact = JSON.parse(candidateArtifactBytes.toString("utf8"));
  const freeze = JSON.parse(freezeBytes.toString("utf8"));

  requireValue(
    feasibility.schemaVersion === "gatelm.difficulty-calibration-threshold-feasibility.v1" &&
      feasibility.status === "calibration_threshold_feasible" &&
      feasibility.evidenceSplit === "calibration" &&
      feasibility.scoreSource === "family_grouped_out_of_fold_calibrated_probability" &&
      feasibility.source?.holdoutOutcomeAccessed === false,
    "threshold feasibility provenance is invalid",
  );
  requireValue(
    feasibility.thresholdGrid?.start === 0 &&
      feasibility.thresholdGrid?.end === 1 &&
      feasibility.thresholdGrid?.step === 0.01 &&
      feasibility.thresholdGrid?.operatingPointCount === 101 &&
      feasibility.thresholdGrid?.sampleScoreDerived === false,
    "threshold feasibility grid drifted",
  );
  validateClassification(
    feasibility.selectedOperatingPoint.classification,
    "selected calibration operating point",
  );
  validateClassification(
    feasibility.referenceOperatingPoint.classification,
    "reference calibration operating point",
  );
  requireValue(
    feasibility.selectedOperatingPoint.threshold === 0.06 &&
      feasibility.selectedOperatingPoint.classification.correct === 95 &&
      feasibility.selectedOperatingPoint.classification.simpleToComplexCount === 5 &&
      feasibility.selectedOperatingPoint.classification.complexToSimpleCount === 0 &&
      feasibility.selectedOperatingPoint.gate.passed === true,
    "selected calibration operating point drifted",
  );
  requireValue(
    feasibility.referenceOperatingPoint.threshold === 0.45 &&
      feasibility.referenceOperatingPoint.classification.correct === 93 &&
      feasibility.referenceOperatingPoint.classification.simpleToComplexCount === 3 &&
      feasibility.referenceOperatingPoint.classification.complexToSimpleCount === 4,
    "reference calibration operating point drifted",
  );
  for (const field of ["artifactVersion", "bundleHash", "contentHash", "totalDimension"]) {
    requireValue(
      feasibility.artifact?.[field] === sourceArtifact[field],
      `calibration source artifact ${field} drifted`,
    );
  }
  requireValue(
    feasibility.artifact?.referenceThresholdPolicyVersion ===
      sourceArtifact.thresholdPolicyVersion &&
      feasibility.artifact?.referenceThreshold === sourceArtifact.threshold &&
      feasibility.artifact?.artifactFileSha256 === sha256(sourceArtifactBytes),
    "calibration source threshold or file identity drifted",
  );

  for (const field of [
    "weights",
    "bias",
    "calibrator",
    "projectionParameters",
    "semanticHeadParameters",
    "componentHashes",
    "trainingDatasetVersion",
    "trainingDatasetSha256",
    "splitPolicyVersion",
    "splitManifestSha256",
    "trainingPolicyVersion",
    "regularization",
  ]) {
    requireValue(
      sameValue(candidateArtifact[field], sourceArtifact[field]),
      `threshold-only candidate changed ${field}`,
    );
  }
  requireValue(
    candidateArtifact.artifactVersion.endsWith(".v4") &&
      candidateArtifact.bundleVersion.endsWith(".v4") &&
      candidateArtifact.thresholdPolicyVersion === "difficulty-threshold-v2" &&
      candidateArtifact.threshold === 0.06 &&
      candidateArtifact.totalDimension === 118,
    "threshold-only candidate identity drifted",
  );
  requireValue(
    thresholdEvidence.status === "threshold_only_v4_candidate_frozen" &&
      thresholdEvidence.productRuntimeChanged === false &&
      thresholdEvidence.newUntouchedHoldoutRequired === true &&
      thresholdEvidence.runtimePromotionEligible === false,
    "threshold-v4 freeze evidence widened runtime scope",
  );
  for (const field of [
    "artifactVersion",
    "bundleVersion",
    "bundleHash",
    "contentHash",
    "thresholdPolicyVersion",
    "threshold",
    "totalDimension",
  ]) {
    requireValue(
      thresholdEvidence.candidateArtifact?.[field] === candidateArtifact[field],
      `threshold evidence candidate ${field} drifted`,
    );
  }
  requireValue(
    thresholdEvidence.sourceArtifact?.artifactFileSha256 === sha256(sourceArtifactBytes) &&
      thresholdEvidence.calibration?.feasibilityReportFileSha256 === sha256(feasibilityBytes) &&
      thresholdEvidence.candidateArtifact?.artifactFileSha256 === sha256(candidateArtifactBytes),
    "threshold evidence file identity drifted",
  );

  requireValue(
    renderFrozenHoldoutV2(buildFrozenHoldoutV2()) === freezeBytes.toString("utf8"),
    "second holdout freeze is not canonical",
  );
  requireValue(
    freeze.schemaVersion === "gatelm.difficulty-promotion-holdout-freeze.v2" &&
      freeze.status === "frozen_before_first_score_access" &&
      freeze.source?.overlapWithConsumedHoldoutFamilies === 0 &&
      freeze.source?.excludedConsumedFamilies === 10 &&
      freeze.selection?.scoreIndependent === true &&
      freeze.selection?.selectedFamilies === 10 &&
      freeze.selection?.selectedRecords === 100,
    "second holdout freeze boundary drifted",
  );

  requireValue(
    result.schemaVersion === "gatelm.difficulty-promotion-holdout-evidence.v1" &&
      result.status === "promotion_holdout_gate_failed_artifact_unchanged" &&
      result.source?.freezeSha256 === sha256(freezeBytes) &&
      result.source?.membershipHash === freeze.selection.membershipHash &&
      result.source?.selectionPolicyVersion === freeze.selection.policyVersion,
    "threshold-v4 holdout result source drifted",
  );
  requireValue(
    result.holdout?.records === 100 &&
      result.holdout?.families === 10 &&
      result.holdout?.previouslyObservedFamilyOverlap === 0,
    "threshold-v4 holdout coverage drifted",
  );
  for (const field of [
    "artifactVersion",
    "bundleVersion",
    "bundleHash",
    "contentHash",
    "thresholdPolicyVersion",
    "threshold",
    "totalDimension",
  ]) {
    requireValue(
      result.artifact?.[field] === candidateArtifact[field] &&
        result.artifact?.[field] === freeze.artifact[field],
      `threshold-v4 result artifact ${field} drifted`,
    );
  }
  requireValue(
    result.artifact?.artifactFileSha256 === sha256(candidateArtifactBytes) &&
      result.artifact?.changedAfterFreeze === false,
    "threshold-v4 result artifact file identity drifted",
  );

  validateClassification(result.selectedCandidateClassification, "threshold-v4 candidate", {
    balancedHoldout: true,
  });
  validateClassification(result.ruleBaselineClassification, "threshold-v4 rule baseline", {
    balancedHoldout: true,
  });
  requireValue(
    result.selectedCandidateClassification.correct === 56 &&
      result.selectedCandidateClassification.accuracy === 0.56 &&
      result.selectedCandidateClassification.simpleToComplexCount === 44 &&
      result.selectedCandidateClassification.complexToSimpleCount === 0,
    "threshold-v4 holdout classification drifted",
  );
  requireValue(
    result.ruleBaselineClassification.correct === 78 &&
      result.ruleBaselineClassification.accuracy === 0.78 &&
      result.ruleBaselineClassification.simpleToComplexCount === 22 &&
      result.ruleBaselineClassification.complexToSimpleCount === 0,
    "threshold-v4 rule baseline drifted",
  );
  requireValue(
    result.gate?.minimumAccuracy?.minimum === 0.91 &&
      result.gate?.minimumAccuracy?.observed === 0.56 &&
      result.gate?.minimumAccuracy?.passed === false &&
      result.gate?.maximumComplexToSimpleCount?.maximum === 1 &&
      result.gate?.maximumComplexToSimpleCount?.observed === 0 &&
      result.gate?.maximumComplexToSimpleCount?.passed === true &&
      result.gate?.categoryNonRegressionVsRule?.passed === true &&
      result.gate?.passed === false,
    "threshold-v4 promotion gate drifted",
  );
  requireValue(
    Object.values(result.gate.categoryNonRegressionVsRule.byExpectedCategory).every(
      (row) => row.passed === true,
    ),
    "threshold-v4 category non-regression drifted",
  );
  requireValue(
    result.productRuntimeChanged === false && result.runtimePromotionAutomatic === false,
    "failed threshold-v4 evidence must not promote runtime routing",
  );
  requireValue(
    result.reportMaterial?.aggregateOnly === true &&
      result.reportMaterial?.containsRawPrompt === false &&
      result.reportMaterial?.containsEmbeddingOrVector === false &&
      result.reportMaterial?.containsWeights === false &&
      result.reportMaterial?.containsIndividualScores === false,
    "threshold-v4 report material declaration is unsafe",
  );
  assertNoForbiddenResultKeys(result);
}

export function verifyCanonicalThresholdV4Evidence(paths = evidencePaths) {
  const inputs = {
    sourceArtifactBytes: readFileSync(paths.sourceArtifact),
    feasibilityBytes: readFileSync(paths.feasibility),
    thresholdEvidenceBytes: readFileSync(paths.thresholdEvidence),
    candidateArtifactBytes: readFileSync(paths.candidateArtifact),
    freezeBytes: readFileSync(paths.freeze),
    result: JSON.parse(readFileSync(paths.result, "utf8")),
  };
  validateThresholdV4Evidence(inputs);
  return inputs.result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyCanonicalThresholdV4Evidence();
  console.log(
    `difficulty threshold-v4 evidence verified (gate passed: ${String(result.gate.passed)})`,
  );
}
