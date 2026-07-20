import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const datasetVersion = "difficulty_independent_ood_5000_2026_07_18_candidate_v1";
const importedAt = "2026-07-20T00:00:00Z";
const lowConfidenceThreshold = 0.9;
const kitRoot = "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit";
const resultRoot = `${kitRoot}/results/reviewer-a`;
const candidatePath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl";
const candidateManifestPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.manifest.json";
const packetManifestPath = `${kitRoot}/PACKET-MANIFEST.json`;
const storedArchivePath = `${resultRoot}/difficulty-independent-ood-5000.gpt-review.reviewer-a.batch-001-050.outputs.zip`;
const combinedPath = `${resultRoot}/difficulty-independent-ood-5000.gpt-review.reviewer-a.combined.validated.jsonl`;
const queuePath = `${resultRoot}/difficulty-independent-ood-5000.gpt-review.reviewer-a.record-adjudication-queue.jsonl`;
const familyQueuePath = `${resultRoot}/difficulty-independent-ood-5000.gpt-review.reviewer-a.family-context-queue.jsonl`;
const summaryPath = `${resultRoot}/difficulty-independent-ood-5000.gpt-review.reviewer-a.comparison-summary.json`;
const reportPath = `${resultRoot}/COMPARISON-REPORT.md`;
const importManifestPath = `${resultRoot}/IMPORT-MANIFEST.json`;
const priorityRoot = `${resultRoot}/priority`;
const priorityPaths = {
  priority_0_gpt_escalation: `${priorityRoot}/01-gpt-escalation.jsonl`,
  priority_1_core_label_conflict: `${priorityRoot}/02-core-label-conflicts.jsonl`,
  priority_2_low_confidence_or_quality: `${priorityRoot}/03-low-confidence-or-quality.jsonl`,
  priority_3_structure_conflict: `${priorityRoot}/04-structure-conflicts.jsonl`,
  priority_4_slice_only_conflict: `${priorityRoot}/05-slice-only-conflicts.jsonl`,
};
const coreFamilyQueuePath = `${priorityRoot}/02-core-label-family-context.jsonl`;

const labelFields = [
  "expectedCategory",
  "expectedDifficulty",
  "semanticInputStatus",
  "taskBucket",
  "constraintBucket",
  "scopeBucket",
  "dependencyBucket",
  "expectedSemanticLabel",
  "expectedInstructionPayloadBoundary",
  "evaluationSlices",
];
const resultFields = [
  "schemaVersion",
  "datasetVersion",
  "automatedReviewerPass",
  "batchId",
  "sampleId",
  "decision",
  ...labelFields,
  "confidence",
  "issueCodes",
  "rationale",
];
const enumValues = {
  decision: ["label_complete", "needs_human_adjudication", "reject_input"],
  expectedCategory: ["general", "code", "translation", "summarization", "reasoning"],
  expectedDifficulty: ["simple", "complex"],
  semanticInputStatus: ["eligible", "empty_instruction"],
  taskBucket: ["count_1", "count_2", "count_3_plus", "not_applicable"],
  constraintBucket: ["count_0_to_1", "count_2", "count_3_plus", "not_applicable"],
  scopeBucket: ["count_1", "count_2_to_3", "count_4_plus", "not_applicable"],
  dependencyBucket: ["depth_0_to_1", "depth_2", "depth_3_plus", "not_applicable"],
};
const semanticLabels = {
  general: ["general_qa", "general_explanation", "general_extraction", "general_support", "general_transformation", "general_other"],
  code: ["code_generation", "code_debugging", "code_refactoring", "code_review", "code_explanation", "code_design"],
  translation: ["translation_direct", "translation_localization", "translation_style_preserving"],
  summarization: ["summarization_direct", "summarization_key_points", "summarization_structured", "summarization_multi_source"],
  reasoning: ["reasoning_comparison", "reasoning_planning", "reasoning_decision", "reasoning_constraint_solving", "reasoning_causal"],
};
const slices = [
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
const issueCodes = [
  "ambiguous_instruction_payload_boundary",
  "category_ambiguity",
  "difficulty_ambiguity",
  "semantic_bucket_ambiguity",
  "unnatural_language",
  "malformed_prompt",
  "possible_duplicate",
  "insufficient_context",
];
const coreLabelFields = new Set(["expectedCategory", "expectedDifficulty", "semanticInputStatus", "expectedSemanticLabel"]);
const structureLabelFields = new Set([
  "taskBucket",
  "constraintBucket",
  "scopeBucket",
  "dependencyBucket",
  "expectedInstructionPayloadBoundary",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseJsonl(text, label) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "" && !["```", "```json", "```jsonl"].includes(line.trim()))
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}:${index + 1}: invalid JSON (${error.message})`);
      }
    });
}

function canonicalJsonl(records) {
  return records.length === 0 ? "" : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(rootDir, relativePath), "utf8").replace(/^\uFEFF/u, ""));
}

function readJsonl(relativePath) {
  return parseJsonl(readFileSync(path.join(rootDir, relativePath), "utf8"), relativePath);
}

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = typeof selector === "function" ? selector(value) : value[selector];
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function assertEnum(value, allowed, field, sampleId) {
  if (!allowed.includes(value)) throw new Error(`${sampleId}: unsupported ${field}=${JSON.stringify(value)}`);
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

function readZipEntries(buffer, archiveLabel) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  if (entryCount !== 51) throw new Error(`${archiveLabel}: expected 51 ZIP entries, got ${entryCount}`);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  const names = new Set();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`${archiveLabel}: invalid central directory entry ${index + 1}`);
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (name !== path.basename(name) || name.includes("..") || name.includes("\\") || name.includes("/")) {
      throw new Error(`${archiveLabel}: unsafe ZIP entry name ${JSON.stringify(name)}`);
    }
    if (names.has(name)) throw new Error(`${archiveLabel}: duplicate ZIP entry ${name}`);
    names.add(name);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`${archiveLabel}: invalid local header for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (compressionMethod === 0) content = compressed;
    else if (compressionMethod === 8) content = inflateRawSync(compressed);
    else throw new Error(`${archiveLabel}: unsupported compression method ${compressionMethod}`);
    if (content.length !== uncompressedSize) throw new Error(`${archiveLabel}: size mismatch for ${name}`);
    entries.push({ name, content });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function validateBoundary(boundary, sampleId) {
  if (!boundary || typeof boundary !== "object" || Array.isArray(boundary)) {
    throw new Error(`${sampleId}: boundary must be an object`);
  }
  const keys = ["kind", "boundaryType", "confidence", "payloadBlockCount"];
  if (!same(Object.keys(boundary).sort(), [...keys].sort())) throw new Error(`${sampleId}: boundary fields mismatch`);
  const valid =
    (boundary.kind === "instruction_only" && boundary.boundaryType === "none" && boundary.confidence === "none" && boundary.payloadBlockCount === "zero") ||
    (boundary.kind === "explicit_separation" && ["code_fence", "role_tag", "role_heading", "begin_end", "blockquote", "inline_cue", "multiple"].includes(boundary.boundaryType) && ["low", "medium", "high"].includes(boundary.confidence) && ["one", "multiple"].includes(boundary.payloadBlockCount)) ||
    (boundary.kind === "ambiguous_separation" && ["unsupported", "multiple"].includes(boundary.boundaryType) && boundary.confidence === "low" && ["zero", "one", "multiple"].includes(boundary.payloadBlockCount)) ||
    (boundary.kind === "payload_only" && ["code_fence", "role_tag", "role_heading", "begin_end", "blockquote", "inline_cue", "multiple", "unsupported"].includes(boundary.boundaryType) && ["low", "medium", "high"].includes(boundary.confidence) && ["one", "multiple"].includes(boundary.payloadBlockCount));
  if (!valid) throw new Error(`${sampleId}: invalid boundary tuple ${JSON.stringify(boundary)}`);
}

function validateResultRow(row, inputRow) {
  const sampleId = row?.sampleId ?? "<missing sampleId>";
  if (!same(Object.keys(row).sort(), [...resultFields].sort())) throw new Error(`${sampleId}: result fields mismatch`);
  if (row.schemaVersion !== "gatelm.difficulty-independent-ood-gpt-review.v1") throw new Error(`${sampleId}: schemaVersion mismatch`);
  if (row.datasetVersion !== datasetVersion) throw new Error(`${sampleId}: datasetVersion mismatch`);
  if (row.automatedReviewerPass !== "reviewer_a") throw new Error(`${sampleId}: expected reviewer_a pass`);
  if (row.batchId !== inputRow.batchId || row.sampleId !== inputRow.sampleId) throw new Error(`${sampleId}: packet identity/order mismatch`);
  for (const [field, allowed] of Object.entries(enumValues)) assertEnum(row[field], allowed, field, sampleId);
  if (!semanticLabels[row.expectedCategory].includes(row.expectedSemanticLabel)) throw new Error(`${sampleId}: semantic label/category mismatch`);
  validateBoundary(row.expectedInstructionPayloadBoundary, sampleId);
  if (!Array.isArray(row.evaluationSlices) || row.evaluationSlices.length === 0 || new Set(row.evaluationSlices).size !== row.evaluationSlices.length) {
    throw new Error(`${sampleId}: evaluationSlices must be a non-empty unique array`);
  }
  for (const slice of row.evaluationSlices) assertEnum(slice, slices, "evaluationSlices", sampleId);
  if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) throw new Error(`${sampleId}: invalid confidence`);
  if (!Array.isArray(row.issueCodes) || new Set(row.issueCodes).size !== row.issueCodes.length) throw new Error(`${sampleId}: invalid issueCodes`);
  for (const code of row.issueCodes) assertEnum(code, issueCodes, "issueCodes", sampleId);
  if (typeof row.rationale !== "string" || [...row.rationale].length > 500) throw new Error(`${sampleId}: invalid rationale`);

  const buckets = [row.taskBucket, row.constraintBucket, row.scopeBucket, row.dependencyBucket];
  if (row.semanticInputStatus === "empty_instruction" && buckets.some((value) => value !== "not_applicable")) {
    throw new Error(`${sampleId}: empty_instruction requires four not_applicable buckets`);
  }
  if (row.semanticInputStatus === "eligible" && buckets.includes("not_applicable")) throw new Error(`${sampleId}: eligible uses not_applicable`);
  if (row.expectedInstructionPayloadBoundary.kind === "payload_only" && row.semanticInputStatus !== "empty_instruction") {
    throw new Error(`${sampleId}: payload_only requires empty_instruction`);
  }
  const expectedLanguageSlice = { ko: "korean", en: "english", mixed: "mixed_language" }[inputRow.language];
  const languageSlices = ["korean", "english", "mixed_language"].filter((slice) => row.evaluationSlices.includes(slice));
  if (!expectedLanguageSlice || !same(languageSlices, [expectedLanguageSlice])) throw new Error(`${sampleId}: language slice mismatch`);
  const shortComplex = row.expectedDifficulty === "complex" && inputRow.promptRuneLength <= 120;
  const longSimple = row.expectedDifficulty === "simple" && inputRow.promptRuneLength > 120;
  if (row.evaluationSlices.includes("short_complex") !== shortComplex) throw new Error(`${sampleId}: short_complex mismatch`);
  if (row.evaluationSlices.includes("long_simple") !== longSimple) throw new Error(`${sampleId}: long_simple mismatch`);
  if (row.evaluationSlices.includes("payload_contamination") && row.expectedInstructionPayloadBoundary.kind === "instruction_only") {
    throw new Error(`${sampleId}: payload_contamination cannot be instruction_only`);
  }
}

function normalizedValue(field, value) {
  if (field === "evaluationSlices") {
    return [...value].sort((left, right) => slices.indexOf(left) - slices.indexOf(right));
  }
  return value;
}

function projectLabels(record) {
  return Object.fromEntries(labelFields.map((field) => [field, normalizedValue(field, record[field])]));
}

function changedFields(candidate, review) {
  const changes = [];
  for (const field of labelFields) {
    const provisional = normalizedValue(field, candidate[field]);
    const reviewerA = normalizedValue(field, review[field]);
    if (!same(provisional, reviewerA)) changes.push({ field, provisional, reviewerA });
  }
  return changes;
}

function priorityForQueue(changes, reasons) {
  if (reasons.includes("gpt_needs_human_adjudication") || reasons.includes("gpt_reject_input")) return "priority_0_gpt_escalation";
  if (changes.some((change) => coreLabelFields.has(change.field))) return "priority_1_core_label_conflict";
  if (reasons.includes("low_confidence") || reasons.includes("gpt_issue_code")) return "priority_2_low_confidence_or_quality";
  if (changes.some((change) => structureLabelFields.has(change.field))) return "priority_3_structure_conflict";
  return "priority_4_slice_only_conflict";
}

function confusionMatrix(records, provisionalField, reviewedField, labels) {
  const result = Object.fromEntries(labels.map((label) => [label, Object.fromEntries(labels.map((target) => [target, 0]))]));
  for (const record of records) result[record.candidate[provisionalField]][record.review[reviewedField]] += 1;
  return result;
}

function markdownReport(summary) {
  const mismatchRows = Object.entries(summary.fieldMismatchRecords)
    .map(([field, count]) => `| \`${field}\` | ${count} |`)
    .join("\n");
  const reasonRows = Object.entries(summary.queueReasonRecords).map(([reason, count]) => `| \`${reason}\` | ${count} |`).join("\n");
  const priorityRows = Object.entries(summary.priorityQueueRecords).map(([priority, count]) => `| \`${priority}\` | ${count} |`).join("\n");
  return `# Dataset 2 Reviewer A Comparison Report

| Field | Value |
|---|---:|
| Validated GPT records | ${summary.records} |
| Exact 11-field agreement | ${summary.exactLabelAgreementRecords} |
| Exact agreement + high confidence + no issue | ${summary.cleanHighConfidenceAgreementRecords} |
| Record adjudication queue | ${summary.adjudicationQueueRecords} |
| Family-context queue | ${summary.adjudicationQueueFamilies} |
| Confidence below ${summary.lowConfidenceThreshold.toFixed(2)} | ${summary.lowConfidenceRecords} |
| Core-label conflict records | ${summary.coreConflictRecords} |
| Core-label conflict families | ${summary.coreConflictFamilies} |

Agreement는 provisional synthetic label과 Reviewer A 판정의 일치율이며 accuracy나 human approval이 아니다. GPT 결과는 automated supporting evidence이고 Dataset 2는 계속 pending, training-ineligible 상태다.

## Review priority

| Priority | Records |
|---|---:|
${priorityRows}

## Queue reasons

| Reason | Records |
|---|---:|
${reasonRows || "| none | 0 |"}

## Field mismatches

| Field | Records |
|---|---:|
${mismatchRows}

Owner는 record queue를 먼저 보고, category/semantic label처럼 family 일관성이 필요한 변경은 family-context queue에서 같은 family의 5개 변형을 함께 확인해야 한다.
`;
}

export function buildReviewerAImportArtifacts(options = {}) {
  const archiveBuffer = options.archiveBuffer ?? readFileSync(path.join(rootDir, storedArchivePath));
  const archiveLabel = options.archiveLabel ?? path.basename(storedArchivePath);
  const packetManifest = readJson(packetManifestPath);
  const candidateManifest = readJson(candidateManifestPath);
  const candidates = readJsonl(candidatePath);
  const candidateText = readFileSync(path.join(rootDir, candidatePath), "utf8");
  if (candidateManifest.datasetSha256 !== sha256(candidateText)) throw new Error("candidate dataset hash mismatch");
  if (candidates.length !== 5000 || new Set(candidates.map((record) => record.sampleId)).size !== 5000) throw new Error("candidate must contain 5,000 unique records");
  const candidateById = new Map(candidates.map((record) => [record.sampleId, record]));

  const packetRowsByBatch = new Map();
  for (const packet of packetManifest.packets) {
    const packetText = readFileSync(path.join(rootDir, packet.inputPath), "utf8");
    if (sha256(packetText) !== packet.inputSha256) throw new Error(`${packet.batchId}: packet hash mismatch`);
    const rows = parseJsonl(packetText, packet.inputPath);
    if (rows.length !== 100) throw new Error(`${packet.batchId}: expected 100 packet rows`);
    packetRowsByBatch.set(packet.batchId, rows);
  }
  if (packetRowsByBatch.size !== 50) throw new Error("packet manifest must contain 50 batches");

  const entries = readZipEntries(archiveBuffer, archiveLabel);
  const summaryName = "difficulty-independent-ood-5000.gpt-review.reviewer-a.batch-001-050.VALIDATION-SUMMARY.json";
  const validationSummaryEntry = entries.find((entry) => entry.name === summaryName);
  if (!validationSummaryEntry) throw new Error(`${archiveLabel}: validation summary is missing`);
  const sourceValidationSummary = JSON.parse(validationSummaryEntry.content.toString("utf8"));
  const outputPattern = /^difficulty-independent-ood-5000\.gpt-review\.reviewer-a\.(batch-\d{3})\.output\.jsonl$/u;
  const outputEntries = entries.filter((entry) => outputPattern.test(entry.name));
  if (outputEntries.length !== 50 || entries.length !== 51) throw new Error(`${archiveLabel}: expected 50 outputs and one summary`);
  outputEntries.sort((left, right) => left.name.localeCompare(right.name));

  const reviews = [];
  const reviewIds = new Set();
  for (const entry of outputEntries) {
    const batchId = entry.name.match(outputPattern)[1];
    const packet = packetManifest.packets.find((item) => item.batchId === batchId);
    if (!packet || packet.reviewerAOutputName !== entry.name) throw new Error(`${entry.name}: not declared by packet manifest`);
    const inputRows = packetRowsByBatch.get(batchId);
    const rows = parseJsonl(entry.content.toString("utf8"), `${archiveLabel}:${entry.name}`);
    if (rows.length !== inputRows.length) throw new Error(`${entry.name}: expected ${inputRows.length} rows, got ${rows.length}`);
    for (let index = 0; index < rows.length; index += 1) {
      validateResultRow(rows[index], inputRows[index]);
      if (reviewIds.has(rows[index].sampleId)) throw new Error(`${rows[index].sampleId}: duplicate review output`);
      reviewIds.add(rows[index].sampleId);
      reviews.push(rows[index]);
    }
  }
  if (reviews.length !== 5000 || reviewIds.size !== 5000 || candidates.some((record) => !reviewIds.has(record.sampleId))) {
    throw new Error("review output union must exactly match the 5,000 candidate sampleIds");
  }

  const comparisons = reviews.map((review) => {
    const candidate = candidateById.get(review.sampleId);
    if (!candidate) throw new Error(`${review.sampleId}: review sample is absent from candidate`);
    return { candidate, review, changes: changedFields(candidate, review) };
  });
  const queueRows = [];
  const queueById = new Map();
  for (const comparison of comparisons) {
    const reasons = [];
    if (comparison.changes.length > 0) reasons.push("provisional_label_mismatch");
    if (comparison.review.confidence < lowConfidenceThreshold) reasons.push("low_confidence");
    if (comparison.review.decision === "needs_human_adjudication") reasons.push("gpt_needs_human_adjudication");
    if (comparison.review.decision === "reject_input") reasons.push("gpt_reject_input");
    if (comparison.review.issueCodes.length > 0) reasons.push("gpt_issue_code");
    if (reasons.length === 0) continue;
    const row = {
      schemaVersion: "gatelm.difficulty-independent-ood-owner-adjudication-queue.v1",
      datasetVersion,
      sampleId: comparison.candidate.sampleId,
      promptFamily: comparison.candidate.promptFamily,
      language: comparison.candidate.language,
      redactedPrompt: comparison.candidate.redactedPrompt,
      queueReasons: reasons,
      changedFields: comparison.changes,
      priority: priorityForQueue(comparison.changes, reasons),
      reviewerA: {
        decision: comparison.review.decision,
        confidence: comparison.review.confidence,
        issueCodes: comparison.review.issueCodes,
      },
      provisionalLabels: projectLabels(comparison.candidate),
      reviewerALabels: projectLabels(comparison.review),
      ownerDecision: "pending",
    };
    queueRows.push(row);
    queueById.set(row.sampleId, row);
  }
  queueRows.sort((left, right) => left.promptFamily.localeCompare(right.promptFamily) || left.sampleId.localeCompare(right.sampleId));

  const flaggedFamilies = new Set(queueRows.map((row) => row.promptFamily));
  const comparisonsByFamily = new Map();
  for (const comparison of comparisons) {
    const family = comparison.candidate.promptFamily;
    if (!flaggedFamilies.has(family)) continue;
    if (!comparisonsByFamily.has(family)) comparisonsByFamily.set(family, []);
    comparisonsByFamily.get(family).push(comparison);
  }
  const familyQueueRows = [...comparisonsByFamily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([promptFamily, members]) => ({
    schemaVersion: "gatelm.difficulty-independent-ood-owner-family-context.v1",
    datasetVersion,
    promptFamily,
    directlyFlaggedRecords: members.filter((item) => queueById.has(item.candidate.sampleId)).length,
    members: members.sort((left, right) => left.candidate.sampleId.localeCompare(right.candidate.sampleId)).map((item) => {
      const direct = queueById.get(item.candidate.sampleId);
      return {
        sampleId: item.candidate.sampleId,
        language: item.candidate.language,
        redactedPrompt: item.candidate.redactedPrompt,
        directlyFlagged: Boolean(direct),
        queueReasons: direct?.queueReasons ?? [],
        changedFields: item.changes,
        reviewerA: {
          decision: item.review.decision,
          confidence: item.review.confidence,
          issueCodes: item.review.issueCodes,
        },
        provisionalLabels: projectLabels(item.candidate),
        reviewerALabels: projectLabels(item.review),
      };
    }),
    ownerFamilyDecision: "pending",
  }));
  const priorityQueueRows = Object.fromEntries(
    Object.keys(priorityPaths).map((priority) => [priority, queueRows.filter((row) => row.priority === priority)]),
  );
  const coreConflictFamilies = new Set(
    queueRows
      .filter((row) => row.changedFields.some((change) => coreLabelFields.has(change.field)))
      .map((row) => row.promptFamily),
  );
  const coreFamilyQueueRows = familyQueueRows.filter((row) => coreConflictFamilies.has(row.promptFamily));

  const fieldMismatchRecords = Object.fromEntries(labelFields.map((field) => [field, comparisons.filter((item) => item.changes.some((change) => change.field === field)).length]));
  const queueReasonRecords = countBy(queueRows.flatMap((row) => row.queueReasons), (reason) => reason);
  const confidenceValues = reviews.map((row) => row.confidence);
  const exactLabelAgreementRecords = comparisons.filter((item) => item.changes.length === 0).length;
  const cleanHighConfidenceAgreementRecords = comparisons.filter((item) =>
    item.changes.length === 0 && item.review.confidence >= lowConfidenceThreshold && item.review.decision === "label_complete" && item.review.issueCodes.length === 0,
  ).length;
  const summary = {
    schemaVersion: "gatelm.difficulty-independent-ood-gpt-review-comparison-summary.v1",
    datasetVersion,
    reviewerPass: "reviewer_a",
    records: reviews.length,
    families: new Set(candidates.map((record) => record.promptFamily)).size,
    lowConfidenceThreshold,
    exactLabelAgreementRecords,
    exactLabelAgreementRate: exactLabelAgreementRecords / reviews.length,
    cleanHighConfidenceAgreementRecords,
    cleanHighConfidenceAgreementRate: cleanHighConfidenceAgreementRecords / reviews.length,
    adjudicationQueueRecords: queueRows.length,
    adjudicationQueueFamilies: familyQueueRows.length,
    coreConflictRecords: queueRows.filter((row) => row.changedFields.some((change) => coreLabelFields.has(change.field))).length,
    coreConflictFamilies: coreFamilyQueueRows.length,
    priorityQueueRecords: countBy(queueRows, "priority"),
    lowConfidenceRecords: reviews.filter((row) => row.confidence < lowConfidenceThreshold).length,
    reviewerDecisionRecords: countBy(reviews, "decision"),
    issueCodeRecords: countBy(reviews.flatMap((row) => row.issueCodes), (code) => code),
    queueReasonRecords,
    fieldMismatchRecords,
    confidence: {
      minimum: Math.min(...confidenceValues),
      maximum: Math.max(...confidenceValues),
      mean: confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length,
      below_0_80: confidenceValues.filter((value) => value < 0.8).length,
      from_0_80_to_below_0_90: confidenceValues.filter((value) => value >= 0.8 && value < 0.9).length,
      from_0_90_to_below_0_95: confidenceValues.filter((value) => value >= 0.9 && value < 0.95).length,
      at_least_0_95: confidenceValues.filter((value) => value >= 0.95).length,
    },
    difficultyAgreementMatrix: confusionMatrix(comparisons, "expectedDifficulty", "expectedDifficulty", ["simple", "complex"]),
    categoryAgreementMatrix: confusionMatrix(comparisons, "expectedCategory", "expectedCategory", ["general", "code", "translation", "summarization", "reasoning"]),
    sourceValidationSummary,
    agreementIsAccuracy: false,
    humanApprovalStatus: "pending",
    trainingEligible: false,
    createdAt: importedAt,
  };

  const combinedText = canonicalJsonl(reviews);
  const queueText = canonicalJsonl(queueRows);
  const familyQueueText = canonicalJsonl(familyQueueRows);
  const priorityQueueTexts = Object.fromEntries(
    Object.entries(priorityQueueRows).map(([priority, rows]) => [priority, canonicalJsonl(rows)]),
  );
  const coreFamilyQueueText = canonicalJsonl(coreFamilyQueueRows);
  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
  const reportText = markdownReport(summary);
  const outputs = {
    archive: { path: storedArchivePath, bytes: archiveBuffer.length, sha256: sha256(archiveBuffer) },
    combinedValidated: { path: combinedPath, records: reviews.length, sha256: sha256(combinedText) },
    recordAdjudicationQueue: { path: queuePath, records: queueRows.length, sha256: sha256(queueText) },
    familyContextQueue: { path: familyQueuePath, families: familyQueueRows.length, sha256: sha256(familyQueueText) },
    coreFamilyContextQueue: { path: coreFamilyQueuePath, families: coreFamilyQueueRows.length, sha256: sha256(coreFamilyQueueText) },
    priorityQueues: Object.fromEntries(
      Object.entries(priorityQueueTexts).map(([priority, text]) => [priority, {
        path: priorityPaths[priority],
        records: priorityQueueRows[priority].length,
        sha256: sha256(text),
      }]),
    ),
    comparisonSummary: { path: summaryPath, sha256: sha256(summaryText) },
    comparisonReport: { path: reportPath, sha256: sha256(reportText) },
  };
  const importManifest = {
    schemaVersion: "gatelm.difficulty-independent-ood-gpt-review-import-manifest.v1",
    datasetVersion,
    reviewerPass: "reviewer_a",
    sourceArchiveFileName: path.basename(archiveLabel),
    sourceArchiveSha256: sha256(archiveBuffer),
    candidate: { path: candidatePath, sha256: sha256(candidateText), records: candidates.length },
    packetManifest: { path: packetManifestPath, sha256: sha256(readFileSync(path.join(rootDir, packetManifestPath))) },
    comparisonPolicy: {
      labelFields,
      evaluationSlicesComparedAsSet: true,
      lowConfidenceThreshold,
      queueOnNonCompleteDecision: true,
      queueOnIssueCode: true,
      preserveCandidate: true,
    },
    outputs,
    automatedReviewOnly: true,
    confersHumanReviewStatus: false,
    humanApprovalStatus: "pending",
    trainingEligible: false,
    importedAt,
  };
  const importManifestText = `${JSON.stringify(importManifest, null, 2)}\n`;
  return {
    artifacts: {
      [storedArchivePath]: archiveBuffer,
      [combinedPath]: combinedText,
      [queuePath]: queueText,
      [familyQueuePath]: familyQueueText,
      [coreFamilyQueuePath]: coreFamilyQueueText,
      ...Object.fromEntries(Object.entries(priorityQueueTexts).map(([priority, text]) => [priorityPaths[priority], text])),
      [summaryPath]: summaryText,
      [reportPath]: reportText,
      [importManifestPath]: importManifestText,
    },
    reviews,
    queueRows,
    familyQueueRows,
    priorityQueueRows,
    coreFamilyQueueRows,
    summary,
    importManifest,
  };
}

function writeArtifacts(artifacts, checkOnly) {
  const drift = [];
  for (const [relativePath, contents] of Object.entries(artifacts)) {
    const absolutePath = path.join(rootDir, relativePath);
    if (checkOnly) {
      if (!existsSync(absolutePath)) {
        drift.push(relativePath);
        continue;
      }
      const actual = readFileSync(absolutePath);
      const expected = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
      if (!actual.equals(expected)) drift.push(relativePath);
      continue;
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }
  if (drift.length > 0) throw new Error(`stale Reviewer A import artifacts:\n${drift.join("\n")}`);
}

function argumentValue(prefix) {
  const argument = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return argument ? argument.slice(prefix.length + 1) : null;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const archiveArgument = argumentValue("--archive");
  if (checkOnly && archiveArgument) throw new Error("--check cannot be combined with --archive");
  if (!checkOnly && !archiveArgument) throw new Error("usage: node import-v2.1-difficulty-independent-ood-5000-gpt-review.mjs --archive=<outputs.zip>");
  const archiveBuffer = archiveArgument ? readFileSync(path.resolve(archiveArgument)) : undefined;
  const archiveLabel = archiveArgument ? path.basename(archiveArgument) : path.basename(storedArchivePath);
  const built = buildReviewerAImportArtifacts({ archiveBuffer, archiveLabel });
  writeArtifacts(built.artifacts, checkOnly);
  console.log(
    `${checkOnly ? "verified" : "imported"} Reviewer A: ${built.reviews.length} records, ` +
      `${built.summary.exactLabelAgreementRecords} exact agreements, ${built.queueRows.length} queued records across ${built.familyQueueRows.length} families`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
