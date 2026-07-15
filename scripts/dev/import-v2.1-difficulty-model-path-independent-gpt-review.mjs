import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

const reviewRoot = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const importRoot = path.join(reviewRoot, "independent-gpt-review");
const rawRoot = path.join(importRoot, "raw");
const normalizedRoot = path.join(importRoot, "normalized");
const proposedRoot = path.join(importRoot, "proposed");
const diffRoot = path.join(importRoot, "diff");
const batchIds = ["t1", "t2", "t3", "t4", "c1", "c2", "e1", "e2", "p1"];
const checkOnly = process.argv.includes("--check");
const sourceArgument = process.argv.find((argument) => argument.startsWith("--source-dir="));
const sourceRoot = sourceArgument ? path.resolve(sourceArgument.slice("--source-dir=".length)) : rawRoot;
const activePacketRoot = path.join(reviewRoot, "gpt-review-packets");
const packetSourceRoot = sourceRoot === rawRoot ? rawRoot : activePacketRoot;
const importedAt = "2026-07-15T00:00:00Z";

const reviewedFieldMap = {
  expectedCategory: "reviewedExpectedCategory",
  expectedDifficulty: "reviewedExpectedDifficulty",
  semanticInputStatus: "reviewedSemanticInputStatus",
  taskBucket: "reviewedTaskBucket",
  constraintBucket: "reviewedConstraintBucket",
  scopeBucket: "reviewedScopeBucket",
  dependencyBucket: "reviewedDependencyBucket",
  expectedSemanticLabel: "reviewedExpectedSemanticLabel",
  expectedInstructionPayloadBoundary: "reviewedExpectedInstructionPayloadBoundary",
  evaluationSlices: "reviewedEvaluationSlices",
};
const allowedDecisions = new Set(["accept", "revise_prompt", "revise_labels", "revise_prompt_and_labels", "reject", "needs_human_adjudication"]);
const allowedConfidence = new Set(["high", "medium", "low"]);
const forbiddenPatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/iu,
  /\bAuthorization\s*:/iu,
  /\bapi[_ -]?key\s*[:=]/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b\d{3}-\d{2}-\d{4}\b/u,
];

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readText(filePath) {
  return readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
}

function parseJson(filePath) {
  return JSON.parse(readText(filePath));
}

function parseJsonl(filePath) {
  return readText(filePath)
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function stable(value) {
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  if (value && typeof value === "object") return JSON.stringify(value);
  return JSON.stringify(value);
}

function counter(values, selector) {
  const result = {};
  for (const value of values) {
    const keys = selector(value);
    for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function writeOrCheck(filePath, contents) {
  if (checkOnly) {
    const actual = readFileSync(filePath, "utf8");
    if (actual !== contents) throw new Error(`${filePath}: stale independent GPT import artifact`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function writeImmutableRawSnapshot(filePath, contents) {
  if (existsSync(filePath)) {
    if (readFileSync(filePath, "utf8") !== contents) throw new Error(`${filePath}: immutable raw review snapshot mismatch`);
    return;
  }
  if (checkOnly) throw new Error(`${filePath}: missing immutable raw review snapshot`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function validateReviewRow(row, batchId, inputRow, index, failures) {
  const prefix = `${batchId}:${index + 1}:${row?.sampleId ?? "missing_sample"}`;
  if (row?.schemaVersion !== "gatelm.difficulty-independent-gpt-review.v1") failures.push(`${prefix}: schemaVersion`);
  if (row?.batchId !== batchId) failures.push(`${prefix}: batchId`);
  if (row?.sampleId !== inputRow.sampleId) failures.push(`${prefix}: sampleId/order`);
  if (row?.promptFamily !== inputRow.promptFamily) failures.push(`${prefix}: promptFamily`);
  if (!allowedDecisions.has(row?.decision)) failures.push(`${prefix}: decision`);
  if (!allowedConfidence.has(row?.confidence)) failures.push(`${prefix}: confidence`);
  if (typeof row?.proposedPrompt !== "string" || row.proposedPrompt.trim().length === 0) failures.push(`${prefix}: proposedPrompt`);
  if (!Array.isArray(row?.reviewedEvaluationSlices)) failures.push(`${prefix}: reviewedEvaluationSlices`);
  if (!Array.isArray(row?.issueCodes)) failures.push(`${prefix}: issueCodes`);
  if (typeof row?.rationale !== "string" || row.rationale.trim().length === 0) failures.push(`${prefix}: rationale`);
  if (forbiddenPatterns.some((pattern) => pattern.test(row?.proposedPrompt ?? ""))) failures.push(`${prefix}: forbidden data pattern`);
}

const generationIndex = parseJson(path.join(reviewRoot, "generation-index.json"));
const providedSummaryPath = path.join(sourceRoot, "VALIDATION-SUMMARY.json");
if (!existsSync(providedSummaryPath)) throw new Error(`missing provided validation summary: ${providedSummaryPath}`);
const providedSummaryText = readText(providedSummaryPath);
const providedSummarySnapshot = providedSummaryText.endsWith("\n") ? providedSummaryText : `${providedSummaryText}\n`;
const providedSummary = JSON.parse(providedSummaryText);
const importFailures = [];
const allDiffs = [];
const allReviewRows = [];
const allProposedRecords = [];
const normalizationAudit = [];
const batchSummaries = [];
const rawFiles = [];

writeImmutableRawSnapshot(path.join(rawRoot, "VALIDATION-SUMMARY.json"), providedSummarySnapshot);
rawFiles.push({ file: "VALIDATION-SUMMARY.json", sha256: sha256(providedSummarySnapshot) });

for (const packetFile of ["GPT-REVIEW-INSTRUCTIONS.md", "LABEL-GUIDE.md", "PACKET-MANIFEST.json"]) {
  const packetText = readText(path.join(packetSourceRoot, packetFile));
  const packetSnapshot = packetText.endsWith("\n") ? packetText : `${packetText}\n`;
  writeImmutableRawSnapshot(path.join(rawRoot, packetFile), packetSnapshot);
  rawFiles.push({ file: packetFile, sha256: sha256(packetSnapshot) });
}

for (const batchId of batchIds) {
  const outputSourcePath = path.join(sourceRoot, `${batchId}.gpt-review.output.jsonl`);
  if (!existsSync(outputSourcePath)) throw new Error(`missing GPT output: ${outputSourcePath}`);
  const rawText = readText(outputSourcePath);
  const rawSnapshot = rawText.endsWith("\n") ? rawText : `${rawText}\n`;
  writeImmutableRawSnapshot(path.join(rawRoot, `${batchId}.gpt-review.output.jsonl`), rawSnapshot);
  rawFiles.push({ file: `${batchId}.gpt-review.output.jsonl`, sha256: sha256(rawSnapshot) });

  const inputRows = parseJsonl(path.join(reviewRoot, "gpt-review-packets", `${batchId}.gpt-review.input.jsonl`));
  const reviewRows = parseJsonl(outputSourcePath);
  const indexEntry = generationIndex.batches.find((batch) => batch.batchId === batchId);
  const candidateRecords = parseJsonl(path.resolve(indexEntry.datasetPath));
  if (reviewRows.length !== inputRows.length || reviewRows.length !== candidateRecords.length) {
    importFailures.push(`${batchId}: row count output=${reviewRows.length} input=${inputRows.length} candidate=${candidateRecords.length}`);
  }

  const seen = new Set();
  const normalized = [];
  const proposedRecords = [];
  const batchDiffs = [];
  for (let index = 0; index < reviewRows.length; index += 1) {
    const row = reviewRows[index];
    const inputRow = inputRows[index];
    const before = candidateRecords[index];
    validateReviewRow(row, batchId, inputRow, index, importFailures);
    if (seen.has(row.sampleId)) importFailures.push(`${batchId}:${row.sampleId}: duplicate output sampleId`);
    seen.add(row.sampleId);
    if (before.sampleId !== row.sampleId) importFailures.push(`${batchId}:${index + 1}: candidate order mismatch`);

    const normalizedRow = {
      ...row,
      proposedPrompt: row.proposedPrompt.replace(/\r\n/gu, "\n"),
      reviewedEvaluationSlices: [...new Set(row.reviewedEvaluationSlices)],
      issueCodes: [...new Set(row.issueCodes)].sort(),
    };
    if (normalizedRow.reviewedExpectedInstructionPayloadBoundary?.boundaryType === "fenced_block") {
      normalizationAudit.push({
        schemaVersion: "gatelm.difficulty-independent-gpt-review-normalization.v1",
        batchId,
        sampleId: row.sampleId,
        field: "reviewedExpectedInstructionPayloadBoundary.boundaryType",
        rawValue: "fenced_block",
        normalizedValue: "code_fence",
        reason: "The GPT packet used a non-contract alias; the active record schema and label guide require code_fence.",
      });
      normalizedRow.reviewedExpectedInstructionPayloadBoundary = {
        ...normalizedRow.reviewedExpectedInstructionPayloadBoundary,
        boundaryType: "code_fence",
      };
    }
    normalized.push(normalizedRow);
    allReviewRows.push(normalizedRow);

    const datasetVersion = `${before.datasetVersion}_independent_gpt_proposed_v1`;
    const after = {
      ...before,
      datasetVersion,
      redactedPrompt: normalizedRow.proposedPrompt,
      expectedCategory: normalizedRow.reviewedExpectedCategory,
      expectedDifficulty: normalizedRow.reviewedExpectedDifficulty,
      semanticInputStatus: normalizedRow.reviewedSemanticInputStatus,
      taskBucket: normalizedRow.reviewedTaskBucket,
      constraintBucket: normalizedRow.reviewedConstraintBucket,
      scopeBucket: normalizedRow.reviewedScopeBucket,
      dependencyBucket: normalizedRow.reviewedDependencyBucket,
      expectedSemanticLabel: normalizedRow.reviewedExpectedSemanticLabel,
      expectedInstructionPayloadBoundary: normalizedRow.reviewedExpectedInstructionPayloadBoundary,
      evaluationSlices: normalizedRow.reviewedEvaluationSlices,
    };
    proposedRecords.push(after);
    allProposedRecords.push(after);

    const promptChanged = before.redactedPrompt !== after.redactedPrompt;
    const labelChangedFields = Object.entries(reviewedFieldMap)
      .filter(([candidateField]) => stable(before[candidateField]) !== stable(after[candidateField]))
      .map(([candidateField]) => candidateField);
    const changedFields = [...(promptChanged ? ["redactedPrompt"] : []), ...labelChangedFields];
    const decisionPromptConsistent = normalizedRow.decision === "accept" ? !promptChanged : normalizedRow.decision === "revise_prompt" ? promptChanged : true;
    const diff = {
      schemaVersion: "gatelm.difficulty-independent-gpt-review-diff.v1",
      batchId,
      sampleId: before.sampleId,
      promptFamily: before.promptFamily,
      decision: normalizedRow.decision,
      confidence: normalizedRow.confidence,
      issueCodes: normalizedRow.issueCodes,
      promptChanged,
      decisionPromptConsistent,
      labelChangedFields,
      changedFields,
      before: {
        redactedPrompt: before.redactedPrompt,
        ...Object.fromEntries(Object.keys(reviewedFieldMap).map((field) => [field, before[field]])),
      },
      proposed: {
        redactedPrompt: after.redactedPrompt,
        ...Object.fromEntries(Object.keys(reviewedFieldMap).map((field) => [field, after[field]])),
      },
      rationale: normalizedRow.rationale,
      requiresOwnerAdjudication: labelChangedFields.length > 0 || normalizedRow.confidence !== "high" || !decisionPromptConsistent || ["reject", "needs_human_adjudication"].includes(normalizedRow.decision),
    };
    batchDiffs.push(diff);
    allDiffs.push(diff);
  }

  const proposedFailures = verifyDifficultyLabelRecords(proposedRecords);
  const proposedText = jsonl(proposedRecords);
  const originalManifest = parseJson(path.resolve(indexEntry.manifestPath));
  const auditManifest = {
    schemaVersion: originalManifest.schemaVersion,
    datasetVersion: proposedRecords[0]?.datasetVersion,
    recordSchemaVersion: originalManifest.recordSchemaVersion,
    datasetSha256: sha256(proposedText),
    trainingEligible: false,
    families: originalManifest.families.map((family) => ({
      promptFamily: family.promptFamily,
      partition: family.partition,
      records: family.records,
    })),
  };

  writeOrCheck(path.join(normalizedRoot, `${batchId}.gpt-review.normalized.jsonl`), jsonl(normalized));
  writeOrCheck(path.join(proposedRoot, `${batchId}.independent-gpt-proposed.candidate.jsonl`), proposedText);
  writeOrCheck(path.join(proposedRoot, `${batchId}.independent-gpt-proposed.go-audit-manifest.json`), `${JSON.stringify(auditManifest, null, 2)}\n`);
  writeOrCheck(path.join(diffRoot, `${batchId}.review-diff.jsonl`), jsonl(batchDiffs));

  batchSummaries.push({
    batchId,
    records: reviewRows.length,
    families: new Set(reviewRows.map((row) => row.promptFamily)).size,
    decisions: counter(reviewRows, (row) => row.decision),
    confidence: counter(reviewRows, (row) => row.confidence),
    promptChanges: batchDiffs.filter((diff) => diff.promptChanged).length,
    labelConflictRecords: batchDiffs.filter((diff) => diff.labelChangedFields.length > 0).length,
    ownerAdjudicationRecords: batchDiffs.filter((diff) => diff.requiresOwnerAdjudication).length,
    decisionPromptInconsistencies: batchDiffs.filter((diff) => !diff.decisionPromptConsistent).length,
    proposedSchemaFailures: proposedFailures.length,
    proposedSchemaFailureDetails: proposedFailures.slice(0, 100),
    proposedDatasetSha256: auditManifest.datasetSha256,
  });
}

const sampleIds = allReviewRows.map((row) => row.sampleId);
if (new Set(sampleIds).size !== sampleIds.length) importFailures.push("combined outputs repeat sampleId values");
if (sampleIds.length !== 3120) importFailures.push(`combined output count ${sampleIds.length}`);

const ownerQueue = allDiffs.filter((diff) => diff.requiresOwnerAdjudication);
const promptRevisionQueue = allDiffs.filter((diff) => diff.promptChanged && !diff.requiresOwnerAdjudication);
const labelFieldChanges = counter(allDiffs.flatMap((diff) => diff.labelChangedFields), (field) => field);
const issueCodes = counter(allReviewRows, (row) => row.issueCodes);
const comparisonSummary = {
  schemaVersion: "gatelm.difficulty-independent-gpt-review-comparison.v1",
  status: importFailures.length === 0 ? "validated_pending_owner_adjudication" : "invalid_import",
  importedAt,
  records: allReviewRows.length,
  families: new Set(allReviewRows.map((row) => row.promptFamily)).size,
  batches: batchSummaries,
  totals: {
    decisions: counter(allReviewRows, (row) => row.decision),
    confidence: counter(allReviewRows, (row) => row.confidence),
    promptChanges: allDiffs.filter((diff) => diff.promptChanged).length,
    representationalBoundaryNormalizations: normalizationAudit.length,
    labelConflictRecords: allDiffs.filter((diff) => diff.labelChangedFields.length > 0).length,
    labelFieldChanges,
    ownerAdjudicationRecords: ownerQueue.length,
    promptRevisionBatchApprovalRecords: promptRevisionQueue.length,
    decisionPromptInconsistencies: allDiffs.filter((diff) => !diff.decisionPromptConsistent).length,
    proposedSchemaFailures: batchSummaries.reduce((sum, batch) => sum + batch.proposedSchemaFailures, 0),
    securityPatternHits: importFailures.filter((failure) => failure.includes("forbidden data pattern")).length,
    issueCodes,
  },
  providedValidationSummary: providedSummary,
  importFailures,
  ownerApprovalStatus: "pending",
  trainingEligible: false,
};

const report = [
  "# Independent GPT review comparison",
  "",
  `- Status: ${comparisonSummary.status}`,
  `- Records/families: ${comparisonSummary.records}/${comparisonSummary.families}`,
  `- Decisions: ${Object.entries(comparisonSummary.totals.decisions).map(([key, value]) => `${key} ${value}`).join(", ")}`,
  `- Prompt changes: ${comparisonSummary.totals.promptChanges}`,
  `- Tracked packet-alias normalizations (fenced_block -> code_fence): ${comparisonSummary.totals.representationalBoundaryNormalizations}`,
  `- Records with one or more candidate-label conflicts: ${comparisonSummary.totals.labelConflictRecords}`,
  `- Owner adjudication queue: ${comparisonSummary.totals.ownerAdjudicationRecords}`,
  `- Prompt-only high-confidence batch-approval queue: ${comparisonSummary.totals.promptRevisionBatchApprovalRecords}`,
  `- Proposed schema failures: ${comparisonSummary.totals.proposedSchemaFailures}`,
  `- Security pattern hits: ${comparisonSummary.totals.securityPatternHits}`,
  "- Candidate and owner-approval files remain unchanged and pending.",
  "",
  "## Batch summary",
  "",
  "| batch | rows | accept | revise prompt | prompt changes | label conflicts | owner queue | schema failures |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
  ...batchSummaries.map((batch) => `| ${batch.batchId.toUpperCase()} | ${batch.records} | ${batch.decisions.accept ?? 0} | ${batch.decisions.revise_prompt ?? 0} | ${batch.promptChanges} | ${batch.labelConflictRecords} | ${batch.ownerAdjudicationRecords} | ${batch.proposedSchemaFailures} |`),
  "",
  "## Files",
  "",
  "- `raw/`: exact GPT outputs and the GPT-provided validation summary",
  "- `normalized/`: normalized review rows",
  "- `normalization-audit.jsonl`: lossless audit of packet aliases converted to active contract values",
  "- `diff/`: record-level candidate versus independent-review diff",
  "- `proposed/`: unapproved analysis candidates and minimal Go-audit manifests",
  "- `owner-adjudication-queue.jsonl`: records requiring explicit owner judgment",
  "- `prompt-revision-batch-approval-queue.jsonl`: high-confidence prompt-only revisions eligible for one batch decision after Go/duplicate gates",
  "",
].join("\n");

writeOrCheck(path.join(importRoot, "combined.gpt-review.normalized.jsonl"), jsonl(allReviewRows));
writeOrCheck(path.join(importRoot, "normalization-audit.jsonl"), normalizationAudit.length > 0 ? jsonl(normalizationAudit) : "");
writeOrCheck(path.join(importRoot, "combined.review-diff.jsonl"), jsonl(allDiffs));
writeOrCheck(path.join(importRoot, "owner-adjudication-queue.jsonl"), ownerQueue.length > 0 ? jsonl(ownerQueue) : "");
writeOrCheck(path.join(importRoot, "prompt-revision-batch-approval-queue.jsonl"), promptRevisionQueue.length > 0 ? jsonl(promptRevisionQueue) : "");
writeOrCheck(path.join(importRoot, "comparison-summary.json"), `${JSON.stringify(comparisonSummary, null, 2)}\n`);
writeOrCheck(path.join(importRoot, "COMPARISON-REPORT.md"), report);
writeOrCheck(path.join(importRoot, "import-manifest.json"), `${JSON.stringify({
  schemaVersion: "gatelm.difficulty-independent-gpt-review-import-manifest.v1",
  sourceDirectory: "raw_snapshot",
  rawFiles,
  records: allReviewRows.length,
  families: comparisonSummary.families,
  status: comparisonSummary.status,
  ownerApprovalStatus: "pending",
  trainingEligible: false,
}, null, 2)}\n`);

console.log(JSON.stringify(comparisonSummary.totals));
if (importFailures.length > 0) throw new Error(`independent GPT import failed:\n${importFailures.slice(0, 50).join("\n")}`);
