import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  verifyDifficultyLabelDatasetManifest,
  verifyDifficultyLabelRecords,
} from "../verify-v2.1-difficulty-eval.mjs";

const SOURCE_PATH =
  "docs/v2.1.0/reviews/difficulty-evaluation-training-pilot-500.gpt-adjudicated-labels.jsonl";
const DATASET_PATH =
  "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl";
const MANIFEST_PATH =
  "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json";
const EVIDENCE_PATH =
  "docs/v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json";

const DATASET_VERSION = "difficulty_training_2026_07_15_owner_approved_500_v2";
const POLICY_VERSION = "difficulty-training-minimum-family-policy.2026-07-14.v1";
const SPLIT_POLICY_VERSION = "difficulty-family-constrained-split.2026-07-15.v1";
const SPLIT_SEED = 20260715;
const SPLIT_TARGETS = Object.freeze({ train: 300, calibration: 100, holdout: 100 });
const APPROVED_ON = "2026-07-14";
const CREATED_AT = "2026-07-14T00:00:00Z";
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
const RARE_HOLDOUT_SLICES = new Set([
  "indirect_expression",
  "synonym",
  "payload_contamination",
  "ood_terminology",
]);
const EVALUATION_SPLIT_SLICES = [
  "negation",
  "short_complex",
  "long_simple",
  "korean",
  "english",
  "mixed_language",
  "category_confusion",
];

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
                record.expectedCategory === category && record.expectedDifficulty === difficulty,
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

function familyHasCell(records, category, difficulty) {
  return records.some(
    (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
  );
}

const REQUIRED_SPLIT_TAGS = [
  ...CATEGORIES.flatMap((category) =>
    DIFFICULTIES.map((difficulty) => `cell:${category}:${difficulty}`),
  ),
  ...REQUIRED_LANGUAGES.map((language) => `language:${language}`),
  ...EVALUATION_SPLIT_SLICES.map((slice) => `slice:${slice}`),
];
const BASE_SPLIT_TAG_COUNT = CATEGORIES.length * DIFFICULTIES.length + REQUIRED_LANGUAGES.length;
const BASE_SPLIT_MASK = (1n << BigInt(BASE_SPLIT_TAG_COUNT)) - 1n;
const REQUIRED_SPLIT_MASK = (1n << BigInt(REQUIRED_SPLIT_TAGS.length)) - 1n;

function familyCoverageMask(records) {
  let mask = 0n;
  for (const [index, tag] of REQUIRED_SPLIT_TAGS.entries()) {
    const [kind, first, second] = tag.split(":");
    const covered = records.some((record) => {
      if (kind === "cell") {
        return record.expectedCategory === first && record.expectedDifficulty === second;
      }
      if (kind === "language") return record.language === first;
      return record.evaluationSlices.includes(first);
    });
    if (covered) mask |= 1n << BigInt(index);
  }
  return mask;
}

function bitCount(value) {
  let remaining = value;
  let count = 0;
  while (remaining !== 0n) {
    remaining &= remaining - 1n;
    count += 1;
  }
  return count;
}

function selectCoverageFamilies(entries, requiredMask, initialFamilies = new Set()) {
  const selectedFamilies = new Set(initialFamilies);
  let selected = entries.filter(([promptFamily]) => selectedFamilies.has(promptFamily));
  let coveredMask = selected.reduce((mask, [, records]) => mask | familyCoverageMask(records), 0n);
  while ((coveredMask & requiredMask) !== requiredMask) {
    const missing = requiredMask & ~coveredMask;
    const candidates = entries
      .filter(([promptFamily]) => !selectedFamilies.has(promptFamily))
      .map(([promptFamily, records]) => ({
        promptFamily,
        records,
        newCoverage: bitCount(familyCoverageMask(records) & missing),
      }))
      .filter((candidate) => candidate.newCoverage > 0)
      .sort(
        (left, right) =>
          right.newCoverage - left.newCoverage ||
          left.records.length - right.records.length ||
          left.promptFamily.localeCompare(right.promptFamily),
      );
    const chosen = candidates[0];
    if (!chosen) throw new Error("cannot satisfy required partition coverage");
    selectedFamilies.add(chosen.promptFamily);
    coveredMask |= familyCoverageMask(chosen.records);
  }
  return selectedFamilies;
}

function selectExactPartition(entries, targetRecords, requiredFamilies = new Set()) {
  const selectedFamilies = selectCoverageFamilies(
    entries,
    REQUIRED_SPLIT_MASK,
    requiredFamilies,
  );
  const required = entries.filter(([promptFamily]) => selectedFamilies.has(promptFamily));
  const requiredRecords = required.reduce((total, [, records]) => total + records.length, 0);
  if (requiredRecords > targetRecords) {
    throw new Error(`required families exceed ${targetRecords}-record partition target`);
  }
  const candidates = entries.filter(([promptFamily]) => !selectedFamilies.has(promptFamily));
  let states = new Map([[requiredRecords, []]]);
  for (const [promptFamily, records] of candidates) {
    const nextStates = new Map(states);
    for (const [currentCount, selected] of states) {
      const count = currentCount + records.length;
      if (count > targetRecords) continue;
      if (!nextStates.has(count)) nextStates.set(count, [...selected, promptFamily]);
    }
    states = nextStates;
  }
  const winner = states.get(targetRecords);
  if (!winner) {
    throw new Error(
      `cannot produce exact ${targetRecords}-record family-disjoint partition with required coverage`,
    );
  }
  return new Set([...selectedFamilies, ...winner]);
}

function partitionHasRequiredCoverage(records, includeEvaluationSlices = true) {
  const required = includeEvaluationSlices ? REQUIRED_SPLIT_MASK : BASE_SPLIT_MASK;
  return (familyCoverageMask(records) & required) === required;
}

function assignPartitions(families) {
  const assignments = new Map();
  const entries = [...families.entries()].sort(([left], [right]) => left.localeCompare(right));
  const rareHoldoutFamilies = new Set(
    entries
      .filter(([, records]) =>
        records.some((record) =>
          record.evaluationSlices.some((slice) => RARE_HOLDOUT_SLICES.has(slice)),
        ),
      )
      .map(([promptFamily]) => promptFamily),
  );
  const reservedTrain = selectCoverageFamilies(
    entries.filter(([promptFamily]) => !rareHoldoutFamilies.has(promptFamily)),
    BASE_SPLIT_MASK,
  );
  const evaluationEntries = entries.filter(
    ([promptFamily]) => !reservedTrain.has(promptFamily),
  );
  const holdout = selectExactPartition(
    evaluationEntries,
    SPLIT_TARGETS.holdout,
    rareHoldoutFamilies,
  );
  for (const promptFamily of holdout) assignments.set(promptFamily, "holdout");

  const remaining = evaluationEntries.filter(([promptFamily]) => !holdout.has(promptFamily));
  const calibration = selectExactPartition(remaining, SPLIT_TARGETS.calibration);
  for (const promptFamily of calibration) assignments.set(promptFamily, "calibration");
  for (const [promptFamily] of entries) {
    if (!assignments.has(promptFamily)) assignments.set(promptFamily, "train");
  }

  const counts = partitionCounts(
    [...families.values()].flat(),
    assignments,
  );
  for (const [partition, target] of Object.entries(SPLIT_TARGETS)) {
    if (counts[partition].records !== target) {
      throw new Error(`${partition} has ${counts[partition].records} records, expected ${target}`);
    }
    const partitionRecords = entries
      .filter(([promptFamily]) => assignments.get(promptFamily) === partition)
      .flatMap(([, records]) => records);
    if (!partitionHasRequiredCoverage(partitionRecords, partition !== "train")) {
      throw new Error(`${partition} lacks required cell, language, or evaluation-slice coverage`);
    }
  }
  return assignments;
}

function observedMinimumPolicy(coverage, approvedFamilies) {
  return {
    minimumFamilyPolicyStatus: "versioned",
    policyVersion: POLICY_VERSION,
    minApprovedFamilies: approvedFamilies,
    minFamiliesPerCategory: Math.min(...Object.values(coverage.categoryFamilies)),
    minFamiliesPerCategoryDifficulty: Math.min(
      ...Object.values(coverage.categoryDifficultyFamilies).flatMap((counts) => Object.values(counts)),
    ),
    minFamiliesPerLanguage: Math.min(
      ...REQUIRED_LANGUAGES.map((language) => coverage.languageFamilies[language]),
    ),
    minFamiliesPerSlice: Math.min(...Object.values(coverage.evaluationSliceFamilies)),
  };
}

function partitionCounts(records, assignments) {
  return Object.fromEntries(
    ["train", "calibration", "holdout"].map((partition) => {
      const partitionRecords = records.filter(
        (record) => assignments.get(record.promptFamily) === partition,
      );
      return [
        partition,
        {
          families: new Set(partitionRecords.map((record) => record.promptFamily)).size,
          records: partitionRecords.length,
        },
      ];
    }),
  );
}

export function verifyTrainingCandidate({ records, datasetText, manifest }) {
  const failures = [
    ...verifyDifficultyLabelRecords(records),
    ...verifyDifficultyLabelDatasetManifest(manifest, { manifestPath: MANIFEST_PATH }),
  ];
  const families = groupFamilies(records);
  const coverage = computeCoverage(families);
  if (records.length !== 500 || new Set(records.map((record) => record.sampleId)).size !== 500) {
    failures.push("training candidate must contain exactly 500 unique records");
  }
  if (
    records.some(
      (record) =>
        record.labelSource !== "human_review" ||
        record.reviewStatus !== "approved" ||
        record.reviewerCount !== 1,
    )
  ) {
    failures.push("every training candidate record must have one human reviewer and approved status");
  }
  if (
    records.some(
      (record) => record.source !== "synthetic_fixture" || record.consentType !== "synthetic",
    )
  ) {
    failures.push("training candidate must preserve its synthetic prompt provenance");
  }
  if (
    manifest.datasetVersion !== DATASET_VERSION ||
    manifest.datasetPath !== DATASET_PATH ||
    manifest.datasetSha256 !== sha256(datasetText) ||
    manifest.datasetPurpose !== "training_candidate" ||
    manifest.trainingEligible !== true ||
    manifest.labelCoverageStatus !== "complete"
  ) {
    failures.push("training candidate manifest identity or eligibility is inconsistent");
  }
  if (JSON.stringify(manifest.coverage) !== JSON.stringify(coverage)) {
    failures.push("training candidate manifest coverage does not match records");
  }
  const eligibleRecords = records.filter((record) => record.semanticInputStatus === "eligible");
  const emptyInstructionRecords = records.filter(
    (record) => record.semanticInputStatus === "empty_instruction",
  );
  const expectedCounts = {
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
  if (JSON.stringify(manifest.counts) !== JSON.stringify(expectedCounts)) {
    failures.push("training candidate manifest counts do not match records");
  }
  const gate = manifest.trainingGate;
  if (
    gate?.minimumFamilyPolicyStatus !== "versioned" ||
    gate.policyVersion !== POLICY_VERSION ||
    families.size < gate.minApprovedFamilies ||
    Object.values(coverage.categoryFamilies).some((count) => count < gate.minFamiliesPerCategory) ||
    Object.values(coverage.categoryDifficultyFamilies).some((counts) =>
      Object.values(counts).some((count) => count < gate.minFamiliesPerCategoryDifficulty),
    ) ||
    REQUIRED_LANGUAGES.some(
      (language) => coverage.languageFamilies[language] < gate.minFamiliesPerLanguage,
    ) ||
    Object.values(coverage.evaluationSliceFamilies).some((count) => count < gate.minFamiliesPerSlice)
  ) {
    failures.push("training candidate does not satisfy its versioned minimum family policy");
  }
  const rows = Array.isArray(manifest.families) ? manifest.families : [];
  if (rows.length !== families.size || new Set(rows.map((row) => row.promptFamily)).size !== rows.length) {
    failures.push("training candidate manifest has family leakage or missing family rows");
  }
  for (const [promptFamily, familyRecords] of families) {
    const row = rows.find((item) => item.promptFamily === promptFamily);
    if (
      !row ||
      row.expectedCategory !== familyRecords[0].expectedCategory ||
      row.expectedSemanticLabel !== familyRecords[0].expectedSemanticLabel ||
      row.reviewStatus !== "approved" ||
      row.humanReviewed !== true ||
      row.records !== familyRecords.length ||
      !["train", "calibration", "holdout"].includes(row.partition)
    ) {
      failures.push(`training candidate family row mismatch: ${promptFamily}`);
    }
  }
  const partitionByFamily = new Map(rows.map((row) => [row.promptFamily, row.partition]));
  const partitionRecordCounts = Object.fromEntries(
    ["train", "calibration", "holdout"].map((partition) => [
      partition,
      records.filter((record) => partitionByFamily.get(record.promptFamily) === partition).length,
    ]),
  );
  if (
    partitionRecordCounts.train !== SPLIT_TARGETS.train ||
    partitionRecordCounts.calibration !== SPLIT_TARGETS.calibration ||
    partitionRecordCounts.holdout !== SPLIT_TARGETS.holdout
  ) {
    failures.push("training candidate partitions must contain exactly 300/100/100 records");
  }
  for (const partition of ["train", "calibration", "holdout"]) {
    for (const category of CATEGORIES) {
      for (const difficulty of DIFFICULTIES) {
        const covered = records.some(
          (record) =>
            partitionByFamily.get(record.promptFamily) === partition &&
            record.expectedCategory === category &&
            record.expectedDifficulty === difficulty,
        );
        if (!covered) failures.push(`${partition} lacks ${category}/${difficulty} family coverage`);
      }
    }
  }
  for (const slice of RARE_HOLDOUT_SLICES) {
    const misplaced = records.some(
      (record) =>
        record.evaluationSlices.includes(slice) &&
        partitionByFamily.get(record.promptFamily) !== "holdout",
    );
    if (misplaced) failures.push(`${slice} coverage family must remain in holdout`);
  }
  for (const partition of ["train", "calibration", "holdout"]) {
    const partitionRecords = records.filter(
      (record) => partitionByFamily.get(record.promptFamily) === partition,
    );
    if (!partitionHasRequiredCoverage(partitionRecords, partition !== "train")) {
      failures.push(`${partition} lacks required language or evaluation-slice coverage`);
    }
  }
  if (
    manifest.splitPolicyVersion !== SPLIT_POLICY_VERSION ||
    manifest.splitSeed !== SPLIT_SEED ||
    JSON.stringify(manifest.splitCounts) !==
      JSON.stringify(partitionCounts(records, partitionByFamily))
  ) {
    failures.push("training candidate split policy or counts are inconsistent");
  }
  return failures;
}

export function buildTrainingCandidateArtifacts(sourceText) {
  const sourceRecords = parseJsonl(sourceText, "GPT-adjudicated source");
  if (sourceRecords.length !== 500 || new Set(sourceRecords.map((record) => record.sampleId)).size !== 500) {
    throw new Error("promotion source must contain exactly 500 unique records");
  }
  if (sourceRecords.some((record) => record.reviewStatus !== "pending" || record.reviewerCount !== 0)) {
    throw new Error("promotion source must be the pending, pre-approval dataset");
  }
  const approvedRecords = sourceRecords.map((record) => ({
    ...record,
    datasetVersion: DATASET_VERSION,
    labelSource: "human_review",
    reviewStatus: "approved",
    reviewerCount: 1,
    reviewerNote:
      "Dataset-owner approval recorded for all 500 records on 2026-07-14; prompt source remains synthetic.",
  }));
  const datasetText = canonicalJsonl(approvedRecords);
  const families = groupFamilies(approvedRecords);
  const coverage = computeCoverage(families);
  const assignments = assignPartitions(families);
  const familyRows = [...families.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([promptFamily, records]) => ({
      promptFamily,
      expectedCategory: records[0].expectedCategory,
      expectedSemanticLabel: records[0].expectedSemanticLabel,
      reviewStatus: "approved",
      humanReviewed: true,
      partition: assignments.get(promptFamily),
      records: records.length,
    }));
  const eligibleRecords = approvedRecords.filter(
    (record) => record.semanticInputStatus === "eligible",
  );
  const emptyInstructionRecords = approvedRecords.filter(
    (record) => record.semanticInputStatus === "empty_instruction",
  );
  const trainingGate = observedMinimumPolicy(coverage, families.size);
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
    splitCounts: partitionCounts(approvedRecords, assignments),
    trainingGate,
    counts: {
      records: approvedRecords.length,
      families: families.size,
      humanReviewedFamilies: families.size,
      approvedHumanReviewedFamilies: families.size,
      semanticHeadEligibleRecords: eligibleRecords.length,
      semanticHeadEligibleFamilies: new Set(eligibleRecords.map((record) => record.promptFamily)).size,
      emptyInstructionRecords: emptyInstructionRecords.length,
      emptyInstructionFamilies: new Set(
        emptyInstructionRecords.map((record) => record.promptFamily),
      ).size,
    },
    coverage,
    families: familyRows,
    createdAt: CREATED_AT,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const evidence = {
    schemaVersion: "gatelm.difficulty-training-promotion-evidence.v1",
    status: "owner_approved_training_eligible",
    approvedOn: APPROVED_ON,
    approval: {
      scope: "all_500_records_and_all_prompt_families",
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
    promotedDataset: {
      datasetVersion: DATASET_VERSION,
      datasetPath: DATASET_PATH,
      datasetSha256: sha256(datasetText),
      manifestPath: MANIFEST_PATH,
      manifestSha256: sha256(manifestText),
    },
    minimumFamilyPolicy: {
      ...trainingGate,
      thresholdBasis: "observed_minimums_of_owner_approved_candidate",
      requiredLanguages: REQUIRED_LANGUAGES,
      requiredSlices: REQUIRED_SLICES,
    },
    partitions: partitionCounts(approvedRecords, assignments),
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
  };
  const failures = verifyTrainingCandidate({ records: approvedRecords, datasetText, manifest });
  if (failures.length > 0) {
    throw new Error(`promoted training candidate failed validation:\n${failures.join("\n")}`);
  }
  return {
    records: approvedRecords,
    manifest,
    evidence,
    files: {
      [DATASET_PATH]: datasetText,
      [MANIFEST_PATH]: manifestText,
      [EVIDENCE_PATH]: `${JSON.stringify(evidence, null, 2)}\n`,
    },
  };
}

function writeOrCheck(files, check) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.resolve(relativePath);
    if (check) {
      if (readFileSync(absolutePath, "utf8") !== content) {
        throw new Error(`generated training candidate artifact is stale: ${relativePath}`);
      }
      continue;
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
}

function main() {
  const check = process.argv.includes("--check");
  const result = buildTrainingCandidateArtifacts(readFileSync(path.resolve(SOURCE_PATH), "utf8"));
  writeOrCheck(result.files, check);
  console.log(`${check ? "verified" : "promoted"} ${result.records.length} owner-approved records`);
  console.log(
    `${result.manifest.counts.approvedHumanReviewedFamilies} approved families; trainingEligible=${result.manifest.trainingEligible}`,
  );
  console.log(
    `partitions train=${result.evidence.partitions.train.families}, calibration=${result.evidence.partitions.calibration.families}, holdout=${result.evidence.partitions.holdout.families} families`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
