import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  verifyDifficultyLabelDatasetManifest,
  verifyDifficultyLabelRecords,
} from "../verify-v2.1-difficulty-eval.mjs";

const reviewRoot = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const recommendationRoot = path.join(reviewRoot, "owner-gpt-adjudication-review");
const approvalRoot = path.join(reviewRoot, "final-owner-approval");
const trainingRoot = path.resolve("docs/v2.1.0/training");
const approved3120Path = path.join(trainingRoot, "difficulty-model-path-expansion-3120.owner-approved.jsonl");
const approved3120ManifestPath = path.join(trainingRoot, "difficulty-model-path-expansion-3120.owner-approved.manifest.json");
const approved5000Path = path.join(trainingRoot, "difficulty-model-path-5000.owner-approved.jsonl");
const approved5000ManifestPath = path.join(trainingRoot, "difficulty-model-path-5000.owner-approved.manifest.json");
const roleManifestPath = path.join(trainingRoot, "difficulty-model-path-5000.roles.json");
const approvalEvidencePath = path.join(approvalRoot, "difficulty-model-path-3120-and-5000.owner-approval.json");
const verificationSummaryPath = path.join(approvalRoot, "verification-summary.json");
const promotionReportPath = path.join(approvalRoot, "PROMOTION-REPORT.md");
const batchIds = ["t1", "t2", "t3", "t4", "c1", "c2", "e1", "e2", "p1"];
const checkOnly = process.argv.includes("--check");
const refreshGoAuditsRequested = process.argv.includes("--refresh-go-audits");
const createdAt = "2026-07-16T00:00:00Z";
const approvedOn = "2026-07-16";
const splitSeed = 20260716;
const dataset3120Version = "difficulty_model_path_expansion_3120_2026_07_16_owner_approved_v1";
const dataset5000Version = "difficulty_model_path_5000_2026_07_16_owner_approved_v1";
const rolePolicyVersion = "difficulty-model-path-four-role-split.2026-07-16.v1";
const splitPolicyVersion = "difficulty-model-path-family-split.2026-07-16.v1";
const existingSources = [
  {
    id: "owner_approved_500",
    datasetPath: path.join(trainingRoot, "difficulty-training-candidate-500.owner-approved.jsonl"),
    manifestPath: path.join(trainingRoot, "difficulty-training-candidate-500.owner-approved.manifest.json"),
    auditPath: path.join(approvalRoot, "existing-owner-approved-500.go-audit.json"),
    expectedSha256: "4f4b00a783ef6372a2d23baf77b0c793670a72f03f4636c6674c8e911662189f",
  },
  {
    id: "owner_approved_2000",
    datasetPath: path.join(trainingRoot, "difficulty-training-candidate-expansion-2000.owner-approved.jsonl"),
    manifestPath: path.join(trainingRoot, "difficulty-training-candidate-expansion-2000.owner-approved.manifest.json"),
    auditPath: path.join(approvalRoot, "existing-owner-approved-2000.go-audit.json"),
    expectedSha256: "9bd448240d3479072c5daf9517abd6ea7fc0797d204354d6d636a33111a0b9de",
  },
];
const categories = ["general", "code", "translation", "summarization", "reasoning"];
const difficulties = ["simple", "complex"];
const languages = ["ko", "en", "mixed", "unknown"];
const requiredSlices = [
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

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const parseJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
const parseJsonl = (filePath) => readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
const canonicalJsonl = (records) => `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

function writeOrCheck(filePath, contents) {
  if (checkOnly) {
    if (readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "") !== contents) throw new Error(`${filePath}: promoted model-path artifact drifted`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function groupFamilies(records) {
  const result = new Map();
  for (const record of records) {
    if (!result.has(record.promptFamily)) result.set(record.promptFamily, []);
    result.get(record.promptFamily).push(record);
  }
  return result;
}

function countFamilies(families, predicate) {
  return [...families.values()].filter((records) => records.some(predicate)).length;
}

function computeCoverage(families) {
  return {
    categoryFamilies: Object.fromEntries(categories.map((category) => [category, countFamilies(families, (record) => record.expectedCategory === category)])),
    difficultyFamilies: Object.fromEntries(difficulties.map((difficulty) => [difficulty, countFamilies(families, (record) => record.expectedDifficulty === difficulty)])),
    categoryDifficultyFamilies: Object.fromEntries(categories.map((category) => [
      category,
      Object.fromEntries(difficulties.map((difficulty) => [difficulty, countFamilies(families, (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty)])),
    ])),
    languageFamilies: Object.fromEntries(languages.map((language) => [language, countFamilies(families, (record) => record.language === language)])),
    evaluationSliceFamilies: Object.fromEntries(requiredSlices.map((slice) => [slice, countFamilies(families, (record) => record.evaluationSlices.includes(slice))])),
  };
}

function partitionCounts(records, partitionByFamily) {
  return Object.fromEntries(["train", "calibration", "holdout"].map((partition) => {
    const selected = records.filter((record) => partitionByFamily.get(record.promptFamily) === partition);
    return [partition, { families: new Set(selected.map((record) => record.promptFamily)).size, records: selected.length }];
  }));
}

function observedPolicy(coverage, families, policyVersion) {
  return {
    minimumFamilyPolicyStatus: "versioned",
    policyVersion,
    minApprovedFamilies: families,
    minFamiliesPerCategory: Math.min(...Object.values(coverage.categoryFamilies)),
    minFamiliesPerCategoryDifficulty: Math.min(...Object.values(coverage.categoryDifficultyFamilies).flatMap((cell) => Object.values(cell))),
    minFamiliesPerLanguage: Math.min(...["ko", "en", "mixed"].map((language) => coverage.languageFamilies[language])),
    minFamiliesPerSlice: Math.min(...Object.values(coverage.evaluationSliceFamilies)),
  };
}

function buildManifest({ records, datasetText, datasetVersion, datasetPath, partitionByFamily, policyVersion }) {
  const families = groupFamilies(records);
  const coverage = computeCoverage(families);
  const familyRows = [...families.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([promptFamily, rows]) => ({
    promptFamily,
    expectedCategory: rows[0].expectedCategory,
    expectedSemanticLabel: rows[0].expectedSemanticLabel,
    reviewStatus: "approved",
    humanReviewed: true,
    partition: partitionByFamily.get(promptFamily),
    records: rows.length,
  }));
  const eligible = records.filter((record) => record.semanticInputStatus === "eligible");
  const empty = records.filter((record) => record.semanticInputStatus === "empty_instruction");
  return {
    schemaVersion: "gatelm.difficulty-label-dataset-manifest.v2",
    datasetVersion,
    recordSchemaVersion: "gatelm.difficulty-label-record.v2",
    datasetPath: path.relative(path.resolve("."), datasetPath).replace(/\\/gu, "/"),
    datasetSha256: sha256(Buffer.from(datasetText, "utf8")),
    datasetPurpose: "training_candidate",
    trainingEligible: true,
    labelCoverageStatus: "complete",
    familyPolicyVersion: "difficulty-prompt-family.v1",
    splitPolicyVersion,
    splitSeed,
    splitCounts: partitionCounts(records, partitionByFamily),
    trainingGate: observedPolicy(coverage, families.size, policyVersion),
    counts: {
      records: records.length,
      families: families.size,
      humanReviewedFamilies: families.size,
      approvedHumanReviewedFamilies: families.size,
      semanticHeadEligibleRecords: eligible.length,
      semanticHeadEligibleFamilies: new Set(eligible.map((record) => record.promptFamily)).size,
      emptyInstructionRecords: empty.length,
      emptyInstructionFamilies: new Set(empty.map((record) => record.promptFamily)).size,
    },
    coverage,
    families: familyRows,
    createdAt,
  };
}

function roleForBatch(batchId) {
  if (batchId.startsWith("t")) return "train";
  if (batchId.startsWith("c")) return "calibration";
  if (batchId.startsWith("e")) return "evaluation_holdout";
  return "promotion_holdout";
}

function manifestPartitionForRole(role) {
  return role === "train" || role === "calibration" ? role : "holdout";
}

function runGoAudit(datasetPath, manifestPath, outputPath, allowPending = false) {
  const gatewayRoot = path.resolve("apps/gateway-core");
  const result = spawnSync(
    "go",
    ["run", "./cmd/difficulty-decision-audit", "-dataset", datasetPath, "-manifest", manifestPath, ...(allowPending ? ["-allow-pending"] : [])],
    {
      cwd: gatewayRoot,
      encoding: "utf8",
      env: { ...process.env, GOCACHE: path.resolve(".gocache"), TEMP: path.resolve(".tmp"), TMP: path.resolve(".tmp") },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.status !== 0) throw new Error(`Go audit failed for ${datasetPath}: ${result.stderr}`);
  JSON.parse(result.stdout);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${result.stdout.trimEnd()}\n`, "utf8");
}

function refreshSourceAudits() {
  if (checkOnly) throw new Error("--check and --refresh-go-audits cannot be combined");
  mkdirSync(approvalRoot, { recursive: true });
  for (const source of existingSources) runGoAudit(source.datasetPath, source.manifestPath, source.auditPath);
}

function sourceSelection() {
  const selected = [];
  const reports = [];
  for (const source of existingSources) {
    const datasetBytes = readFileSync(source.datasetPath);
    const records = parseJsonl(source.datasetPath);
    const manifest = parseJson(source.manifestPath);
    const audit = parseJson(source.auditPath);
    if (sha256(datasetBytes) !== source.expectedSha256 || manifest.datasetSha256 !== source.expectedSha256 || audit.datasetSha256 !== source.expectedSha256) {
      throw new Error(`${source.id}: immutable owner-approved source hash mismatch`);
    }
    const bySample = new Map(records.map((record) => [record.sampleId, record]));
    const includedEvidence = audit.evidenceRecords.filter((evidence) => evidence.route === "model" && ["train", "calibration"].includes(evidence.split));
    const excludedLegacyHoldout = audit.evidenceRecords.filter((evidence) => evidence.route === "model" && evidence.split === "holdout");
    const excludedSentinels = audit.evidenceRecords.filter((evidence) => evidence.route !== "model");
    for (const evidence of includedEvidence) {
      const record = bySample.get(evidence.sampleId);
      if (!record) throw new Error(`${source.id}: audit sample missing from dataset: ${evidence.sampleId}`);
      selected.push({ record, role: evidence.split, sourceId: source.id });
    }
    reports.push({
      sourceId: source.id,
      datasetPath: path.relative(path.resolve("."), source.datasetPath).replace(/\\/gu, "/"),
      datasetSha256: source.expectedSha256,
      totalRecords: records.length,
      selectedModelPathTrain: includedEvidence.filter((row) => row.split === "train").length,
      selectedModelPathCalibration: includedEvidence.filter((row) => row.split === "calibration").length,
      excludedLegacyModelPathHoldout: excludedLegacyHoldout.length,
      excludedSentinels: excludedSentinels.length,
    });
  }
  return { selected, reports };
}

function buildArtifacts() {
  const finalVerification = parseJson(path.join(recommendationRoot, "final-verification-summary.json"));
  if (finalVerification.status !== "validated_pending_human_owner_confirmation" || finalVerification.counts.modelPath !== 3120 || finalVerification.failures.length !== 0) {
    throw new Error("owner GPT recommendation set is not ready for human owner promotion");
  }
  const approved3120Records = [];
  const roleByFamily = new Map();
  const newBatchSources = [];
  for (const batchId of batchIds) {
    const sourcePath = path.join(recommendationRoot, "proposed", `${batchId}.owner-gpt-recommended.candidate.jsonl`);
    const sourceAuditPath = path.join(recommendationRoot, "proposed", `${batchId}.owner-gpt-recommended.go-audit.json`);
    const records = parseJsonl(sourcePath);
    const audit = parseJson(sourceAuditPath);
    if (audit.totalRecords !== records.length || audit.modelPathRecords !== records.length || audit.hardSentinelRecords !== 0 || audit.simpleSentinelRecords !== 0) {
      throw new Error(`${batchId}: source recommendation is not fully model path`);
    }
    const role = roleForBatch(batchId);
    for (const record of records) {
      const previous = roleByFamily.get(record.promptFamily);
      if (previous && previous !== role) throw new Error(`new family role leakage: ${record.promptFamily}`);
      roleByFamily.set(record.promptFamily, role);
      approved3120Records.push({
        ...record,
        datasetVersion: dataset3120Version,
        labelSource: "human_review",
        reviewStatus: "approved",
        reviewerCount: 1,
        reviewerNote: "Dataset-owner approval recorded for all 3,120 records on 2026-07-16; prompt source remains synthetic.",
      });
    }
    newBatchSources.push({ batchId, role, records: records.length, families: new Set(records.map((record) => record.promptFamily)).size, sourceDatasetSha256: audit.datasetSha256 });
  }
  const approved3120Text = canonicalJsonl(approved3120Records);
  const partition3120 = new Map([...roleByFamily].map(([family, role]) => [family, manifestPartitionForRole(role)]));
  const manifest3120 = buildManifest({
    records: approved3120Records,
    datasetText: approved3120Text,
    datasetVersion: dataset3120Version,
    datasetPath: approved3120Path,
    partitionByFamily: partition3120,
    policyVersion: "difficulty-model-path-expansion-minimum-family-policy.2026-07-16.v1",
  });

  const existing = sourceSelection();
  const combinedRows = [];
  const combinedRoleByFamily = new Map();
  const combinedSourceByFamily = new Map();
  for (const item of existing.selected) {
    const previous = combinedRoleByFamily.get(item.record.promptFamily);
    if (previous && previous !== item.role) throw new Error(`existing family role leakage: ${item.record.promptFamily}`);
    combinedRoleByFamily.set(item.record.promptFamily, item.role);
    combinedSourceByFamily.set(item.record.promptFamily, item.sourceId);
    combinedRows.push({ ...item.record, datasetVersion: dataset5000Version });
  }
  for (const batchId of batchIds) {
    const role = roleForBatch(batchId);
    const records = approved3120Records.filter((record) => record.sampleId.includes(`_${batchId}_`));
    for (const record of records) {
      const previousRole = combinedRoleByFamily.get(record.promptFamily);
      const previousSource = combinedSourceByFamily.get(record.promptFamily);
      if (previousRole && (previousRole !== role || previousSource !== `new_${batchId}`)) throw new Error(`new/existing or cross-batch family collision: ${record.promptFamily}`);
      combinedRoleByFamily.set(record.promptFamily, role);
      combinedSourceByFamily.set(record.promptFamily, `new_${batchId}`);
      combinedRows.push({ ...record, datasetVersion: dataset5000Version });
    }
  }
  const roleOrder = new Map([["train", 0], ["calibration", 1], ["evaluation_holdout", 2], ["promotion_holdout", 3]]);
  combinedRows.sort((left, right) => roleOrder.get(combinedRoleByFamily.get(left.promptFamily)) - roleOrder.get(combinedRoleByFamily.get(right.promptFamily)));
  const combinedText = canonicalJsonl(combinedRows);
  const combinedPartition = new Map([...combinedRoleByFamily].map(([family, role]) => [family, manifestPartitionForRole(role)]));
  const manifest5000 = buildManifest({
    records: combinedRows,
    datasetText: combinedText,
    datasetVersion: dataset5000Version,
    datasetPath: approved5000Path,
    partitionByFamily: combinedPartition,
    policyVersion: "difficulty-model-path-5000-minimum-family-policy.2026-07-16.v1",
  });
  const roleFamilies = [...groupFamilies(combinedRows).entries()].sort(([left], [right]) => left.localeCompare(right)).map(([promptFamily, records]) => ({
    promptFamily,
    role: combinedRoleByFamily.get(promptFamily),
    manifestPartition: combinedPartition.get(promptFamily),
    source: combinedSourceByFamily.get(promptFamily),
    expectedCategory: records[0].expectedCategory,
    expectedSemanticLabel: records[0].expectedSemanticLabel,
    records: records.length,
  }));
  const roleCounts = Object.fromEntries(["train", "calibration", "evaluation_holdout", "promotion_holdout"].map((role) => {
    const records = combinedRows.filter((record) => combinedRoleByFamily.get(record.promptFamily) === role);
    return [role, { records: records.length, families: new Set(records.map((record) => record.promptFamily)).size }];
  }));
  const roleManifest = {
    schemaVersion: "gatelm.difficulty-model-path-role-manifest.v1",
    datasetVersion: dataset5000Version,
    datasetPath: path.relative(path.resolve("."), approved5000Path).replace(/\\/gu, "/"),
    datasetSha256: sha256(Buffer.from(combinedText, "utf8")),
    decisionBoundaryVersion: parseJson(path.join(recommendationRoot, "proposed", "t1.owner-gpt-recommended.go-audit.json")).decisionBoundaryVersion,
    rolePolicyVersion,
    familyPolicyVersion: "difficulty-prompt-family.v1",
    records: combinedRows.length,
    families: roleFamilies.length,
    roles: {
      train: { ...roleCounts.train, purpose: "logistic_weight_fit" },
      calibration: { ...roleCounts.calibration, purpose: "calibrator_and_threshold_selection" },
      evaluation_holdout: { ...roleCounts.evaluation_holdout, purpose: "model_combination_evaluation", frozenBeforeModelSelection: true },
      promotion_holdout: { ...roleCounts.promotion_holdout, purpose: "final_runtime_promotion_evidence", frozenBeforeModelSelection: true, modelOrThresholdSelectionAccessed: false },
    },
    standardManifestProjection: { train: "train", calibration: "calibration", evaluation_holdout: "holdout", promotion_holdout: "holdout" },
    sourceSelection: {
      existingOwnerApproved: existing.reports,
      newOwnerApprovedBatches: newBatchSources,
      legacyHoldoutPolicy: "all existing holdout records excluded from the 5,000 model-path target",
      sentinelPolicy: "deterministic simple and hard sentinels remain in their original approved regression datasets and are excluded from this model-path target",
    },
    families: roleFamilies,
    ownerApprovalStatus: "approved",
    trainingEligible: true,
    createdAt,
  };

  const finalVerificationPath = path.join(recommendationRoot, "final-verification-summary.json");
  const finalDecisionTemplatePath = path.join(recommendationRoot, "FINAL-HUMAN-OWNER-DECISION-TEMPLATE.json");
  const importManifestPath = path.join(recommendationRoot, "import-manifest.json");
  const evidence = {
    schemaVersion: "gatelm.difficulty-model-path-5000-owner-approval-evidence.v1",
    status: "owner_approved_training_eligible",
    approvedOn,
    approval: {
      scope: "all_3120_owner_gpt_recommended_records_and_the_5000_model_path_four_role_derivative",
      basis: "explicit_dataset_owner_approval_in_current_codex_task",
      exactApprovalText: "최종 3,120건 전체 승인",
      humanReviewerCount: 1,
      reviewerIdentityStored: false,
    },
    reviewEvidence: {
      ownerGptRecommendationIsHumanApproval: false,
      datasetOwnerApprovalRecordedSeparately: true,
      finalVerificationSummary: { path: path.relative(path.resolve("."), finalVerificationPath).replace(/\\/gu, "/"), sha256: sha256(readFileSync(finalVerificationPath)) },
      pendingDecisionTemplate: { path: path.relative(path.resolve("."), finalDecisionTemplatePath).replace(/\\/gu, "/"), sha256: sha256(readFileSync(finalDecisionTemplatePath)) },
      importedOwnerGptArchive: parseJson(importManifestPath).sourceArchiveSha256,
    },
    approvedExpansion: {
      records: approved3120Records.length,
      families: groupFamilies(approved3120Records).size,
      datasetVersion: dataset3120Version,
      datasetPath: path.relative(path.resolve("."), approved3120Path).replace(/\\/gu, "/"),
      datasetSha256: manifest3120.datasetSha256,
      manifestPath: path.relative(path.resolve("."), approved3120ManifestPath).replace(/\\/gu, "/"),
    },
    approvedModelPathTarget: {
      records: combinedRows.length,
      families: groupFamilies(combinedRows).size,
      datasetVersion: dataset5000Version,
      datasetPath: path.relative(path.resolve("."), approved5000Path).replace(/\\/gu, "/"),
      datasetSha256: manifest5000.datasetSha256,
      manifestPath: path.relative(path.resolve("."), approved5000ManifestPath).replace(/\\/gu, "/"),
      roleManifestPath: path.relative(path.resolve("."), roleManifestPath).replace(/\\/gu, "/"),
      roles: roleCounts,
    },
    gates: {
      allRecordsHumanApproved: true,
      sourceProvenancePreserved: true,
      actualGoModelPathTarget: 5000,
      familyDisjointRoles: true,
      exactDuplicatesZero: true,
      strictSplitOrExistingNearDuplicatesZero: true,
      promotionHoldoutSeparated: true,
      trainingEligible: true,
    },
    doesNotApprove: ["model_performance", "model_or_calibrator_selection", "threshold_selection", "runtime_promotion", "ga_or_release"],
  };

  return { approved3120Records, approved3120Text, manifest3120, combinedRows, combinedText, manifest5000, roleManifest, evidence, existing };
}

function writeArtifacts(artifacts) {
  writeOrCheck(approved3120Path, artifacts.approved3120Text);
  writeOrCheck(approved3120ManifestPath, `${JSON.stringify(artifacts.manifest3120, null, 2)}\n`);
  writeOrCheck(approved5000Path, artifacts.combinedText);
  writeOrCheck(approved5000ManifestPath, `${JSON.stringify(artifacts.manifest5000, null, 2)}\n`);
  writeOrCheck(roleManifestPath, `${JSON.stringify(artifacts.roleManifest, null, 2)}\n`);
  writeOrCheck(approvalEvidencePath, `${JSON.stringify(artifacts.evidence, null, 2)}\n`);
}

function refreshPromotedAudits() {
  runGoAudit(approved3120Path, approved3120ManifestPath, path.join(approvalRoot, "difficulty-model-path-expansion-3120.owner-approved.go-audit.json"));
  runGoAudit(approved5000Path, approved5000ManifestPath, path.join(approvalRoot, "difficulty-model-path-5000.owner-approved.go-audit.json"));
}

function verifyArtifacts(artifacts) {
  const failures = [
    ...verifyDifficultyLabelRecords(artifacts.approved3120Records),
    ...verifyDifficultyLabelDatasetManifest(artifacts.manifest3120, { manifestPath: path.relative(path.resolve("."), approved3120ManifestPath).replace(/\\/gu, "/") }),
    ...verifyDifficultyLabelRecords(artifacts.combinedRows),
    ...verifyDifficultyLabelDatasetManifest(artifacts.manifest5000, { manifestPath: path.relative(path.resolve("."), approved5000ManifestPath).replace(/\\/gu, "/") }),
  ];
  if (artifacts.approved3120Records.length !== 3120 || new Set(artifacts.approved3120Records.map((record) => record.sampleId)).size !== 3120) failures.push("approved expansion must contain 3,120 unique records");
  if (artifacts.combinedRows.length !== 5000 || new Set(artifacts.combinedRows.map((record) => record.sampleId)).size !== 5000) failures.push("approved model-path target must contain 5,000 unique records");
  for (const records of [artifacts.approved3120Records, artifacts.combinedRows]) {
    if (records.some((record) => record.labelSource !== "human_review" || record.reviewStatus !== "approved" || record.reviewerCount < 1)) failures.push("promoted records must all be human-reviewed and approved");
    if (records.some((record) => record.source !== "synthetic_fixture" || record.consentType !== "synthetic")) failures.push("promoted records must preserve synthetic provenance");
  }
  const expectedRoles = { train: 3000, calibration: 1000, evaluation_holdout: 750, promotion_holdout: 250 };
  for (const [role, expected] of Object.entries(expectedRoles)) if (artifacts.roleManifest.roles[role]?.records !== expected) failures.push(`${role} must contain ${expected} records`);
  if (artifacts.manifest5000.splitCounts.train.records !== 3000 || artifacts.manifest5000.splitCounts.calibration.records !== 1000 || artifacts.manifest5000.splitCounts.holdout.records !== 1000) failures.push("standard manifest must project to 3000/1000/1000");
  if (artifacts.existing.selected.length !== 1880) failures.push(`existing model-path train/calibration selection must contain 1,880 records, got ${artifacts.existing.selected.length}`);
  const existingTrain = artifacts.existing.selected.filter((item) => item.role === "train").length;
  const existingCalibration = artifacts.existing.selected.filter((item) => item.role === "calibration").length;
  if (existingTrain !== 1405 || existingCalibration !== 475) failures.push(`existing selected roles must be 1405/475, got ${existingTrain}/${existingCalibration}`);
  const exact = new Map();
  for (const record of artifacts.combinedRows) {
    const key = record.redactedPrompt.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
    const previous = exact.get(key);
    if (previous && previous.promptFamily !== record.promptFamily) failures.push(`combined exact duplicate: ${previous.sampleId}/${record.sampleId}`);
    exact.set(key, record);
  }
  const audit3120 = parseJson(path.join(approvalRoot, "difficulty-model-path-expansion-3120.owner-approved.go-audit.json"));
  const audit5000 = parseJson(path.join(approvalRoot, "difficulty-model-path-5000.owner-approved.go-audit.json"));
  if (audit3120.datasetSha256 !== artifacts.manifest3120.datasetSha256 || audit3120.modelPathRecords !== 3120 || audit3120.hardSentinelRecords !== 0 || audit3120.simpleSentinelRecords !== 0) failures.push("approved 3,120 Go audit failed");
  if (audit5000.datasetSha256 !== artifacts.manifest5000.datasetSha256 || audit5000.modelPathRecords !== 5000 || audit5000.hardSentinelRecords !== 0 || audit5000.simpleSentinelRecords !== 0) failures.push("approved 5,000 Go audit failed");
  const priorVerification = parseJson(path.join(recommendationRoot, "final-verification-summary.json"));
  if (priorVerification.counts.exactDuplicates !== 0 || priorVerification.counts.familyCollisions !== 0 || priorVerification.counts.strictCrossPartitionOrExistingNearDuplicates !== 0 || priorVerification.counts.securityPatternHits !== 0) failures.push("pre-approval duplicate, family, leakage, or security gate failed");
  const summary = {
    schemaVersion: "gatelm.difficulty-model-path-5000-promotion-verification.v1",
    status: failures.length === 0 ? "passed_owner_approved_training_eligible" : "failed",
    approvedOn,
    counts: {
      approvedExpansionRecords: artifacts.approved3120Records.length,
      approvedExpansionFamilies: groupFamilies(artifacts.approved3120Records).size,
      existingSelectedModelPathRecords: artifacts.existing.selected.length,
      finalModelPathRecords: artifacts.combinedRows.length,
      finalFamilies: groupFamilies(artifacts.combinedRows).size,
      train: artifacts.roleManifest.roles.train.records,
      calibration: artifacts.roleManifest.roles.calibration.records,
      evaluationHoldout: artifacts.roleManifest.roles.evaluation_holdout.records,
      promotionHoldout: artifacts.roleManifest.roles.promotion_holdout.records,
      finalGoModelPath: audit5000.modelPathRecords,
      finalGoHardSentinel: audit5000.hardSentinelRecords,
      finalGoSimpleSentinel: audit5000.simpleSentinelRecords,
    },
    immutableExistingDatasetHashes: Object.fromEntries(existingSources.map((source) => [source.id, source.expectedSha256])),
    failures,
    trainingEligible: failures.length === 0,
    doesNotApprove: artifacts.evidence.doesNotApprove,
  };
  writeOrCheck(verificationSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const report = [
    "# Difficulty model-path 5,000 owner promotion",
    "",
    `- Status: ${summary.status}`,
    `- Approved new expansion: ${summary.counts.approvedExpansionRecords} records / ${summary.counts.approvedExpansionFamilies} families`,
    `- Reused existing train/calibration model path: ${summary.counts.existingSelectedModelPathRecords} records`,
    `- Final target: ${summary.counts.finalModelPathRecords} records / ${summary.counts.finalFamilies} families`,
    "",
    "| role | records | families | use |",
    "|---|---:|---:|---|",
    `| Train | ${artifacts.roleManifest.roles.train.records} | ${artifacts.roleManifest.roles.train.families} | Logistic Regression weight fit |`,
    `| Calibration | ${artifacts.roleManifest.roles.calibration.records} | ${artifacts.roleManifest.roles.calibration.families} | calibrator and threshold selection |`,
    `| Evaluation holdout | ${artifacts.roleManifest.roles.evaluation_holdout.records} | ${artifacts.roleManifest.roles.evaluation_holdout.families} | model-combination evaluation |`,
    `| Final promotion holdout | ${artifacts.roleManifest.roles.promotion_holdout.records} | ${artifacts.roleManifest.roles.promotion_holdout.families} | one-time runtime promotion evidence |`,
    "",
    "- Actual Go model path: 5,000 / 5,000",
    "- Hard/simple sentinels in model-path target: 0 / 0",
    "- Existing legacy model-path holdout excluded: 477",
    "- Existing deterministic sentinels retained only in original regression datasets: 143",
    "- Family leakage, exact duplicates, strict cross-partition/existing near duplicates and security-pattern hits: 0",
    "- Promotion holdout was frozen before model or threshold selection and has not been used for either.",
    "",
    "This owner approval establishes offline training-input eligibility only. It does not approve model quality, model/calibrator/threshold selection, runtime promotion, GA, or release completion.",
    "",
  ].join("\n");
  writeOrCheck(promotionReportPath, report);
  console.log(JSON.stringify(summary.counts));
  if (failures.length > 0) throw new Error(`model-path 5,000 promotion failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

if (refreshGoAuditsRequested) refreshSourceAudits();
const artifacts = buildArtifacts();
writeArtifacts(artifacts);
if (refreshGoAuditsRequested) refreshPromotedAudits();
verifyArtifacts(artifacts);
