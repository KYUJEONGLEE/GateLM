import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateDirectory = "scripts/routing_difficulty_model/artifacts/candidates";
const reportPath = `${candidateDirectory}/difficulty-candidate-comparison.owner-approved-500.v1.json`;
const semanticHeadsPath = `${candidateDirectory}/difficulty-semantic-heads.owner-approved-500.v1.json`;
const policyPath = "scripts/routing_difficulty_model/training-policy.semantic-candidates.v1.json";
const encoderManifestPath =
  "scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v1.json";
const datasetManifestPath =
  "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json";
const candidateArtifacts = [
  {
    name: "42d-rule-vector-v1",
    dimension: 42,
    path: `${candidateDirectory}/difficulty-candidate-a-42d.owner-approved-500.v1.json`,
  },
  {
    name: "42d-rule-vector-v1-plus-projection",
    dimension: 106,
    path: `${candidateDirectory}/difficulty-candidate-b-106d.owner-approved-500.v1.json`,
  },
  {
    name: "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities",
    dimension: 118,
    path: `${candidateDirectory}/difficulty-candidate-c-118d.owner-approved-500.v1.json`,
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
    report.schemaVersion !== "gatelm.difficulty-offline-candidate-comparison.v1" ||
    report.status !== "offline_selection_evidence_not_runtime_promotion" ||
    report.productRuntimeChanged !== false ||
    report.finalPromotionHoldoutRequiredAfterSelection !== true
  ) {
    failures.push(`${reportPath}: report identity/runtime boundary is invalid`);
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
    policy.policyVersion !== "difficulty-logistic-training.semantic-candidates.2026-07-15.v1" ||
    policy.splitPolicyVersion !== report.splitPolicyVersion ||
    policy.threshold?.value !== 0.45
  ) {
    failures.push(`${policyPath}: semantic candidate training policy is inconsistent`);
  }
  if (
    semanticHeads.schemaVersion !== "gatelm.difficulty-semantic-heads-artifact.v1" ||
    semanticHeads.semanticHeadProbabilityDimension !== 12 ||
    semanticHeads.inputDimension !== 64 ||
    semanticHeads.training?.trainSamples !== 300 ||
    report.semanticHeads?.splits?.calibration?.sampleCount !== 100 ||
    report.semanticHeads?.splits?.holdout?.sampleCount !== 100
  ) {
    failures.push(`${semanticHeadsPath}: semantic heads must use train 300 and canonical E5/PCA 64D→12D material`);
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
      candidateReport.holdoutClassification?.samples !== 100
    ) {
      failures.push(`${reportPath}: ${name} report does not match its artifact and 300/100/100 split`);
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
