import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  verifyDifficultyLabelDatasetManifest,
  verifyDifficultyLabelRecords,
} from "../verify-v2.1-difficulty-eval.mjs";

const SOURCE_PATH =
  "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.third-review-confirmed-candidate.jsonl";
const SOURCE_MANIFEST_PATH =
  "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.manifest.json";
const THIRD_REVIEW_REPORT_PATH =
  "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.third-review-report.json";
const THIRD_REVIEW_CONFIRMATIONS_PATH =
  "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.third-review-confirmations.jsonl";
const REMAINING_REVIEW_QUEUE_PATH =
  "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.remaining-review-queue.jsonl";
const DATASET_PATH =
  "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.jsonl";
const MANIFEST_PATH =
  "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.manifest.json";
const EVIDENCE_PATH =
  "docs/v2.1.0/reviews/difficulty-training-candidate-expansion-2000.owner-approval.json";

const DATASET_VERSION =
  "difficulty_training_2026_07_15_expansion_2000_owner_approved_v1";
const POLICY_VERSION =
  "difficulty-training-expansion-minimum-family-policy.2026-07-15.v1";
const SPLIT_POLICY_VERSION = "difficulty-expansion-family-split.2026-07-15.v1";
const SPLIT_SEED = 20260715;
const APPROVED_ON = "2026-07-15";
const CREATED_AT = "2026-07-15T00:00:00Z";
const CATEGORIES = ["general", "code", "translation", "summarization", "reasoning"];
const DIFFICULTIES = ["simple", "complex"];
const REQUIRED_LANGUAGES = ["ko", "en", "mixed"];
const ALL_LANGUAGES = [...REQUIRED_LANGUAGES, "unknown"];
const REQUIRED_SLICES = [
  "negation",
  "indirect_expression",
  "synonym",
  "short_complex",
  "long_simple",
  "payload_contamination",
  "korean",
  "english",
  "mixed_language",
  "category_confusion",
  "ood_terminology",
];
const EXPECTED_SPLIT_COUNTS = Object.freeze({
  train: { families: 120, records: 1200 },
  calibration: { families: 40, records: 400 },
  holdout: { families: 40, records: 400 },
});
const EXPECTED_GATE = Object.freeze({
  minimumFamilyPolicyStatus: "versioned",
  policyVersion: POLICY_VERSION,
  minApprovedFamilies: 200,
  minFamiliesPerCategory: 40,
  minFamiliesPerCategoryDifficulty: 40,
  minFamiliesPerLanguage: 200,
  minFamiliesPerSlice: 200,
});

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parseJsonl(text, label) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}: invalid JSON at line ${index + 1}: ${error.message}`);
      }
    });
}

function canonicalJsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function groupFamilies(records) {
  const families = new Map();
  for (const record of records) {
    if (!families.has(record.promptFamily)) families.set(record.promptFamily, []);
    families.get(record.promptFamily).push(record);
  }
  return families;
}

function countFamilies(families, predicate) {
  return [...families.values()].filter((records) => records.some(predicate)).length;
}

function computeCoverage(families) {
  return {
    categoryFamilies: Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        countFamilies(families, (record) => record.expectedCategory === category),
      ]),
    ),
    difficultyFamilies: Object.fromEntries(
      DIFFICULTIES.map((difficulty) => [
        difficulty,
        countFamilies(families, (record) => record.expectedDifficulty === difficulty),
      ]),
    ),
    categoryDifficultyFamilies: Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        Object.fromEntries(
          DIFFICULTIES.map((difficulty) => [
            difficulty,
            countFamilies(
              families,
              (record) =>
                record.expectedCategory === category &&
                record.expectedDifficulty === difficulty,
            ),
          ]),
        ),
      ]),
    ),
    languageFamilies: Object.fromEntries(
      ALL_LANGUAGES.map((language) => [
        language,
        countFamilies(families, (record) => record.language === language),
      ]),
    ),
    evaluationSliceFamilies: Object.fromEntries(
      REQUIRED_SLICES.map((slice) => [
        slice,
        countFamilies(families, (record) => record.evaluationSlices.includes(slice)),
      ]),
    ),
  };
}

function computeCounts(records, families) {
  const eligibleRecords = records.filter(
    (record) => record.semanticInputStatus === "eligible",
  );
  const emptyInstructionRecords = records.filter(
    (record) => record.semanticInputStatus === "empty_instruction",
  );
  return {
    records: records.length,
    families: families.size,
    humanReviewedFamilies: families.size,
    approvedHumanReviewedFamilies: families.size,
    semanticHeadEligibleRecords: eligibleRecords.length,
    semanticHeadEligibleFamilies: new Set(
      eligibleRecords.map((record) => record.promptFamily),
    ).size,
    emptyInstructionRecords: emptyInstructionRecords.length,
    emptyInstructionFamilies: new Set(
      emptyInstructionRecords.map((record) => record.promptFamily),
    ).size,
  };
}

function splitCounts(records, familyRows) {
  const partitionByFamily = new Map(
    familyRows.map((row) => [row.promptFamily, row.partition]),
  );
  return Object.fromEntries(
    ["train", "calibration", "holdout"].map((partition) => {
      const partitionFamilies = familyRows.filter(
        (row) => row.partition === partition,
      );
      return [
        partition,
        {
          families: partitionFamilies.length,
          records: records.filter(
            (record) => partitionByFamily.get(record.promptFamily) === partition,
          ).length,
        },
      ];
    }),
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertBuildInputs({ sourceRecords, sourceText, sourceManifest, report, confirmationsText, queueText }) {
  const failures = verifyDifficultyLabelRecords(sourceRecords);
  if (failures.length > 0) {
    throw new Error(`source candidate is not canonical:\n${failures.join("\n")}`);
  }
  if (
    sourceRecords.length !== 2000 ||
    new Set(sourceRecords.map((record) => record.sampleId)).size !== 2000
  ) {
    throw new Error("source candidate must contain exactly 2,000 unique sampleIds");
  }
  if (
    sourceRecords.some(
      (record) =>
        record.reviewStatus !== "pending" ||
        record.reviewerCount !== 0 ||
        record.source !== "synthetic_fixture" ||
        record.consentType !== "synthetic",
    )
  ) {
    throw new Error("source candidate must remain pending and preserve synthetic provenance");
  }
  if (
    report.status !== "third_gpt_review_merged_owner_approval_pending" ||
    report.humanReviewClaimed !== false ||
    report.integrity?.records !== 250 ||
    report.integrity?.missingSampleIds !== 0 ||
    report.integrity?.duplicateSampleIds !== 0 ||
    report.recommendations?.approve_second_candidate !== 250 ||
    report.validation?.canonicalRecordFailures !== 0 ||
    report.validation?.familyConflicts !== 0 ||
    report.remainingReviewQueue?.records !== 0
  ) {
    throw new Error("third-review report does not prove a complete conflict-free GPT review");
  }
  const confirmations = parseJsonl(confirmationsText, THIRD_REVIEW_CONFIRMATIONS_PATH);
  const remainingQueue = parseJsonl(queueText, REMAINING_REVIEW_QUEUE_PATH);
  if (confirmations.length !== 250 || remainingQueue.length !== 0) {
    throw new Error("third-review confirmations or remaining queue count is inconsistent");
  }
  if (
    report.artifacts?.thirdCandidate?.sha256 !== sha256(sourceText) ||
    report.artifacts?.confirmations?.sha256 !== sha256(confirmationsText) ||
    report.artifacts?.remainingReviewQueue?.sha256 !== sha256(queueText)
  ) {
    throw new Error("third-review artifact hash does not match its report");
  }
  if (
    sourceManifest.splitPolicyVersion !== SPLIT_POLICY_VERSION ||
    sourceManifest.splitSeed !== SPLIT_SEED ||
    !sameJson(sourceManifest.splitCounts, EXPECTED_SPLIT_COUNTS) ||
    sourceManifest.families?.length !== 200
  ) {
    throw new Error("source manifest split policy or family inventory is inconsistent");
  }
  const sourceFamilies = groupFamilies(sourceRecords);
  for (const row of sourceManifest.families) {
    const records = sourceFamilies.get(row.promptFamily);
    if (
      !records ||
      records.length !== row.records ||
      records.some(
        (record) =>
          record.expectedCategory !== row.expectedCategory ||
          record.expectedSemanticLabel !== row.expectedSemanticLabel,
      )
    ) {
      throw new Error(`source manifest family mismatch: ${row.promptFamily}`);
    }
  }
}

export function verifyExpansionTrainingCandidate({
  records,
  datasetText,
  manifest,
  sourceManifest,
}) {
  const failures = [
    ...verifyDifficultyLabelRecords(records),
    ...verifyDifficultyLabelDatasetManifest(manifest, { manifestPath: MANIFEST_PATH }),
  ];
  const families = groupFamilies(records);
  const coverage = computeCoverage(families);
  if (records.length !== 2000 || new Set(records.map((record) => record.sampleId)).size !== 2000) {
    failures.push("approved expansion must contain exactly 2,000 unique records");
  }
  if (families.size !== 200 || [...families.values()].some((items) => items.length !== 10)) {
    failures.push("approved expansion must contain 200 families with 10 records each");
  }
  if (
    records.some(
      (record) =>
        record.datasetVersion !== DATASET_VERSION ||
        record.labelSource !== "human_review" ||
        record.reviewStatus !== "approved" ||
        record.reviewerCount !== 1,
    )
  ) {
    failures.push("every expansion record must carry the explicit one-reviewer approval");
  }
  if (
    records.some(
      (record) => record.source !== "synthetic_fixture" || record.consentType !== "synthetic",
    )
  ) {
    failures.push("approved expansion must preserve synthetic prompt provenance");
  }
  if (
    manifest.datasetVersion !== DATASET_VERSION ||
    manifest.datasetPath !== DATASET_PATH ||
    manifest.datasetSha256 !== sha256(datasetText) ||
    manifest.datasetPurpose !== "training_candidate" ||
    manifest.trainingEligible !== true ||
    manifest.labelCoverageStatus !== "complete"
  ) {
    failures.push("approved expansion manifest identity or eligibility is inconsistent");
  }
  if (!sameJson(manifest.counts, computeCounts(records, families))) {
    failures.push("approved expansion manifest counts do not match records");
  }
  if (!sameJson(manifest.coverage, coverage)) {
    failures.push("approved expansion manifest coverage does not match records");
  }
  if (!sameJson(manifest.trainingGate, EXPECTED_GATE)) {
    failures.push("approved expansion minimum-family policy is not the owner-approved version");
  }
  if (!sameJson(manifest.splitCounts, EXPECTED_SPLIT_COUNTS)) {
    failures.push("approved expansion split counts are not 1,200/400/400 by family");
  }
  const rows = Array.isArray(manifest.families) ? manifest.families : [];
  const sourceRows = Array.isArray(sourceManifest.families) ? sourceManifest.families : [];
  if (rows.length !== 200 || new Set(rows.map((row) => row.promptFamily)).size !== 200) {
    failures.push("approved expansion manifest must contain 200 unique family rows");
  }
  const sourcePartitionByFamily = new Map(
    sourceRows.map((row) => [row.promptFamily, row.partition]),
  );
  for (const row of rows) {
    const familyRecords = families.get(row.promptFamily) ?? [];
    if (
      row.reviewStatus !== "approved" ||
      row.humanReviewed !== true ||
      row.records !== 10 ||
      row.partition !== sourcePartitionByFamily.get(row.promptFamily) ||
      familyRecords.some(
        (record) =>
          record.expectedCategory !== row.expectedCategory ||
          record.expectedSemanticLabel !== row.expectedSemanticLabel,
      )
    ) {
      failures.push(`approved expansion family row mismatch: ${row.promptFamily}`);
    }
  }
  if (!sameJson(splitCounts(records, rows), EXPECTED_SPLIT_COUNTS)) {
    failures.push("approved expansion records do not match family-disjoint split counts");
  }
  for (const partition of ["train", "calibration", "holdout"]) {
    const partitionFamilies = new Set(
      rows.filter((row) => row.partition === partition).map((row) => row.promptFamily),
    );
    const partitionRecords = records.filter((record) => partitionFamilies.has(record.promptFamily));
    if (
      CATEGORIES.some(
        (category) => !partitionRecords.some((record) => record.expectedCategory === category),
      ) ||
      DIFFICULTIES.some(
        (difficulty) => !partitionRecords.some((record) => record.expectedDifficulty === difficulty),
      ) ||
      REQUIRED_LANGUAGES.some(
        (language) => !partitionRecords.some((record) => record.language === language),
      ) ||
      REQUIRED_SLICES.some(
        (slice) => !partitionRecords.some((record) => record.evaluationSlices.includes(slice)),
      )
    ) {
      failures.push(`${partition} does not preserve required category/difficulty/language/slice coverage`);
    }
  }
  return failures;
}

export function buildExpansionTrainingCandidateArtifacts({
  sourceText,
  sourceManifestText,
  reportText,
  confirmationsText,
  queueText,
}) {
  const sourceRecords = parseJsonl(sourceText, SOURCE_PATH);
  const sourceManifest = JSON.parse(sourceManifestText);
  const report = JSON.parse(reportText);
  assertBuildInputs({
    sourceRecords,
    sourceText,
    sourceManifest,
    report,
    confirmationsText,
    queueText,
  });

  const reviewerNote =
    "Dataset-owner approval recorded for all 2,000 expansion records on 2026-07-15; prompt source remains synthetic.";
  const records = sourceRecords.map((record) => ({
    ...record,
    datasetVersion: DATASET_VERSION,
    labelSource: "human_review",
    reviewStatus: "approved",
    reviewerCount: 1,
    reviewerNote,
  }));
  const datasetText = canonicalJsonl(records);
  const families = groupFamilies(records);
  const familyRows = sourceManifest.families.map((row) => ({
    ...row,
    reviewStatus: "approved",
    humanReviewed: true,
  }));
  const manifest = {
    schemaVersion: "gatelm.difficulty-label-dataset-manifest.v2",
    datasetVersion: DATASET_VERSION,
    recordSchemaVersion: "gatelm.difficulty-label-record.v2",
    datasetPath: DATASET_PATH,
    datasetSha256: sha256(datasetText),
    datasetPurpose: "training_candidate",
    trainingEligible: true,
    labelCoverageStatus: "complete",
    familyPolicyVersion: "difficulty-prompt-family.v1",
    splitPolicyVersion: SPLIT_POLICY_VERSION,
    splitSeed: SPLIT_SEED,
    splitCounts: splitCounts(records, familyRows),
    trainingGate: { ...EXPECTED_GATE },
    counts: computeCounts(records, families),
    coverage: computeCoverage(families),
    families: familyRows,
    createdAt: CREATED_AT,
  };
  const manifestText = canonicalJson(manifest);
  const evidence = {
    schemaVersion: "gatelm.difficulty-training-promotion-evidence.v1",
    status: "owner_approved_training_eligible",
    approvedOn: APPROVED_ON,
    approval: {
      scope: "all_2000_expansion_records_and_all_200_prompt_families",
      basis: "explicit_dataset_owner_approval_in_current_codex_task",
      humanReviewerCount: 1,
      reviewerIdentityStored: false,
    },
    source: {
      datasetVersion: sourceRecords[0].datasetVersion,
      datasetPath: SOURCE_PATH,
      datasetSha256: sha256(sourceText),
      promptsRemainSynthetic: true,
    },
    reviewEvidence: {
      thirdReviewReport: {
        path: THIRD_REVIEW_REPORT_PATH,
        sha256: sha256(reportText),
      },
      thirdReviewConfirmations: {
        path: THIRD_REVIEW_CONFIRMATIONS_PATH,
        records: 250,
        sha256: sha256(confirmationsText),
      },
      remainingReviewQueue: {
        path: REMAINING_REVIEW_QUEUE_PATH,
        records: 0,
        sha256: sha256(queueText),
      },
      gptReviewIsHumanApproval: false,
      datasetOwnerApprovalRecordedSeparately: true,
    },
    promotedDataset: {
      datasetVersion: DATASET_VERSION,
      datasetPath: DATASET_PATH,
      datasetSha256: sha256(datasetText),
      manifestPath: MANIFEST_PATH,
      manifestSha256: sha256(manifestText),
    },
    minimumFamilyPolicy: {
      ...EXPECTED_GATE,
      thresholdBasis: "observed_minimums_of_owner_approved_expansion_candidate",
      requiredLanguages: REQUIRED_LANGUAGES,
      requiredSlices: REQUIRED_SLICES,
    },
    partitions: manifest.splitCounts,
    splitPolicyVersion: SPLIT_POLICY_VERSION,
    splitSeed: SPLIT_SEED,
    gates: {
      allRecordsHumanApproved: true,
      sourceProvenancePreserved: true,
      requiredSliceCoverageComplete: true,
      familyDisjointPartitions: true,
      minimumFamilyPolicySatisfied: true,
      trainingEligible: true,
    },
    doesNotApprove: [
      "model_performance",
      "calibrator_or_threshold_selection",
      "runtime_promotion",
      "ga_or_release",
    ],
  };
  const failures = verifyExpansionTrainingCandidate({
    records,
    datasetText,
    manifest,
    sourceManifest,
  });
  if (failures.length > 0) {
    throw new Error(`approved expansion failed verification:\n${failures.join("\n")}`);
  }
  return {
    records,
    manifest,
    evidence,
    files: {
      [DATASET_PATH]: datasetText,
      [MANIFEST_PATH]: manifestText,
      [EVIDENCE_PATH]: canonicalJson(evidence),
    },
  };
}

function buildFromDisk() {
  return buildExpansionTrainingCandidateArtifacts({
    sourceText: readFileSync(SOURCE_PATH, "utf8"),
    sourceManifestText: readFileSync(SOURCE_MANIFEST_PATH, "utf8"),
    reportText: readFileSync(THIRD_REVIEW_REPORT_PATH, "utf8"),
    confirmationsText: readFileSync(THIRD_REVIEW_CONFIRMATIONS_PATH, "utf8"),
    queueText: readFileSync(REMAINING_REVIEW_QUEUE_PATH, "utf8"),
  });
}

function main() {
  const check = process.argv.includes("--check");
  const result = buildFromDisk();
  for (const [filePath, content] of Object.entries(result.files)) {
    if (check) {
      const current = readFileSync(filePath, "utf8");
      if (current !== content) throw new Error(`${filePath} is not reproducible`);
      continue;
    }
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }
  process.stdout.write(
    `${check ? "verified" : "wrote"} owner-approved expansion: ` +
      `${result.records.length} records, ${result.manifest.counts.families} families, ` +
      `${result.manifest.splitCounts.train.records}/` +
      `${result.manifest.splitCounts.calibration.records}/` +
      `${result.manifest.splitCounts.holdout.records}\n`,
  );
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
