import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const evidencePaths = Object.freeze({
  dataset: path.join(
    root,
    "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.jsonl",
  ),
  manifest: path.join(
    root,
    "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.manifest.json",
  ),
  freeze: path.join(
    root,
    "docs/v2.1.0/evaluation/difficulty-promotion-holdout-100.v1.json",
  ),
  artifact: path.join(
    root,
    "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v3.json",
  ),
  report: path.join(root, "docs/testing/difficulty-promotion-holdout-100-result.json"),
});

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function requireValue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateClassification(summary, label) {
  requireValue(summary.samples === 100, `${label} must summarize 100 records`);
  requireValue(
    summary.correct + summary.simpleToComplexCount + summary.complexToSimpleCount ===
      summary.samples,
    `${label} confusion counts do not sum to the holdout size`,
  );
  requireValue(
    summary.simpleExpectedSamples === 50 && summary.complexExpectedSamples === 50,
    `${label} must preserve the balanced difficulty labels`,
  );
  requireValue(
    summary.accuracy === summary.correct / summary.samples,
    `${label} accuracy is not derived from its aggregate counts`,
  );
  const categories = summary.byExpectedCategory;
  requireValue(
    categories &&
      Object.keys(categories).sort().join(",") ===
        "code,general,reasoning,summarization,translation",
    `${label} expected-category coverage drifted`,
  );
  for (const [category, row] of Object.entries(categories)) {
    requireValue(
      row.samples === 20 &&
        row.simpleExpectedSamples === 10 &&
        row.complexExpectedSamples === 10,
      `${label} category ${category} is not balanced 20/10/10`,
    );
    requireValue(
      row.accuracy === row.correct / row.samples &&
        row.complexToSimpleRate === row.complexToSimpleCount / row.complexExpectedSamples,
      `${label} category ${category} metrics are internally inconsistent`,
    );
  }
}

function assertNoForbiddenReportKeys(value, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenReportKeys(item, [...pathParts, String(index)]));
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
  ]);
  for (const [key, child] of Object.entries(value)) {
    requireValue(!forbidden.has(key), `aggregate report contains forbidden key ${[...pathParts, key].join(".")}`);
    assertNoForbiddenReportKeys(child, [...pathParts, key]);
  }
}

export function validateEvidence({
  datasetBytes,
  manifestBytes,
  freezeBytes,
  artifactBytes,
  report,
}) {
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const artifact = JSON.parse(artifactBytes.toString("utf8"));
  const source = report.source;

  requireValue(
    report.schemaVersion === "gatelm.difficulty-promotion-holdout-evidence.v1",
    "unsupported promotion holdout report schema",
  );
  requireValue(
    source.datasetVersion === manifest.datasetVersion &&
      source.datasetSha256 === sha256(datasetBytes) &&
      source.manifestSha256 === sha256(manifestBytes) &&
      source.freezeSha256 === sha256(freezeBytes) &&
      source.membershipHash === freeze.selection.membershipHash &&
      source.selectionPolicyVersion === freeze.selection.policyVersion,
    "promotion report source or frozen membership identity drifted",
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
      report.artifact[field] === freeze.artifact[field] &&
        report.artifact[field] === artifact[field],
      `promotion report artifact ${field} changed after freeze`,
    );
  }
  requireValue(
    report.artifact.artifactFileSha256 === sha256(artifactBytes) &&
      report.artifact.changedAfterFreeze === false,
    "promotion artifact file identity is not frozen",
  );
  requireValue(
    report.holdout.records === 100 &&
      report.holdout.families === 10 &&
      report.holdout.recordsPerExpectedCategory === 20 &&
      report.holdout.simplePerExpectedCategory === 10 &&
      report.holdout.complexPerExpectedCategory === 10 &&
      report.holdout.previouslyObservedFamilyOverlap === 0,
    "promotion report holdout coverage drifted",
  );

  const candidate = report.selectedCandidateClassification;
  const baseline = report.ruleBaselineClassification;
  validateClassification(candidate, "selected candidate");
  validateClassification(baseline, "rule baseline");
  const gate = report.gate;
  requireValue(
    gate.minimumAccuracy.minimum === freeze.gatesFrozenBeforeEvaluation.minimumAccuracy &&
      gate.minimumAccuracy.observed === candidate.accuracy &&
      gate.minimumAccuracy.passed ===
        (candidate.accuracy >= freeze.gatesFrozenBeforeEvaluation.minimumAccuracy),
    "promotion accuracy gate is inconsistent with the frozen threshold",
  );
  requireValue(
    gate.maximumComplexToSimpleCount.maximum ===
      freeze.gatesFrozenBeforeEvaluation.maximumComplexToSimpleCount &&
      gate.maximumComplexToSimpleCount.observed === candidate.complexToSimpleCount &&
      gate.maximumComplexToSimpleCount.passed ===
        (candidate.complexToSimpleCount <=
          freeze.gatesFrozenBeforeEvaluation.maximumComplexToSimpleCount),
    "promotion complex-to-simple gate is inconsistent with the frozen maximum",
  );
  let categoryPassed = true;
  for (const category of Object.keys(candidate.byExpectedCategory).sort()) {
    const row = gate.categoryNonRegressionVsRule.byExpectedCategory[category];
    const candidateRow = candidate.byExpectedCategory[category];
    const baselineRow = baseline.byExpectedCategory[category];
    const expectedPass =
      candidateRow.complexToSimpleCount <= baselineRow.complexToSimpleCount &&
      candidateRow.complexToSimpleRate <= baselineRow.complexToSimpleRate;
    requireValue(
      row.candidateCount === candidateRow.complexToSimpleCount &&
        row.ruleBaselineCount === baselineRow.complexToSimpleCount &&
        row.candidateRate === candidateRow.complexToSimpleRate &&
        row.ruleBaselineRate === baselineRow.complexToSimpleRate &&
        row.passed === expectedPass,
      `promotion category gate ${category} is inconsistent`,
    );
    categoryPassed &&= expectedPass;
  }
  requireValue(
    gate.categoryNonRegressionVsRule.passed === categoryPassed,
    "promotion category non-regression aggregate is inconsistent",
  );
  const expectedGate =
    gate.minimumAccuracy.passed &&
    gate.maximumComplexToSimpleCount.passed &&
    gate.categoryNonRegressionVsRule.passed;
  requireValue(gate.passed === expectedGate, "promotion overall gate is inconsistent");
  requireValue(
    report.status ===
      (expectedGate
        ? "promotion_holdout_gate_passed_artifact_unchanged"
        : "promotion_holdout_gate_failed_artifact_unchanged"),
    "promotion report status does not match its gate",
  );
  requireValue(
    report.productRuntimeChanged === false && report.runtimePromotionAutomatic === false,
    "promotion evidence must not change or automatically promote product routing",
  );
  requireValue(
    report.reportMaterial?.aggregateOnly === true &&
      report.reportMaterial.containsRawPrompt === false &&
      report.reportMaterial.containsEmbeddingOrVector === false &&
      report.reportMaterial.containsWeights === false &&
      report.reportMaterial.containsIndividualScores === false,
    "promotion report material declaration is unsafe",
  );
  assertNoForbiddenReportKeys(report);
}

export function verifyCanonicalEvidence(paths = evidencePaths) {
  const datasetBytes = readFileSync(paths.dataset);
  const manifestBytes = readFileSync(paths.manifest);
  const freezeBytes = readFileSync(paths.freeze);
  const artifactBytes = readFileSync(paths.artifact);
  const report = JSON.parse(readFileSync(paths.report, "utf8"));
  validateEvidence({ datasetBytes, manifestBytes, freezeBytes, artifactBytes, report });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = verifyCanonicalEvidence();
  console.log(
    `difficulty promotion holdout evidence verified (gate passed: ${String(report.gate.passed)})`,
  );
}
