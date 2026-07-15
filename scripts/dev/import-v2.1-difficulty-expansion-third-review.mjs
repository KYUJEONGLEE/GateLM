import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

const REVIEW_DIRECTORY = "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt";
const THIRD_DIRECTORY = `${REVIEW_DIRECTORY}/third-review-gpt`;
const SECOND_CANDIDATE_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.second-review-merged-candidate.jsonl`;
const RAW_PATH = `${THIRD_DIRECTORY}/review-merged.raw.jsonl`;
const THIRD_CANDIDATE_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.third-review-confirmed-candidate.jsonl`;
const CONFIRMATIONS_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.third-review-confirmations.jsonl`;
const REMAINING_QUEUE_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.remaining-review-queue.jsonl`;
const REPORT_JSON_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.third-review-report.json`;
const REPORT_MARKDOWN_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.third-review-report.md`;

const OUTPUT_SCHEMA_VERSION =
  "gatelm.difficulty-expansion-third-review-recommendation.v1";
const CANDIDATE_DATASET_VERSION =
  "difficulty_label_2026_07_15_expansion_2000_gpt_third_review_candidate_v1";
const CREATED_AT = "2026-07-15T00:00:00Z";
const EXPECTED_ZIP_SHA256 =
  "05f049c6b2a3d6e6ed3b3442ca0a07222f759ffa54c67d5723463d06b37dc492";
const BATCH_COUNT = 5;
const OUTPUT_FIELDS = [
  "schemaVersion",
  "sampleId",
  "recommendation",
  "correctedPrompt",
  "confidence",
  "checks",
  "rationaleCodes",
  "reviewNote",
];
const CHECK_FIELDS = [
  "instructionMeaningPreserved",
  "requestedPayloadCountSatisfied",
  "boundaryStructurePreserved",
  "familyIntentPreserved",
  "lengthAndLanguageSlicesValid",
];
const RECOMMENDATIONS = [
  "approve_second_candidate",
  "correct_second_candidate",
  "reject_second_candidate",
];
const RATIONALE_CODES = [
  "candidate_confirmed",
  "missing_payload",
  "duplicated_payload",
  "boundary_structure_changed",
  "instruction_meaning_changed",
  "family_intent_changed",
  "length_slice_risk",
  "insufficient_context",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalJsonl(records) {
  return records.length === 0 ? "" : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function parseJsonl(text, label) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "" && !["```", "```json", "```jsonl"].includes(line.trim()))
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}: invalid JSON at line ${index + 1}: ${error.message}`);
      }
    });
}

function countBy(records, field) {
  const counts = {};
  for (const record of records) counts[record[field]] = (counts[record[field]] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function inputBatchPath(batchNumber) {
  return `${THIRD_DIRECTORY}/review-${String(batchNumber).padStart(2, "0")}.input.jsonl`;
}

function readInputRows() {
  return Array.from({ length: BATCH_COUNT }, (_, index) => index + 1).flatMap((batchNumber) =>
    parseJsonl(
      readFileSync(path.resolve(inputBatchPath(batchNumber)), "utf8"),
      `third review input ${batchNumber}`,
    ),
  );
}

function validateRow(row, input) {
  const sampleId = row?.sampleId ?? "<missing sampleId>";
  if (row?.schemaVersion !== OUTPUT_SCHEMA_VERSION) {
    throw new Error(`${sampleId}: unsupported third-review schemaVersion`);
  }
  if (!same(Object.keys(row).sort(), [...OUTPUT_FIELDS].sort())) {
    throw new Error(`${sampleId}: third-review fields do not match the output contract`);
  }
  if (!RECOMMENDATIONS.includes(row.recommendation)) {
    throw new Error(`${sampleId}: unsupported recommendation ${JSON.stringify(row.recommendation)}`);
  }
  if (!row.checks || typeof row.checks !== "object" || Array.isArray(row.checks)) {
    throw new Error(`${sampleId}: checks must be an object`);
  }
  if (!same(Object.keys(row.checks).sort(), [...CHECK_FIELDS].sort())) {
    throw new Error(`${sampleId}: checks fields do not match the output contract`);
  }
  for (const field of CHECK_FIELDS) {
    if (typeof row.checks[field] !== "boolean") {
      throw new Error(`${sampleId}: checks.${field} must be boolean`);
    }
  }
  if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) {
    throw new Error(`${sampleId}: confidence must be between 0 and 1`);
  }
  if (!Array.isArray(row.rationaleCodes) || row.rationaleCodes.length === 0) {
    throw new Error(`${sampleId}: rationaleCodes must be non-empty`);
  }
  if (new Set(row.rationaleCodes).size !== row.rationaleCodes.length) {
    throw new Error(`${sampleId}: rationaleCodes must be unique`);
  }
  for (const code of row.rationaleCodes) {
    if (!RATIONALE_CODES.includes(code)) {
      throw new Error(`${sampleId}: unsupported rationale code ${JSON.stringify(code)}`);
    }
  }
  if (typeof row.reviewNote !== "string" || [...row.reviewNote].length > 240) {
    throw new Error(`${sampleId}: reviewNote must be at most 240 code points`);
  }
  const allChecksPass = CHECK_FIELDS.every((field) => row.checks[field] === true);
  if (row.recommendation === "approve_second_candidate") {
    if (!allChecksPass || row.correctedPrompt !== null) {
      throw new Error(`${sampleId}: approval requires all checks=true and correctedPrompt=null`);
    }
  } else if (row.recommendation === "correct_second_candidate") {
    if (typeof row.correctedPrompt !== "string" || row.correctedPrompt.trim() === "") {
      throw new Error(`${sampleId}: correction requires a non-empty correctedPrompt`);
    }
    if (row.correctedPrompt === input.secondCandidatePrompt) {
      throw new Error(`${sampleId}: correctedPrompt must differ from secondCandidatePrompt`);
    }
  } else if (row.correctedPrompt !== null) {
    throw new Error(`${sampleId}: rejection requires correctedPrompt=null`);
  }
}

function markdownReport(report) {
  return `# Difficulty expansion 2,000 — third GPT review merge

## 결론

- ZIP의 5개 output은 250개 third-review input과 행 수·순서·sampleId가 정확히 일치한다.
- 250건 모두 \`approve_second_candidate\`, confidence 0.99이며 corrected/rejected record는 0건이다.
- instruction 의미, 요청 payload 수, boundary 구조, family intent, length/language slice의 다섯 check가 250건 모두 true다.
- 행 단위 잔여 검토 큐는 0건이다.
- GPT 검토는 사람 승인 자체가 아니므로 candidate는 owner의 명시적 승인 전까지 \`pending\`, \`trainingEligible=false\`다.

## 무결성 및 결과

| 항목 | 건수 |
|---|---:|
| 입력·출력 | ${report.integrity.records} |
| 누락·중복·예상 밖 ID | 0 |
| approve_second_candidate | ${report.recommendations.approve_second_candidate ?? 0} |
| correct_second_candidate | ${report.recommendations.correct_second_candidate ?? 0} |
| reject_second_candidate | ${report.recommendations.reject_second_candidate ?? 0} |
| false/missing check | ${report.checks.falseOrMissing} |
| canonical v2 검증 실패 | ${report.validation.canonicalRecordFailures} |
| family 충돌 | ${report.validation.familyConflicts} |
| 잔여 검토 큐 | ${report.remainingReviewQueue.records} |

## 산출물

- \`${path.basename(THIRD_CANDIDATE_PATH)}\`: 3차 GPT가 확인한 2,000건 pending candidate
- \`${path.basename(CONFIRMATIONS_PATH)}\`: 250개 confirmation evidence
- \`${path.basename(REMAINING_QUEUE_PATH)}\`: 잔여 행 단위 검토 큐(현재 빈 파일)
`;
}

export function buildThirdReviewArtifacts({ rawText, inputText, secondCandidateText, sourceZipSha256 }) {
  const rows = parseJsonl(rawText, "third review output");
  const inputs = parseJsonl(inputText, "third review input");
  const secondCandidate = parseJsonl(secondCandidateText, "second-review candidate");
  if (rows.length !== 250 || inputs.length !== 250 || secondCandidate.length !== 2000) {
    throw new Error(`unexpected third-review counts ${rows.length}/${inputs.length}/${secondCandidate.length}`);
  }
  const inputIds = inputs.map((row) => row.sampleId);
  const outputIds = rows.map((row) => row.sampleId);
  if (new Set(outputIds).size !== 250 || !same(inputIds, outputIds)) {
    throw new Error("third-review output IDs must match input order without duplicates");
  }
  const candidateById = new Map(secondCandidate.map((record) => [record.sampleId, record]));
  rows.forEach((row, index) => {
    const input = inputs[index];
    const candidate = candidateById.get(row.sampleId);
    if (!candidate || input.secondCandidatePrompt !== candidate.redactedPrompt) {
      throw new Error(`${row.sampleId}: third-review candidate prompt does not match checked-in artifact`);
    }
    validateRow(row, input);
  });

  const rowById = new Map(rows.map((row) => [row.sampleId, row]));
  const thirdCandidate = secondCandidate.map((record) => {
    const row = rowById.get(record.sampleId);
    return {
      ...record,
      datasetVersion: CANDIDATE_DATASET_VERSION,
      redactedPrompt:
        row?.recommendation === "correct_second_candidate" ? row.correctedPrompt : record.redactedPrompt,
    };
  });
  const validationFailures = verifyDifficultyLabelRecords(thirdCandidate);
  if (validationFailures.length > 0) {
    throw new Error(`third-review candidate failed canonical v2 validation:\n${validationFailures.join("\n")}`);
  }
  const remainingRows = rows.filter(
    (row) =>
      row.recommendation !== "approve_second_candidate" ||
      CHECK_FIELDS.some((field) => row.checks[field] !== true),
  );
  const confirmations = rows
    .filter((row) => !remainingRows.includes(row))
    .map((row) => ({
      schemaVersion: "gatelm.difficulty-expansion-third-review-confirmation.v1",
      sampleId: row.sampleId,
      promptFamily: candidateById.get(row.sampleId).promptFamily,
      recommendation: row.recommendation,
      confidence: row.confidence,
      checks: row.checks,
      rationaleCodes: row.rationaleCodes,
      reviewNote: row.reviewNote,
      ownerApprovalStatus: "pending",
    }));
  const remainingQueue = remainingRows.map((row) => ({
    schemaVersion: "gatelm.difficulty-expansion-remaining-review-queue.v1",
    sampleId: row.sampleId,
    promptFamily: candidateById.get(row.sampleId).promptFamily,
    recommendation: row.recommendation,
    confidence: row.confidence,
    checks: row.checks,
    correctedPrompt: row.correctedPrompt,
    rationaleCodes: row.rationaleCodes,
    reviewNote: row.reviewNote,
  }));
  const families = new Map();
  for (const record of thirdCandidate) {
    if (!families.has(record.promptFamily)) families.set(record.promptFamily, []);
    families.get(record.promptFamily).push(record);
  }
  const familyConflicts = [...families.values()].filter(
    (records) =>
      records.length !== 10 ||
      new Set(records.map((record) => record.expectedCategory)).size !== 1 ||
      new Set(records.map((record) => record.expectedSemanticLabel)).size !== 1,
  ).length;
  const rawCanonicalText = canonicalJsonl(rows);
  const candidateText = canonicalJsonl(thirdCandidate);
  const confirmationsText = canonicalJsonl(confirmations);
  const remainingText = canonicalJsonl(remainingQueue);
  const falseOrMissingChecks = rows.reduce(
    (count, row) => count + CHECK_FIELDS.filter((field) => row.checks[field] !== true).length,
    0,
  );
  const report = {
    schemaVersion: "gatelm.difficulty-expansion-third-review-report.v1",
    status: "third_gpt_review_merged_owner_approval_pending",
    createdAt: CREATED_AT,
    sourceZipSha256,
    candidateDatasetVersion: CANDIDATE_DATASET_VERSION,
    trainingEligible: false,
    humanReviewClaimed: false,
    integrity: {
      batches: BATCH_COUNT,
      records: rows.length,
      uniqueSampleIds: new Set(outputIds).size,
      missingSampleIds: 0,
      duplicateSampleIds: 0,
      unexpectedSampleIds: 0,
      orderMismatches: 0,
      parseErrors: 0,
    },
    recommendations: countBy(rows, "recommendation"),
    confidence: {
      minimum: Math.min(...rows.map((row) => row.confidence)),
      maximum: Math.max(...rows.map((row) => row.confidence)),
      below090: rows.filter((row) => row.confidence < 0.9).length,
    },
    checks: {
      fields: CHECK_FIELDS,
      true: rows.length * CHECK_FIELDS.length - falseOrMissingChecks,
      falseOrMissing: falseOrMissingChecks,
    },
    validation: {
      canonicalRecordFailures: validationFailures.length,
      familyConflicts,
      families: families.size,
    },
    confirmations: { records: confirmations.length },
    remainingReviewQueue: { records: remainingQueue.length },
    ownerApproval: {
      status: "pending",
      approvedRecords: 0,
      requiredAction: "dataset_owner_explicit_bulk_approval",
    },
    artifacts: {
      rawReview: { path: RAW_PATH, records: rows.length, sha256: sha256(rawCanonicalText) },
      thirdCandidate: {
        path: THIRD_CANDIDATE_PATH,
        records: thirdCandidate.length,
        sha256: sha256(candidateText),
      },
      confirmations: {
        path: CONFIRMATIONS_PATH,
        records: confirmations.length,
        sha256: sha256(confirmationsText),
      },
      remainingReviewQueue: {
        path: REMAINING_QUEUE_PATH,
        records: remainingQueue.length,
        sha256: sha256(remainingText),
      },
    },
  };
  return {
    rows,
    thirdCandidate,
    confirmations,
    remainingQueue,
    report,
    files: {
      [RAW_PATH]: rawCanonicalText,
      [THIRD_CANDIDATE_PATH]: candidateText,
      [CONFIRMATIONS_PATH]: confirmationsText,
      [REMAINING_QUEUE_PATH]: remainingText,
      [REPORT_JSON_PATH]: `${JSON.stringify(report, null, 2)}\n`,
      [REPORT_MARKDOWN_PATH]: markdownReport(report),
    },
  };
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

function readZipEntries(zipPath) {
  const buffer = readFileSync(zipPath);
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid ZIP central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!content) throw new Error(`${name}: unsupported ZIP compression method ${method}`);
    if (content.length !== uncompressedSize) throw new Error(`${name}: ZIP size mismatch`);
    entries.set(name, content.toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { buffer, entries };
}

function rawTextFromZip(zipPath) {
  const { buffer, entries } = readZipEntries(zipPath);
  const actualHash = sha256(buffer);
  if (actualHash !== EXPECTED_ZIP_SHA256) {
    throw new Error(`third-review ZIP SHA-256 mismatch: ${actualHash}`);
  }
  const rows = [];
  for (let batchNumber = 1; batchNumber <= BATCH_COUNT; batchNumber += 1) {
    const suffix = String(batchNumber).padStart(2, "0");
    const name = `review-${suffix}.output.jsonl`;
    if (!entries.has(name)) throw new Error(`third-review ZIP is missing ${name}`);
    const inputRows = parseJsonl(
      readFileSync(path.resolve(inputBatchPath(batchNumber)), "utf8"),
      `third review input ${suffix}`,
    );
    const outputRows = parseJsonl(entries.get(name), `third review output ${suffix}`);
    if (!same(inputRows.map((row) => row.sampleId), outputRows.map((row) => row.sampleId))) {
      throw new Error(`${name}: output IDs/order do not match input`);
    }
    rows.push(...outputRows);
  }
  return { text: canonicalJsonl(rows), sha256: actualHash };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function writeOrCheck(files, check) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.resolve(relativePath);
    if (check) {
      if (readFileSync(absolutePath, "utf8") !== content) {
        throw new Error(`generated third-review artifact is stale: ${relativePath}`);
      }
      continue;
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
}

function main() {
  const check = process.argv.includes("--check");
  const zipPath = argumentValue("--zip");
  if (check && zipPath) throw new Error("--check cannot be combined with --zip");
  const source = zipPath
    ? rawTextFromZip(zipPath)
    : { text: readFileSync(path.resolve(RAW_PATH), "utf8"), sha256: EXPECTED_ZIP_SHA256 };
  const result = buildThirdReviewArtifacts({
    rawText: source.text,
    inputText: canonicalJsonl(readInputRows()),
    secondCandidateText: readFileSync(path.resolve(SECOND_CANDIDATE_PATH), "utf8"),
    sourceZipSha256: source.sha256,
  });
  writeOrCheck(result.files, check);
  console.log(`${check ? "verified" : "merged"} ${result.report.integrity.records} third-review rows`);
  console.log(`confirmed: ${result.confirmations.length}`);
  console.log(`remaining review queue: ${result.remainingQueue.length}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
