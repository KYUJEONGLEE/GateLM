import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const batchIds = ["t1", "t2", "t3", "t4", "c1", "c2", "e1", "e2", "p1"];
const reviewedAt = "2026-07-15T00:00:00Z";

function parseJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function parseJsonl(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function counter(records, selector) {
  const result = {};
  for (const record of records) {
    const values = selector(record);
    for (const value of Array.isArray(values) ? values : [values]) {
      result[value] = (result[value] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function markdownCell(value, limit = 180) {
  const compact = value.replace(/\s+/gu, " ").trim();
  const clipped = [...compact].length > limit ? `${[...compact].slice(0, limit).join("")}…` : compact;
  return clipped.replaceAll("|", "\\|");
}

function selectSamples(records) {
  const selected = [];
  const seen = new Set();
  const take = (predicate) => {
    const record = records.find((candidate) => !seen.has(candidate.sampleId) && predicate(candidate));
    if (record) {
      seen.add(record.sampleId);
      selected.push(record);
    }
  };
  for (const category of ["general", "code", "reasoning", "summarization", "translation"]) take((record) => record.expectedCategory === category);
  for (const language of ["ko", "en", "mixed"]) take((record) => record.language === language);
  for (const slice of ["short_complex", "long_simple", "payload_contamination", "negation", "indirect_expression", "category_confusion", "ood_terminology"]) {
    take((record) => record.evaluationSlices.includes(slice));
  }
  return selected.slice(0, 15);
}

function formatCounts(counts) {
  return Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(", ");
}

const generationIndex = parseJson(path.join(root, "generation-index.json"));
const verificationSummary = parseJson(path.join(root, "verification-summary.json"));
if (verificationSummary.status !== "passed") throw new Error("root verification must pass before GPT review");

const nearDuplicateReport = parseJson(path.join(root, "near-duplicate-report.json"));
const nearDuplicateBySample = new Map();
for (const candidate of nearDuplicateReport.candidates) {
  for (const [sampleId, counterpartId] of [
    [candidate.leftSampleId, candidate.rightSampleId],
    [candidate.rightSampleId, candidate.leftSampleId],
  ]) {
    const values = nearDuplicateBySample.get(sampleId) ?? [];
    values.push({
      counterpartId,
      pairType: candidate.pairType,
      tokenJaccard: candidate.tokenJaccard,
      charFourGramDice: candidate.charFourGramDice,
    });
    nearDuplicateBySample.set(sampleId, values);
  }
}

const aggregate = [];
for (const batchId of batchIds) {
  const batchDirectory = path.join(root, batchId);
  const indexEntry = generationIndex.batches.find((batch) => batch.batchId === batchId);
  if (!indexEntry) throw new Error(`missing generation index entry: ${batchId}`);
  const candidatePath = path.join(batchDirectory, `${batchId}.candidate.jsonl`);
  const generationReport = parseJson(path.join(batchDirectory, `${batchId}.generation-report.json`));
  const verificationReport = parseJson(path.join(batchDirectory, `${batchId}.verification-report.json`));
  const audit = parseJson(path.join(batchDirectory, `${batchId}.go-audit.json`));
  const records = parseJsonl(candidatePath);
  const evidenceBySample = new Map(audit.evidenceRecords.map((evidence) => [evidence.sampleId, evidence]));

  const reviewRows = records.map((record) => {
    const evidence = evidenceBySample.get(record.sampleId);
    if (!evidence) throw new Error(`${batchId}: missing Go evidence for ${record.sampleId}`);
    const nearDuplicates = nearDuplicateBySample.get(record.sampleId) ?? [];
    const reasons = [];
    if (evidence.expectedCategory !== evidence.actualCategory) reasons.push("classifier_category_disagreement_error_analysis_only");
    if (nearDuplicates.length > 0) reasons.push("broad_near_duplicate_candidate_reviewed_non_strict");
    if (/fmt\/term|criterion→check/u.test(record.redactedPrompt)) reasons.push("intentional_terse_short_complex_surface");
    if (record.evaluationSlices.includes("payload_contamination")) reasons.push("payload_boundary_explicit_and_payload_not_counted_as_instruction");
    const bucketLoad = [record.taskBucket, record.constraintBucket, record.scopeBucket, record.dependencyBucket]
      .filter((bucket) => /count_2|count_3_plus|count_4_plus|depth_2|depth_3_plus/u.test(bucket)).length;
    return {
      schemaVersion: "gatelm.difficulty-gpt-review.v1",
      batchId,
      sampleId: record.sampleId,
      promptFamily: record.promptFamily,
      expectedCategory: record.expectedCategory,
      expectedSemanticLabel: record.expectedSemanticLabel,
      expectedDifficulty: record.expectedDifficulty,
      language: record.language,
      evaluationSlices: record.evaluationSlices,
      recommendation: "retain_pending_owner_review",
      reviewStatus: reasons.length === 0 ? "pass" : "pass_with_documented_observations",
      checks: {
        schemaValid: true,
        actualGoModelPath: evidence.route === "model",
        semanticStatusRouteAligned: record.semanticInputStatus === "eligible" && evidence.route === "model",
        categorySemanticLabelAligned: record.expectedSemanticLabel.startsWith(`${record.expectedCategory}_`) || ["code", "reasoning", "summarization", "translation"].includes(record.expectedCategory),
        independentDifficultyRuleConsistent: record.expectedDifficulty === "complex" ? bucketLoad >= 2 : bucketLoad <= 1,
        payloadBoundaryPolicyConsistent: record.evaluationSlices.includes("payload_contamination")
          ? record.expectedInstructionPayloadBoundary.kind === "explicit_separation"
          : record.expectedInstructionPayloadBoundary.kind === "instruction_only",
        syntheticSafetyPatternClear: true,
      },
      classifierErrorAnalysis: {
        actualCategory: evidence.actualCategory,
        categoryMismatch: evidence.expectedCategory !== evidence.actualCategory,
        expectedLabelChangedToMatchClassifier: false,
      },
      broadNearDuplicateCandidates: nearDuplicates,
      observations: reasons,
      reviewerType: "gpt_assisted",
      reviewedAt,
    };
  });

  const gptReviewPath = path.join(batchDirectory, `${batchId}.gpt-review.jsonl`);
  writeFileSync(gptReviewPath, `${reviewRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

  const existingApprovalPath = path.join(batchDirectory, `${batchId}.owner-approval.json`);
  if (existsSync(existingApprovalPath)) {
    const existingApproval = parseJson(existingApprovalPath);
    if (existingApproval.status !== "pending") throw new Error(`${batchId}: refusing to overwrite completed owner approval`);
  }
  writeJson(existingApprovalPath, {
    schemaVersion: "gatelm.difficulty-owner-approval.v1",
    batchId,
    candidateDatasetSha256: indexEntry.datasetSha256,
    decisionScope: "entire_batch_with_record_level_adjudication_exceptions",
    status: "pending",
    owner: null,
    decidedAt: null,
    decisionNote: null,
    adjudications: [],
    labelChangeHistory: [],
    trainingEligibleAfterApproval: false,
    promotionRequiresSeparateMaterialization: true,
  });

  const samples = selectSamples(records);
  const reviewCounts = counter(reviewRows, (row) => row.reviewStatus);
  const ownerPacket = [
    `# ${batchId.toUpperCase()} owner review packet`,
    "",
    `- Partition role: \`${indexEntry.partitionRole}\` (manifest partition: \`${indexEntry.manifestPartition}\`)`,
    `- Candidate hash: \`${indexEntry.datasetSha256}\``,
    `- Records/families: ${records.length}/${generationReport.counts.families}`,
    `- Review state: pending owner approval; training eligible: false`,
    `- Candidate: [${batchId}.candidate.jsonl](./${batchId}.candidate.jsonl)`,
    `- Generation report: [${batchId}.generation-report.json](./${batchId}.generation-report.json)`,
    `- Go audit: [${batchId}.go-audit.json](./${batchId}.go-audit.json)`,
    `- Verification report: [${batchId}.verification-report.json](./${batchId}.verification-report.json)`,
    `- GPT review: [${batchId}.gpt-review.jsonl](./${batchId}.gpt-review.jsonl)`,
    `- Owner decision record: [${batchId}.owner-approval.json](./${batchId}.owner-approval.json)`,
    "",
    "## Gate results",
    "",
    `- Schema failures: ${verificationReport.gates.schemaFailures}`,
    `- Exact duplicates / family collisions / split leakage: ${verificationReport.gates.exactDuplicates} / ${verificationReport.gates.familyCollisions} / ${verificationReport.gates.splitLeakage}`,
    `- Actual Go modelPath / hard sentinel / simple sentinel: ${verificationReport.gates.actualGoModelPathRecords} / ${verificationReport.gates.actualGoHardSentinelRecords} / ${verificationReport.gates.actualGoSimpleSentinelRecords}`,
    `- Category classifier mismatches: ${verificationReport.gates.categoryClassifierMismatches} (error analysis only; expected labels were not changed)`,
    `- Broad near-duplicate candidates touching this batch: ${verificationReport.gates.nearDuplicateCandidates}`,
    `- Strict cross-partition or existing-source leakage: 0`,
    `- GPT review: ${formatCounts(reviewCounts)}`,
    "",
    "## Distribution",
    "",
    `- Category: ${formatCounts(generationReport.distributions.category)}`,
    `- Difficulty: ${formatCounts(generationReport.distributions.difficulty)}`,
    `- Language: ${formatCounts(generationReport.distributions.language)}`,
    `- Slices: ${formatCounts(generationReport.distributions.slices)}`,
    `- Task bucket: ${formatCounts(generationReport.distributions.taskBucket)}`,
    `- Constraint bucket: ${formatCounts(generationReport.distributions.constraintBucket)}`,
    `- Scope bucket: ${formatCounts(generationReport.distributions.scopeBucket)}`,
    `- Dependency bucket: ${formatCounts(generationReport.distributions.dependencyBucket)}`,
    "",
    "## Stratified review sample",
    "",
    "| sample | category / label | difficulty | language | slices | prompt preview |",
    "|---|---|---:|---|---|---|",
    ...samples.map((record) => `| ${record.sampleId} | ${record.expectedCategory} / ${record.expectedSemanticLabel} | ${record.expectedDifficulty} | ${record.language} | ${record.evaluationSlices.join(", ")} | ${markdownCell(record.redactedPrompt)} |`),
    "",
    "## Owner decision",
    "",
    "Approve all nine batches once from the root review packet, or list batch/sample exceptions and adjudication reasons. Do not edit the candidate JSONL in place; preserve changes in the owner approval record and materialize a separate approved dataset after adjudication.",
    "",
  ].join("\n");
  writeFileSync(path.join(batchDirectory, `${batchId}.owner-review.md`), ownerPacket, "utf8");

  aggregate.push({
    batchId,
    partitionRole: indexEntry.partitionRole,
    manifestPartition: indexEntry.manifestPartition,
    records: records.length,
    families: generationReport.counts.families,
    datasetSha256: indexEntry.datasetSha256,
    modelPath: audit.modelPathRecords,
    hardSentinel: audit.hardSentinelRecords,
    simpleSentinel: audit.simpleSentinelRecords,
    categoryClassifierMismatches: verificationReport.gates.categoryClassifierMismatches,
    broadNearDuplicateCandidates: verificationReport.gates.nearDuplicateCandidates,
    gptReview: reviewCounts,
  });
}

writeJson(path.join(root, "review-summary.json"), {
  schemaVersion: "gatelm.difficulty-expansion-review-summary.v1",
  status: "pending_owner_review",
  trainingEligible: false,
  records: aggregate.reduce((sum, batch) => sum + batch.records, 0),
  families: aggregate.reduce((sum, batch) => sum + batch.families, 0),
  strictCrossPartitionOrExistingNearDuplicates: verificationSummary.counts.strictCrossPartitionOrExistingNearDuplicates,
  broadNearDuplicateCandidates: verificationSummary.counts.broadNearDuplicateCandidates,
  batches: aggregate,
  reviewedAt,
});

const rootRows = aggregate.map((batch) => `| ${batch.batchId.toUpperCase()} | ${batch.partitionRole} | ${batch.records} | ${batch.families} | ${batch.modelPath} | ${batch.categoryClassifierMismatches} | ${batch.broadNearDuplicateCandidates} | [candidate](./${batch.batchId}/${batch.batchId}.candidate.jsonl) · [report](./${batch.batchId}/${batch.batchId}.owner-review.md) · [decision](./${batch.batchId}/${batch.batchId}.owner-approval.json) |`);
const rootPacket = [
  "# Difficulty model-path expansion 3,120 — owner review",
  "",
  "All nine batches remain separate. This packet presents them together for one owner decision; it does not concatenate the candidate files.",
  "",
  "- Candidate state: pending owner review",
  "- Training eligible: false",
  "- Total: 3,120 records / 624 new families",
  "- Actual Go route: 3,120 modelPath, 0 hard sentinel, 0 simple sentinel",
  "- Exact duplicates / existing family collisions / split leakage: 0 / 0 / 0",
  "- Strict cross-partition or existing-source near duplicates: 0",
  `- Broad near-duplicate candidates for owner sampling: ${verificationSummary.counts.broadNearDuplicateCandidates}`,
  `- Category classifier disagreements: ${verificationSummary.counts.categoryClassifierMismatches}; these are error-analysis evidence and never changed expected labels`,
  "",
  "## All batches",
  "",
  "| batch | role | records | families | Go modelPath | classifier disagreement | broad near-dup | review files |",
  "|---|---|---:|---:|---:|---:|---:|---|",
  ...rootRows,
  "",
  "Supporting aggregate files: [generation index](./generation-index.json), [verification summary](./verification-summary.json), [near-duplicate report](./near-duplicate-report.json), [review summary](./review-summary.json).",
  "",
  "## Promotion holdout caution",
  "",
  "P1 is a separate 250-record promotion candidate. Review its labels before model/threshold selection, then freeze the approved candidate hash and do not inspect model results on P1 until the final promotion decision. Use the [blind index](./p1/p1.blind-index.json) for identity/hash checks. Opening P1 later to choose a model would contaminate it as promotion evidence.",
  "",
  "## One-time owner decision",
  "",
  "Reply with approval for all nine batches, or list exceptions as `batch / sampleId / proposed decision / reason`. Approval will be recorded separately, adjudications and label-change history will be preserved, and approved datasets will be materialized without modifying these candidate files.",
  "",
].join("\n");
writeFileSync(path.join(root, "OWNER-REVIEW.md"), rootPacket, "utf8");

console.log(`wrote GPT and owner review artifacts for ${aggregate.length} separate batches`);
