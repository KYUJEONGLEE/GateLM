import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

const reviewRoot = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const packetRoot = path.join(reviewRoot, "owner-gpt-adjudication-packets");
const importRoot = path.join(reviewRoot, "owner-gpt-adjudication-review");
const rawRoot = path.join(importRoot, "raw");
const normalizedRoot = path.join(importRoot, "normalized");
const proposedRoot = path.join(importRoot, "proposed");
const diffRoot = path.join(importRoot, "diff");
const batchIds = ["t1", "t2", "t3", "t4", "c1", "c2", "e1", "e2", "p1"];
const checkOnly = process.argv.includes("--check");
const sourceArgument = process.argv.find((argument) => argument.startsWith("--source-dir="));
const archiveArgument = process.argv.find((argument) => argument.startsWith("--source-zip="));
const sourceRoot = sourceArgument ? path.resolve(sourceArgument.slice("--source-dir=".length)) : rawRoot;
const sourceArchivePath = archiveArgument ? path.resolve(archiveArgument.slice("--source-zip=".length)) : path.join(rawRoot, "OWNER-GPT-ADJUDICATION-RESULTS.zip");
const importedAt = "2026-07-16T00:00:00Z";

const finalFieldMap = {
  expectedCategory: "finalExpectedCategory",
  expectedDifficulty: "finalExpectedDifficulty",
  semanticInputStatus: "finalSemanticInputStatus",
  taskBucket: "finalTaskBucket",
  constraintBucket: "finalConstraintBucket",
  scopeBucket: "finalScopeBucket",
  dependencyBucket: "finalDependencyBucket",
  expectedSemanticLabel: "finalExpectedSemanticLabel",
  expectedInstructionPayloadBoundary: "finalExpectedInstructionPayloadBoundary",
  evaluationSlices: "finalEvaluationSlices",
};
const independentFieldMap = {
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
const outputKeys = [
  "schemaVersion",
  "batchId",
  "sampleId",
  "promptFamily",
  "recommendation",
  "finalPrompt",
  ...Object.values(finalFieldMap),
  "resolvedDifferences",
  "rationale",
  "confidence",
  "requiresLocalGoRecheck",
  "requiresHumanOwnerConfirmation",
].sort();
const allowedRecommendations = new Set([
  "keep_candidate",
  "accept_independent_prompt",
  "accept_independent_labels",
  "accept_independent_prompt_and_labels",
  "custom_override",
  "exclude",
  "needs_human_owner",
]);
const allowedConfidence = new Set(["high", "medium", "low"]);
const forbiddenPatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/iu,
  /\bAuthorization\s*:/iu,
  /\bapi[_ -]?key\s*[:=]/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /-----begin [a-z ]*private key-----/iu,
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readText = (filePath) => readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
const parseJson = (filePath) => JSON.parse(readText(filePath));
const parseJsonl = (filePath) => readText(filePath).split(/\r?\n/u).filter(Boolean).map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`${filePath}:${index + 1}: ${error.message}`);
  }
});
const jsonl = (records) => (records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "");

function stable(value) {
  const canonical = (item) => {
    if (Array.isArray(item)) return [...item].map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
    return item;
  };
  return JSON.stringify(canonical(value));
}

function normalizePrompt(value) {
  return value.replace(/\r\n/gu, "\n");
}

function counts(values, selector) {
  const result = {};
  for (const value of values) {
    const key = selector(value);
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function writeOrCheck(filePath, contents) {
  if (checkOnly) {
    if (readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "") !== contents) throw new Error(`${filePath}: stale owner GPT import artifact`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function writeImmutableRaw(filePath, contents) {
  if (existsSync(filePath)) {
    const actual = readFileSync(filePath);
    const expected = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
    if (!actual.equals(expected)) throw new Error(`${filePath}: immutable owner GPT raw snapshot mismatch`);
    return;
  }
  if (checkOnly) throw new Error(`${filePath}: missing immutable owner GPT raw snapshot`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function labelsFrom(record, mapping) {
  return Object.fromEntries(Object.entries(mapping).map(([field, sourceField]) => [field, record[sourceField]]));
}

function labelsMatch(left, right) {
  return Object.keys(finalFieldMap).every((field) => stable(left[field]) === stable(right[field]));
}

function validateOutputRow(output, input, batchId, index, failures) {
  const prefix = `${batchId}:${index + 1}:${output?.sampleId ?? "missing_sample"}`;
  const actualKeys = Object.keys(output ?? {}).sort();
  if (stable(actualKeys) !== stable(outputKeys)) failures.push(`${prefix}: output keys`);
  if (output?.schemaVersion !== "gatelm.difficulty-owner-gpt-adjudication-recommendation.v1") failures.push(`${prefix}: schemaVersion`);
  if (output?.batchId !== batchId) failures.push(`${prefix}: batchId`);
  if (output?.sampleId !== input.sampleId) failures.push(`${prefix}: sampleId/order`);
  if (output?.promptFamily !== input.promptFamily) failures.push(`${prefix}: promptFamily`);
  if (!allowedRecommendations.has(output?.recommendation)) failures.push(`${prefix}: recommendation`);
  if (!allowedConfidence.has(output?.confidence)) failures.push(`${prefix}: confidence`);
  if (typeof output?.finalPrompt !== "string" || output.finalPrompt.trim().length === 0) failures.push(`${prefix}: finalPrompt`);
  if (!Array.isArray(output?.finalEvaluationSlices)) failures.push(`${prefix}: finalEvaluationSlices`);
  if (!Array.isArray(output?.resolvedDifferences)) failures.push(`${prefix}: resolvedDifferences`);
  if (typeof output?.rationale !== "string" || output.rationale.trim().length === 0) failures.push(`${prefix}: rationale`);
  if (output?.requiresHumanOwnerConfirmation !== true) failures.push(`${prefix}: requiresHumanOwnerConfirmation`);
  if (forbiddenPatterns.some((pattern) => pattern.test(output?.finalPrompt ?? ""))) failures.push(`${prefix}: forbidden prompt pattern`);
}

const packetManifest = parseJson(path.join(packetRoot, "OWNER-GPT-INPUT-MANIFEST.json"));
const generationIndex = parseJson(path.join(reviewRoot, "generation-index.json"));
const providedSummaryPath = path.join(sourceRoot, "OWNER-GPT-VALIDATION-SUMMARY.json");
if (!existsSync(providedSummaryPath)) throw new Error(`missing owner GPT validation summary: ${providedSummaryPath}`);
const providedSummaryText = readText(providedSummaryPath);
const providedSummarySnapshot = providedSummaryText.endsWith("\n") ? providedSummaryText : `${providedSummaryText}\n`;
const providedSummary = JSON.parse(providedSummaryText);
const archiveBytes = readFileSync(sourceArchivePath);
const archiveHash = sha256(archiveBytes);
const failures = [];
const allOutputs = [];
const allDiffs = [];
const allProposedRecords = [];
const batchSummaries = [];
const rawFiles = [];

writeImmutableRaw(path.join(rawRoot, "OWNER-GPT-ADJUDICATION-RESULTS.zip"), archiveBytes);
writeImmutableRaw(path.join(rawRoot, "OWNER-GPT-VALIDATION-SUMMARY.json"), providedSummarySnapshot);
rawFiles.push({ file: "OWNER-GPT-ADJUDICATION-RESULTS.zip", sha256: archiveHash });
rawFiles.push({ file: "OWNER-GPT-VALIDATION-SUMMARY.json", sha256: sha256(Buffer.from(providedSummarySnapshot, "utf8")) });

for (const packetFile of ["OWNER-GPT-ADJUDICATION-INSTRUCTIONS.md", "LABEL-GUIDE.md", "OWNER-GPT-INPUT-MANIFEST.json", "CHATGPT-COMMAND.md"]) {
  const packetText = readText(path.join(packetRoot, packetFile));
  const packetSnapshot = packetText.endsWith("\n") ? packetText : `${packetText}\n`;
  writeImmutableRaw(path.join(rawRoot, packetFile), packetSnapshot);
  rawFiles.push({ file: packetFile, sha256: sha256(Buffer.from(packetSnapshot, "utf8")) });
}

for (const batchId of batchIds) {
  const generationEntry = generationIndex.batches.find((batch) => batch.batchId === batchId);
  if (!generationEntry) throw new Error(`missing generation index batch: ${batchId}`);
  const inputPath = path.join(packetRoot, `${batchId}.owner-gpt-adjudication.input.jsonl`);
  const outputSourcePath = path.join(sourceRoot, `${batchId}.owner-gpt-adjudication.output.jsonl`);
  if (!existsSync(outputSourcePath)) throw new Error(`missing owner GPT output: ${outputSourcePath}`);
  const inputBytes = readFileSync(inputPath);
  const outputBytes = readFileSync(outputSourcePath);
  const inputRows = parseJsonl(inputPath);
  const outputRows = parseJsonl(outputSourcePath);
  const originalRecords = parseJsonl(path.resolve(generationEntry.datasetPath));
  const outputSnapshot = outputBytes.toString("utf8").replace(/^\uFEFF/u, "").replace(/\r?\n?$/u, "\n");
  writeImmutableRaw(path.join(rawRoot, `${batchId}.owner-gpt-adjudication.output.jsonl`), outputSnapshot);
  rawFiles.push({ file: `${batchId}.owner-gpt-adjudication.output.jsonl`, sha256: sha256(Buffer.from(outputSnapshot, "utf8")) });

  const packetBatch = packetManifest.batches.find((batch) => batch.batchId === batchId);
  const providedBatch = providedSummary.batches.find((batch) => batch.batchId === batchId);
  if (!packetBatch || !providedBatch) failures.push(`${batchId}: missing packet/provided batch metadata`);
  if (packetBatch?.inputSha256 !== sha256(inputBytes)) failures.push(`${batchId}: packet input hash mismatch`);
  if (providedBatch?.inputSha256 !== sha256(inputBytes)) failures.push(`${batchId}: provided input hash mismatch`);
  if (providedBatch?.outputSha256 !== sha256(outputBytes)) failures.push(`${batchId}: provided output hash mismatch`);
  if (inputRows.length !== outputRows.length || outputRows.length !== packetBatch?.records) failures.push(`${batchId}: row count mismatch`);

  const normalizedRows = [];
  const batchDiffs = [];
  const proposedRecords = [];
  const seen = new Set();
  for (let index = 0; index < outputRows.length; index += 1) {
    const output = outputRows[index];
    const input = inputRows[index];
    validateOutputRow(output, input, batchId, index, failures);
    if (seen.has(output.sampleId)) failures.push(`${batchId}:${output.sampleId}: duplicate output sampleId`);
    seen.add(output.sampleId);
    const normalized = {
      ...output,
      finalPrompt: normalizePrompt(output.finalPrompt),
      finalEvaluationSlices: [...new Set(output.finalEvaluationSlices)],
      resolvedDifferences: [...new Set(output.resolvedDifferences)],
    };
    const candidateLabels = Object.fromEntries(Object.keys(finalFieldMap).map((field) => [field, input.candidate[field]]));
    const independentLabels = labelsFrom(input.independentGptReview, independentFieldMap);
    const finalLabels = labelsFrom(normalized, finalFieldMap);
    const candidatePrompt = normalizePrompt(input.candidate.redactedPrompt);
    const independentPrompt = normalizePrompt(input.independentGptReview.proposedPrompt);
    const promptSource = normalized.finalPrompt === candidatePrompt ? "candidate" : normalized.finalPrompt === independentPrompt ? "independent" : "custom";
    const candidateLabelsMatch = labelsMatch(finalLabels, candidateLabels);
    const independentLabelsMatch = labelsMatch(finalLabels, independentLabels);
    const expectedLocalRecheck = promptSource === "custom";
    if (normalized.requiresLocalGoRecheck !== expectedLocalRecheck) failures.push(`${batchId}:${normalized.sampleId}: local Go recheck flag mismatch`);
    if (normalized.recommendation === "keep_candidate" && (promptSource !== "candidate" || !candidateLabelsMatch)) failures.push(`${batchId}:${normalized.sampleId}: keep_candidate inconsistency`);
    if (normalized.recommendation === "accept_independent_prompt" && (promptSource !== "independent" || !candidateLabelsMatch)) failures.push(`${batchId}:${normalized.sampleId}: accept_independent_prompt inconsistency`);
    if (normalized.recommendation === "accept_independent_labels" && (promptSource !== "candidate" || !independentLabelsMatch)) failures.push(`${batchId}:${normalized.sampleId}: accept_independent_labels inconsistency`);
    if (normalized.recommendation === "accept_independent_prompt_and_labels" && (promptSource !== "independent" || !independentLabelsMatch)) failures.push(`${batchId}:${normalized.sampleId}: accept_independent_prompt_and_labels inconsistency`);

    const originalRecord = originalRecords[index];
    if (originalRecord.sampleId !== input.sampleId) failures.push(`${batchId}:${index + 1}: source candidate order drift`);
    const proposedRecord = {
      ...originalRecord,
      datasetVersion: `${originalRecord.datasetVersion}_owner_gpt_recommended_v1`,
      redactedPrompt: normalized.finalPrompt,
      expectedCategory: normalized.finalExpectedCategory,
      expectedDifficulty: normalized.finalExpectedDifficulty,
      semanticInputStatus: normalized.finalSemanticInputStatus,
      taskBucket: normalized.finalTaskBucket,
      constraintBucket: normalized.finalConstraintBucket,
      scopeBucket: normalized.finalScopeBucket,
      dependencyBucket: normalized.finalDependencyBucket,
      expectedSemanticLabel: normalized.finalExpectedSemanticLabel,
      expectedInstructionPayloadBoundary: normalized.finalExpectedInstructionPayloadBoundary,
      evaluationSlices: normalized.finalEvaluationSlices,
      reviewStatus: "pending",
      reviewerCount: 0,
      reviewerNote: "Owner-stage GPT recommendation imported; human owner confirmation pending.",
    };
    proposedRecords.push(proposedRecord);
    allProposedRecords.push(proposedRecord);
    normalizedRows.push(normalized);
    allOutputs.push(normalized);
    const candidateChangedFields = [
      ...(candidatePrompt !== normalized.finalPrompt ? ["redactedPrompt"] : []),
      ...Object.keys(finalFieldMap).filter((field) => stable(candidateLabels[field]) !== stable(finalLabels[field])),
    ];
    const independentChangedFields = [
      ...(independentPrompt !== normalized.finalPrompt ? ["redactedPrompt"] : []),
      ...Object.keys(finalFieldMap).filter((field) => stable(independentLabels[field]) !== stable(finalLabels[field])),
    ];
    const diff = {
      schemaVersion: "gatelm.difficulty-owner-gpt-adjudication-diff.v1",
      batchId,
      sampleId: normalized.sampleId,
      promptFamily: normalized.promptFamily,
      recommendation: normalized.recommendation,
      confidence: normalized.confidence,
      promptSource,
      candidateChangedFields,
      independentChangedFields,
      requiresLocalGoRecheck: normalized.requiresLocalGoRecheck,
      resolvedDifferences: normalized.resolvedDifferences,
      candidate: { redactedPrompt: candidatePrompt, ...candidateLabels },
      independent: { redactedPrompt: independentPrompt, ...independentLabels },
      recommended: { redactedPrompt: normalized.finalPrompt, ...finalLabels },
      rationale: normalized.rationale,
      requiresHumanOwnerConfirmation: true,
    };
    batchDiffs.push(diff);
    allDiffs.push(diff);
  }

  const schemaFailures = verifyDifficultyLabelRecords(proposedRecords);
  failures.push(...schemaFailures.map((failure) => `${batchId}: ${failure}`));
  const proposedText = jsonl(proposedRecords);
  const originalManifest = parseJson(path.resolve(generationEntry.manifestPath));
  const goManifest = {
    schemaVersion: originalManifest.schemaVersion,
    datasetVersion: proposedRecords[0]?.datasetVersion,
    recordSchemaVersion: originalManifest.recordSchemaVersion,
    datasetSha256: sha256(Buffer.from(proposedText, "utf8")),
    trainingEligible: false,
    families: originalManifest.families.map((family) => ({ promptFamily: family.promptFamily, partition: family.partition, records: family.records })),
  };
  writeOrCheck(path.join(normalizedRoot, `${batchId}.owner-gpt-adjudication.normalized.jsonl`), jsonl(normalizedRows));
  writeOrCheck(path.join(diffRoot, `${batchId}.owner-gpt-adjudication.diff.jsonl`), jsonl(batchDiffs));
  writeOrCheck(path.join(proposedRoot, `${batchId}.owner-gpt-recommended.candidate.jsonl`), proposedText);
  writeOrCheck(path.join(proposedRoot, `${batchId}.owner-gpt-recommended.go-audit-manifest.json`), `${JSON.stringify(goManifest, null, 2)}\n`);
  batchSummaries.push({
    batchId,
    records: outputRows.length,
    families: new Set(outputRows.map((row) => row.promptFamily)).size,
    recommendations: counts(outputRows, (row) => row.recommendation),
    confidence: counts(outputRows, (row) => row.confidence),
    promptSources: counts(batchDiffs, (diff) => diff.promptSource),
    localGoRechecks: batchDiffs.filter((diff) => diff.requiresLocalGoRecheck).length,
    candidateChangedRecords: batchDiffs.filter((diff) => diff.candidateChangedFields.length > 0).length,
    schemaFailures: schemaFailures.length,
    proposedDatasetSha256: goManifest.datasetSha256,
  });
}

if (new Set(allOutputs.map((row) => row.sampleId)).size !== allOutputs.length) failures.push("combined owner GPT outputs repeat sampleId values");
if (allOutputs.length !== 3120) failures.push(`combined owner GPT output count ${allOutputs.length}`);
if (new Set(allOutputs.map((row) => row.promptFamily)).size !== 624) failures.push("combined owner GPT family count mismatch");
if (providedSummary.totals?.outputRows !== allOutputs.length) failures.push("provided summary total output count mismatch");
if (stable(providedSummary.totals?.recommendationCounts) !== stable(counts(allOutputs, (row) => row.recommendation))) failures.push("provided recommendation counts mismatch");
if (providedSummary.validationPassed !== true) failures.push("provided validation summary did not pass");

const changedDifficulty = allDiffs.filter((diff) => diff.candidateChangedFields.includes("expectedDifficulty"));
const customPrompts = allDiffs.filter((diff) => diff.promptSource === "custom");
const mediumConfidence = allDiffs.filter((diff) => diff.confidence !== "high");
const summary = {
  schemaVersion: "gatelm.difficulty-owner-gpt-adjudication-import-summary.v1",
  status: failures.length === 0 ? "validated_pending_local_gates_and_human_owner_confirmation" : "invalid_import",
  importedAt,
  sourceArchiveSha256: archiveHash,
  records: allOutputs.length,
  families: new Set(allOutputs.map((row) => row.promptFamily)).size,
  batches: batchSummaries,
  totals: {
    recommendations: counts(allOutputs, (row) => row.recommendation),
    confidence: counts(allOutputs, (row) => row.confidence),
    promptSources: counts(allDiffs, (diff) => diff.promptSource),
    localGoRechecks: customPrompts.length,
    candidateChangedRecords: allDiffs.filter((diff) => diff.candidateChangedFields.length > 0).length,
    difficultyChangedRecords: changedDifficulty.length,
    mediumConfidenceRecords: mediumConfidence.length,
    schemaFailures: batchSummaries.reduce((sum, batch) => sum + batch.schemaFailures, 0),
    forbiddenPromptPatternHits: failures.filter((failure) => failure.includes("forbidden prompt pattern")).length,
  },
  importFailures: failures,
  ownerApprovalStatus: "pending",
  trainingEligible: false,
};
const report = [
  "# Owner-stage GPT adjudication import",
  "",
  `- Status: ${summary.status}`,
  `- Records/families: ${summary.records}/${summary.families}`,
  `- Recommendations: ${Object.entries(summary.totals.recommendations).map(([key, value]) => `${key} ${value}`).join(", ")}`,
  `- Final prompt sources: ${Object.entries(summary.totals.promptSources).map(([key, value]) => `${key} ${value}`).join(", ")}`,
  `- New custom prompts requiring actual Go recheck: ${summary.totals.localGoRechecks}`,
  `- Difficulty changes from the current candidate: ${summary.totals.difficultyChangedRecords}`,
  `- Medium/low confidence records: ${summary.totals.mediumConfidenceRecords}`,
  `- Schema failures: ${summary.totals.schemaFailures}`,
  "- No candidate, owner-approved dataset, or training-eligibility state was changed.",
  "",
].join("\n");

writeOrCheck(path.join(importRoot, "combined.owner-gpt-adjudication.normalized.jsonl"), jsonl(allOutputs));
writeOrCheck(path.join(importRoot, "combined.owner-gpt-adjudication.diff.jsonl"), jsonl(allDiffs));
writeOrCheck(path.join(importRoot, "custom-prompt-local-go-recheck-queue.jsonl"), jsonl(customPrompts));
writeOrCheck(path.join(importRoot, "difficulty-change-confirmation-queue.jsonl"), jsonl(changedDifficulty));
writeOrCheck(path.join(importRoot, "medium-confidence-confirmation-queue.jsonl"), jsonl(mediumConfidence));
writeOrCheck(path.join(importRoot, "import-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeOrCheck(path.join(importRoot, "IMPORT-REPORT.md"), report);
writeOrCheck(path.join(importRoot, "import-manifest.json"), `${JSON.stringify({
  schemaVersion: "gatelm.difficulty-owner-gpt-adjudication-import-manifest.v1",
  sourceDirectory: "raw_snapshot",
  sourceArchiveSha256: archiveHash,
  rawFiles,
  records: summary.records,
  families: summary.families,
  status: summary.status,
  ownerApprovalStatus: "pending",
  trainingEligible: false,
}, null, 2)}\n`);

console.log(JSON.stringify(summary.totals));
if (failures.length > 0) throw new Error(`owner GPT adjudication import failed:\n${failures.slice(0, 100).join("\n")}`);
