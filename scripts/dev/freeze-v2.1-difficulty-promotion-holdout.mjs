import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const selectionPolicyVersion =
  "difficulty-promotion-holdout-family-sample.2026-07-15.v1";

export const defaultPaths = Object.freeze({
  dataset: path.join(
    repoRoot,
    "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.jsonl",
  ),
  manifest: path.join(
    repoRoot,
    "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.manifest.json",
  ),
  approval: path.join(
    repoRoot,
    "docs/v2.1.0/reviews/difficulty-training-candidate-expansion-2000.owner-approval.json",
  ),
  previousManifest: path.join(
    repoRoot,
    "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json",
  ),
  artifact: path.join(
    repoRoot,
    "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v3.json",
  ),
  output: path.join(
    repoRoot,
    "docs/v2.1.0/evaluation/difficulty-promotion-holdout-100.v1.json",
  ),
});

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function parseJsonl(buffer) {
  return buffer
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function requireValue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function deterministicFamilyRank(promptFamily) {
  return sha256Text(`${selectionPolicyVersion}\0${promptFamily}`);
}

export function buildFrozenHoldout(paths = defaultPaths) {
  const datasetBytes = readFileSync(paths.dataset);
  const manifestBytes = readFileSync(paths.manifest);
  const approvalBytes = readFileSync(paths.approval);
  const previousManifestBytes = readFileSync(paths.previousManifest);
  const artifactBytes = readFileSync(paths.artifact);
  const datasetSha256 = sha256Bytes(datasetBytes);
  const manifestSha256 = sha256Bytes(manifestBytes);
  const approvalSha256 = sha256Bytes(approvalBytes);
  const records = parseJsonl(datasetBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const approval = JSON.parse(approvalBytes.toString("utf8"));
  const previousManifest = JSON.parse(previousManifestBytes.toString("utf8"));
  const artifact = JSON.parse(artifactBytes.toString("utf8"));

  requireValue(manifest.trainingEligible === true, "promotion source must be training eligible");
  requireValue(
    manifest.datasetVersion === approval.promotedDataset?.datasetVersion,
    "approval and promoted dataset version differ",
  );
  requireValue(
    datasetSha256 === manifest.datasetSha256 &&
      datasetSha256 === approval.promotedDataset?.datasetSha256,
    "promotion source dataset hash differs from its approval or manifest",
  );
  requireValue(
    manifestSha256 === approval.promotedDataset?.manifestSha256,
    "promotion source manifest hash differs from its approval",
  );
  requireValue(
    approval.status === "owner_approved_training_eligible" &&
      approval.approval?.basis === "explicit_dataset_owner_approval_in_current_codex_task",
    "promotion source lacks explicit dataset-owner approval",
  );
  requireValue(records.length === 2000, "promotion source must contain exactly 2,000 records");
  requireValue(
    manifest.splitCounts?.holdout?.families === 40 &&
      manifest.splitCounts?.holdout?.records === 400,
    "promotion source must expose the frozen 40-family/400-record holdout",
  );

  const holdoutFamilies = new Set(
    manifest.families
      .filter((family) => family.partition === "holdout")
      .map((family) => {
        requireValue(
          family.reviewStatus === "approved" && family.humanReviewed === true,
          `holdout family ${family.promptFamily} is not owner-approved`,
        );
        return family.promptFamily;
      }),
  );
  requireValue(holdoutFamilies.size === 40, "promotion source holdout family count drifted");

  const previousFamilies = new Set(previousManifest.families.map((family) => family.promptFamily));
  const grouped = new Map();
  for (const record of records) {
    if (!holdoutFamilies.has(record.promptFamily)) {
      continue;
    }
    requireValue(
      record.schemaVersion === "gatelm.difficulty-label-record.v2" &&
        record.datasetVersion === manifest.datasetVersion,
      `holdout sample ${record.sampleId} has an unsupported identity`,
    );
    requireValue(
      record.labelSource === "human_review" &&
        record.reviewStatus === "approved" &&
        record.reviewerCount >= 1,
      `holdout sample ${record.sampleId} is not owner-approved`,
    );
    const familyRecords = grouped.get(record.promptFamily) ?? [];
    familyRecords.push(record);
    grouped.set(record.promptFamily, familyRecords);
  }
  requireValue(grouped.size === 40, "holdout dataset and manifest family membership differ");

  const familiesByCategory = new Map();
  for (const [promptFamily, familyRecords] of grouped) {
    const categories = new Set(familyRecords.map((record) => record.expectedCategory));
    const simple = familyRecords.filter((record) => record.expectedDifficulty === "simple").length;
    const complex = familyRecords.filter((record) => record.expectedDifficulty === "complex").length;
    requireValue(
      familyRecords.length === 10 && categories.size === 1 && simple === 5 && complex === 5,
      `holdout family ${promptFamily} is not a balanced 10-record family`,
    );
    requireValue(
      !previousFamilies.has(promptFamily),
      `new promotion family ${promptFamily} overlaps the previously observed 500-record dataset`,
    );
    const expectedCategory = [...categories][0];
    const categoryFamilies = familiesByCategory.get(expectedCategory) ?? [];
    categoryFamilies.push({
      promptFamily,
      expectedCategory,
      selectionRank: deterministicFamilyRank(promptFamily),
      records: familyRecords,
    });
    familiesByCategory.set(expectedCategory, categoryFamilies);
  }

  const categories = ["general", "reasoning", "code", "translation", "summarization"];
  const selectedFamilies = [];
  for (const category of categories) {
    const candidates = familiesByCategory.get(category) ?? [];
    requireValue(candidates.length === 8, `holdout category ${category} must contain eight families`);
    candidates.sort(
      (left, right) =>
        left.selectionRank.localeCompare(right.selectionRank) ||
        left.promptFamily.localeCompare(right.promptFamily),
    );
    selectedFamilies.push(...candidates.slice(0, 2));
  }

  const selectedFamilyNames = new Set(selectedFamilies.map((family) => family.promptFamily));
  const selectedRecords = records.filter((record) => selectedFamilyNames.has(record.promptFamily));
  requireValue(selectedRecords.length === 100, "frozen promotion holdout must contain 100 records");
  const selectedSamples = selectedRecords.map((record) => ({
    sampleId: record.sampleId,
    promptFamily: record.promptFamily,
    expectedCategory: record.expectedCategory,
    expectedDifficulty: record.expectedDifficulty,
  }));
  const membershipHash = sha256Text(
    selectedSamples
      .map(
        (sample) =>
          `${sample.sampleId}\0${sample.promptFamily}\0${sample.expectedCategory}\0${sample.expectedDifficulty}`,
      )
      .join("\n"),
  );

  return {
    schemaVersion: "gatelm.difficulty-promotion-holdout-freeze.v1",
    status: "frozen_before_first_score_access",
    frozenOn: "2026-07-15",
    source: {
      datasetVersion: manifest.datasetVersion,
      datasetSha256,
      manifestSha256,
      ownerApprovalSha256: approvalSha256,
      splitPolicyVersion: manifest.splitPolicyVersion,
      splitSeed: manifest.splitSeed,
      sourceHoldoutFamilies: 40,
      sourceHoldoutRecords: 400,
      overlapWithPreviouslyObservedDatasetFamilies: 0,
    },
    selection: {
      policyVersion: selectionPolicyVersion,
      policy: "sha256_rank_two_whole_families_per_expected_category",
      scoreIndependent: true,
      selectedFamilies: 10,
      selectedRecords: 100,
      familiesPerExpectedCategory: 2,
      recordsPerExpectedCategory: 20,
      simplePerExpectedCategory: 10,
      complexPerExpectedCategory: 10,
      membershipHash: `sha256:${membershipHash}`,
    },
    artifact: {
      artifactVersion: artifact.artifactVersion,
      bundleHash: artifact.bundleHash,
      contentHash: artifact.contentHash,
      thresholdPolicyVersion: artifact.thresholdPolicyVersion,
      threshold: artifact.threshold,
      totalDimension: artifact.totalDimension,
    },
    gatesFrozenBeforeEvaluation: {
      minimumAccuracy: 0.91,
      maximumComplexToSimpleCount: 1,
      categoryDirectionalErrorPolicy:
        "candidate_complex_to_simple_count_and_rate_must_not_exceed_rule_baseline_in_any_expected_category",
    },
    selectedFamilies: selectedFamilies.map((family) => ({
      promptFamily: family.promptFamily,
      expectedCategory: family.expectedCategory,
      selectionRank: family.selectionRank,
      records: 10,
    })),
    samples: selectedSamples,
    forbiddenEvaluationUses: [
      "training",
      "calibration",
      "candidate_selection",
      "threshold_selection",
      "artifact_mutation_after_score_access",
    ],
  };
}

export function renderFrozenHoldout(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const rendered = renderFrozenHoldout(buildFrozenHoldout());
  if (check) {
    const current = readFileSync(defaultPaths.output, "utf8");
    requireValue(current === rendered, "frozen promotion holdout membership or identity drifted");
    console.log("difficulty promotion holdout freeze verified");
    return;
  }
  writeFileSync(defaultPaths.output, rendered, "utf8");
  console.log(`wrote score-independent promotion holdout freeze to ${defaultPaths.output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
