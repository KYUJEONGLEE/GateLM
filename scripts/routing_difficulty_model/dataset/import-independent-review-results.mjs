import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildArtifacts } from "./generate-independent-review-packets.mjs";

const DATASET_PATH = path.resolve(
  "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.jsonl",
);
const REVIEW_ROOT = path.resolve(
  "docs/routing/datasets/difficulty/reviews/independent-llm",
);
const RESULT_SCHEMA_VERSION =
  "gatelm.routing-difficulty-independent-review-result.v1";
const NORMALIZED_SCHEMA_VERSION =
  "gatelm.routing-difficulty-independent-review-normalized.v1";
const IMPORT_MANIFEST_SCHEMA_VERSION =
  "gatelm.routing-difficulty-independent-review-import-manifest.v1";
const REVIEW_EVIDENCE_DATE = "2026-07-21";
const EXPECTED_RESULT_KEYS = [
  "batch_id",
  "confidence",
  "difficulty",
  "item_id",
  "needs_human_adjudication",
  "reason_codes",
  "reviewer_id",
  "schema_version",
].sort();
const ALLOWED_DIFFICULTIES = new Set(["simple", "complex"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);
const ALLOWED_REASON_CODES = new Set([
  "single_bounded_task",
  "mechanical_transformation",
  "direct_retrieval_or_explanation",
  "limited_local_reasoning",
  "dependent_multistep_workflow",
  "multi_source_or_context_synthesis",
  "expert_analysis_or_tradeoff",
  "verification_or_falsification",
  "multi_tool_or_external_evidence",
  "state_concurrency_or_system_reasoning",
  "multiple_dependent_deliverables",
  "long_but_simple",
  "short_but_complex",
  "technical_terms_not_decisive",
  "language_not_decisive",
  "ambiguous_or_missing_context",
  "unsafe_or_unreadable_input",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function readJsonlText(text, label) {
  return text
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}:${index + 1}: ${error.message}`);
      }
    });
}

function readJsonl(filePath) {
  return readJsonlText(readFileSync(filePath, "utf8"), filePath);
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    reviewerId: null,
    resultsRoot: null,
    sourceZip: null,
    outputRoot: null,
    checkOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.checkOnly = true;
      continue;
    }
    const mappings = {
      "--reviewer": "reviewerId",
      "--results-root": "resultsRoot",
      "--source-zip": "sourceZip",
      "--output-root": "outputRoot",
    };
    const property = mappings[argument];
    if (!property) throw new Error(`unsupported argument: ${argument}`);
    const next = argv[index + 1];
    if (!next) throw new Error(`${argument} requires a value`);
    options[property] = property === "reviewerId" ? next.toUpperCase() : path.resolve(next);
    index += 1;
  }

  if (!options.reviewerId || !["A", "B"].includes(options.reviewerId)) {
    throw new Error("--reviewer must be A or B");
  }
  if (!options.outputRoot) {
    options.outputRoot = path.join(
      REVIEW_ROOT,
      options.reviewerId === "A" ? "reviewer-a-gemini" : "reviewer-b-gpt",
    );
  }
  if (!options.checkOnly && (!options.resultsRoot || !options.sourceZip)) {
    throw new Error("import requires --results-root and --source-zip");
  }
  return options;
}

function increment(counter, key) {
  counter[key] = (counter[key] ?? 0) + 1;
}

function matrixIncrement(matrix, rowKey, columnKey) {
  matrix[rowKey] ??= { simple: 0, complex: 0 };
  matrix[rowKey][columnKey] += 1;
}

export function rocAuc(scores, labels) {
  if (scores.length !== labels.length || scores.length === 0) {
    throw new Error("ROC-AUC requires non-empty scores and labels of equal length");
  }
  const points = scores
    .map((score, index) => ({ score, label: labels[index] }))
    .sort((left, right) => left.score - right.score);
  let positiveRanks = 0;
  let positives = 0;
  let cursor = 0;
  while (cursor < points.length) {
    let end = cursor + 1;
    while (end < points.length && points[end].score === points[cursor].score) end += 1;
    const averageRank = (cursor + 1 + end) / 2;
    for (let index = cursor; index < end; index += 1) {
      if (points[index].label === 1) {
        positives += 1;
        positiveRanks += averageRank;
      }
    }
    cursor = end;
  }
  const negatives = points.length - positives;
  if (positives === 0 || negatives === 0) return null;
  return (
    (positiveRanks - (positives * (positives + 1)) / 2) /
    (positives * negatives)
  );
}

export function validateReviewRow(row, { reviewerId, batchId, expectedItemId }) {
  const failures = [];
  const keys = Object.keys(row ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(EXPECTED_RESULT_KEYS)) {
    failures.push("fields do not match the result contract");
  }
  if (row?.schema_version !== RESULT_SCHEMA_VERSION) failures.push("schema_version");
  if (row?.reviewer_id !== reviewerId) failures.push("reviewer_id");
  if (row?.batch_id !== batchId) failures.push("batch_id");
  if (row?.item_id !== expectedItemId) failures.push("item_id or order");
  if (!ALLOWED_DIFFICULTIES.has(row?.difficulty)) failures.push("difficulty");
  if (!ALLOWED_CONFIDENCE.has(row?.confidence)) failures.push("confidence");
  if (typeof row?.needs_human_adjudication !== "boolean") {
    failures.push("needs_human_adjudication");
  }
  if (
    !Array.isArray(row?.reason_codes) ||
    row.reason_codes.length < 1 ||
    row.reason_codes.length > 4 ||
    new Set(row.reason_codes).size !== row.reason_codes.length ||
    row.reason_codes.some((reason) => !ALLOWED_REASON_CODES.has(reason))
  ) {
    failures.push("reason_codes");
  }
  return failures;
}

function sourceMetadataFromZip(sourceZip) {
  const bytes = statSync(sourceZip).size;
  const contents = readFileSync(sourceZip);
  return {
    file_name: path.basename(sourceZip),
    bytes,
    sha256: sha256(contents),
  };
}

function resultRowsFromDirectory({ resultsRoot, reviewerArtifact }) {
  const actualFiles = readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const expectedFiles = reviewerArtifact.manifest.batch_index
    .map((batch) => path.basename(batch.expected_output_file))
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `result file set mismatch: expected ${expectedFiles.length}, got ${actualFiles.length}`,
    );
  }

  const rowsByBatch = new Map();
  for (const batch of reviewerArtifact.manifest.batch_index) {
    const fileName = path.basename(batch.expected_output_file);
    rowsByBatch.set(batch.batch_id, readJsonl(path.join(resultsRoot, fileName)));
  }
  return rowsByBatch;
}

function resultRowsFromNormalized(normalizedRows) {
  const rowsByBatch = new Map();
  for (const row of normalizedRows) {
    const rows = rowsByBatch.get(row.batch_id) ?? [];
    rows.push({
      schema_version: RESULT_SCHEMA_VERSION,
      reviewer_id: row.reviewer_id,
      batch_id: row.batch_id,
      item_id: row.item_id,
      difficulty: row.difficulty,
      confidence: row.confidence,
      reason_codes: row.reason_codes,
      needs_human_adjudication: row.needs_human_adjudication,
    });
    rowsByBatch.set(row.batch_id, rows);
  }
  return rowsByBatch;
}

function normalizeAndValidate({ reviewerArtifact, rowsByBatch, itemToSample }) {
  const normalizedRows = [];
  const seenItemIds = new Set();
  const failures = [];

  for (const batch of reviewerArtifact.manifest.batch_index) {
    const inputRows = readJsonlText(
      reviewerArtifact.files.get(batch.input_file.replaceAll("/", path.sep)),
      batch.input_file,
    );
    const resultRows = rowsByBatch.get(batch.batch_id);
    if (!resultRows) {
      failures.push(`${batch.batch_id}: missing result batch`);
      continue;
    }
    if (resultRows.length !== inputRows.length) {
      failures.push(
        `${batch.batch_id}: expected ${inputRows.length} rows, got ${resultRows.length}`,
      );
      continue;
    }

    for (const [index, row] of resultRows.entries()) {
      const expectedItemId = inputRows[index].item_id;
      const rowFailures = validateReviewRow(row, {
        reviewerId: reviewerArtifact.reviewer.id,
        batchId: batch.batch_id,
        expectedItemId,
      });
      if (rowFailures.length > 0) {
        failures.push(
          `${batch.batch_id}:${index + 1}: ${rowFailures.join(", ")}`,
        );
        continue;
      }
      if (seenItemIds.has(row.item_id)) {
        failures.push(`${batch.batch_id}:${index + 1}: duplicate item_id`);
        continue;
      }
      seenItemIds.add(row.item_id);
      const sampleId = itemToSample.get(row.item_id);
      if (!sampleId) {
        failures.push(`${batch.batch_id}:${index + 1}: item_id is not in private map`);
        continue;
      }
      normalizedRows.push({
        schema_version: NORMALIZED_SCHEMA_VERSION,
        reviewer_id: row.reviewer_id,
        batch_id: row.batch_id,
        item_id: row.item_id,
        sample_id: sampleId,
        difficulty: row.difficulty,
        confidence: row.confidence,
        reason_codes: row.reason_codes,
        needs_human_adjudication: row.needs_human_adjudication,
      });
    }
  }

  for (const batchId of rowsByBatch.keys()) {
    if (!reviewerArtifact.manifest.batch_index.some((batch) => batch.batch_id === batchId)) {
      failures.push(`${batchId}: unexpected result batch`);
    }
  }
  if (normalizedRows.length !== reviewerArtifact.manifest.records) {
    failures.push(
      `expected ${reviewerArtifact.manifest.records} normalized rows, got ${normalizedRows.length}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`independent review import failed:\n${failures.slice(0, 100).join("\n")}`);
  }
  return normalizedRows;
}

function buildStatistics(normalizedRows, datasetById) {
  const labels = { simple: 0, complex: 0 };
  const confidence = { high: 0, medium: 0, low: 0 };
  const reasonCodes = {};
  const transitions = {
    simple_to_simple: 0,
    simple_to_complex: 0,
    complex_to_simple: 0,
    complex_to_complex: 0,
  };
  const byLanguage = {};
  const bySource = {};
  const byLengthBucket = {};
  let needsHumanAdjudication = 0;
  let priorityHumanQueue = 0;
  let candidateAgreement = 0;
  const promptLengths = [];
  const complexLabels = [];

  for (const row of normalizedRows) {
    const source = datasetById.get(row.sample_id);
    if (!source) throw new Error(`${row.sample_id}: normalized result is not in dataset`);
    increment(labels, row.difficulty);
    increment(confidence, row.confidence);
    for (const reason of row.reason_codes) increment(reasonCodes, reason);
    if (row.needs_human_adjudication) needsHumanAdjudication += 1;
    if (row.needs_human_adjudication || row.confidence === "low") {
      priorityHumanQueue += 1;
    }
    const transition = `${source.label}_to_${row.difficulty}`;
    increment(transitions, transition);
    if (source.label === row.difficulty) candidateAgreement += 1;
    matrixIncrement(byLanguage, source.language, row.difficulty);
    matrixIncrement(bySource, source.source, row.difficulty);
    matrixIncrement(byLengthBucket, source.length_bucket, row.difficulty);
    promptLengths.push(source.redacted_prompt.length);
    complexLabels.push(row.difficulty === "complex" ? 1 : 0);
  }

  return {
    labels,
    confidence,
    needs_human_adjudication: needsHumanAdjudication,
    priority_human_queue: priorityHumanQueue,
    candidate_comparison: {
      agreement: candidateAgreement,
      disagreement: normalizedRows.length - candidateAgreement,
      agreement_rate: candidateAgreement / normalizedRows.length,
      transitions,
    },
    length_only_roc_auc: rocAuc(promptLengths, complexLabels),
    by_language: byLanguage,
    by_source: bySource,
    by_length_bucket: byLengthBucket,
    reason_codes: Object.fromEntries(
      Object.entries(reasonCodes).sort((left, right) => right[1] - left[1]),
    ),
  };
}

function matrixTable(title, matrix) {
  const lines = [
    `## ${title}`,
    "",
    "| 구분 | Simple | Complex | 합계 | Complex 비율 |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [key, counts] of Object.entries(matrix)) {
    const total = counts.simple + counts.complex;
    lines.push(
      `| ${key} | ${counts.simple.toLocaleString("en-US")} | ${counts.complex.toLocaleString("en-US")} | ${total.toLocaleString("en-US")} | ${((counts.complex / total) * 100).toFixed(2)}% |`,
    );
  }
  return lines;
}

function buildReport({ reviewerArtifact, sourceZip, statistics }) {
  const total = reviewerArtifact.manifest.records;
  const agreement = statistics.candidate_comparison;
  const transitions = agreement.transitions;
  return `${[
    `# 독립 LLM 난이도 리뷰 결과 — 리뷰어 ${reviewerArtifact.reviewer.id} (${reviewerArtifact.reviewer.modelFamily})`,
    "",
    `- 증거일: ${REVIEW_EVIDENCE_DATE}`,
    `- 입력: 블라인드 ${total.toLocaleString("en-US")}건 / ${reviewerArtifact.manifest.batches} batch`,
    `- 원본 ZIP: \`${sourceZip.file_name}\``,
    `- 원본 ZIP SHA-256: \`${sourceZip.sha256}\``,
    "- 상태: 단일 독립 리뷰어 결과 검증 완료; 사람 승인 및 training eligibility 미완료",
    "",
    "## 계약 검증",
    "",
    `- ${total.toLocaleString("en-US")}개 item ID가 블라인드 입력과 순서까지 일치한다.`,
    `- ${reviewerArtifact.manifest.batches}개 batch의 누락·추가·중복이 없다.`,
    "- 결과에는 prompt, 기존 후보 라벨, 자유 서술 rationale이 없다.",
    "- 모든 label, confidence, reason code, adjudication flag가 허용 enum을 지킨다.",
    "",
    "## 판정 요약",
    "",
    "| 항목 | 개수 |",
    "|---|---:|",
    `| Simple | ${statistics.labels.simple.toLocaleString("en-US")} |`,
    `| Complex | ${statistics.labels.complex.toLocaleString("en-US")} |`,
    `| High confidence | ${statistics.confidence.high.toLocaleString("en-US")} |`,
    `| Medium confidence | ${statistics.confidence.medium.toLocaleString("en-US")} |`,
    `| Low confidence | ${statistics.confidence.low.toLocaleString("en-US")} |`,
    `| needs_human_adjudication | ${statistics.needs_human_adjudication.toLocaleString("en-US")} |`,
    `| 우선 사람 검수 queue | ${statistics.priority_human_queue.toLocaleString("en-US")} |`,
    "",
    "## 기존 후보 라벨과 사후 비교",
    "",
    `- 일치: ${agreement.agreement.toLocaleString("en-US")}건 (${(agreement.agreement_rate * 100).toFixed(2)}%)`,
    `- 불일치: ${agreement.disagreement.toLocaleString("en-US")}건`,
    `- Simple → Complex: ${transitions.simple_to_complex.toLocaleString("en-US")}건`,
    `- Complex → Simple: ${transitions.complex_to_simple.toLocaleString("en-US")}건`,
    `- 길이 단독 ROC-AUC: ${statistics.length_only_roc_auc.toFixed(4)}`,
    "",
    ...matrixTable("언어별 판정", statistics.by_language),
    "",
    ...matrixTable("출처 구성별 판정", statistics.by_source),
    "",
    ...matrixTable("길이 bucket별 판정", statistics.by_length_bucket),
    "",
    "## 해석과 다음 단계",
    "",
    "이 결과는 기존 후보 라벨을 보지 않은 독립 판정이지만 리뷰어가 한 명뿐이다. 따라서 현재 dataset의 `label`, `human_reviewed`, `review_status`, `training_eligible`은 변경하지 않는다.",
    "",
    "Gemini 리뷰어 A를 다시 확보하지 못하더라도 사람 adjudicator가 B 판정과 기존 후보를 독립적으로 검토할 수 있다. 최소한 low confidence 또는 `needs_human_adjudication`, B와 기존 후보 불일치, 경계 사례, Test 후보, slice별 무작위 표본은 사람 검수해야 한다.",
    "",
  ].join("\n")}`;
}

function writeOrCheck(filePath, contents, checkOnly) {
  if (checkOnly) {
    const actual = readFileSync(filePath, "utf8");
    if (actual !== contents) throw new Error(`stale review artifact: ${filePath}`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

export function buildImportArtifacts({
  datasetText,
  reviewerId,
  rowsByBatch,
  sourceZip,
}) {
  const packetArtifacts = buildArtifacts(datasetText);
  const reviewerArtifact = packetArtifacts.reviewerArtifacts.find(
    ({ reviewer }) => reviewer.id === reviewerId,
  );
  if (!reviewerArtifact) throw new Error(`missing generated packet for reviewer ${reviewerId}`);

  const mappingRows = readJsonlText(
    packetArtifacts.privateFiles.get("review-item-map.jsonl"),
    "private review item map",
  );
  const itemToSample = new Map(mappingRows.map((row) => [row.item_id, row.sample_id]));
  const normalizedRows = normalizeAndValidate({
    reviewerArtifact,
    rowsByBatch,
    itemToSample,
  });
  const datasetRows = readJsonlText(datasetText, DATASET_PATH);
  const datasetById = new Map(datasetRows.map((row) => [row.sample_id, row]));
  const statistics = buildStatistics(normalizedRows, datasetById);
  const normalizedText = jsonl(normalizedRows);
  const report = buildReport({ reviewerArtifact, sourceZip, statistics });
  const manifest = {
    schema_version: IMPORT_MANIFEST_SCHEMA_VERSION,
    status: "validated_single_independent_reviewer_human_adjudication_pending",
    evidence_date: REVIEW_EVIDENCE_DATE,
    reviewer: {
      id: reviewerArtifact.reviewer.id,
      intended_model_family: reviewerArtifact.reviewer.modelFamily,
    },
    source_zip: sourceZip,
    packet: {
      protocol_version: reviewerArtifact.manifest.protocol_version,
      records: reviewerArtifact.manifest.records,
      batches: reviewerArtifact.manifest.batches,
      dataset_sha256: reviewerArtifact.manifest.dataset_sha256,
      sample_set_sha256: reviewerArtifact.manifest.sample_set_sha256,
      reviewer_order_sha256: reviewerArtifact.manifest.reviewer_order_sha256,
      candidate_labels_included: false,
    },
    validation: {
      file_set_complete: true,
      record_set_complete: true,
      input_order_preserved: true,
      unique_item_ids: true,
      result_schema_valid: true,
      prompt_or_rationale_in_results: false,
    },
    counts: {
      records: normalizedRows.length,
      ...statistics,
    },
    artifacts: {
      normalized_file: `reviewer-${reviewerId.toLowerCase()}-results.normalized.jsonl`,
      normalized_sha256: sha256(normalizedText),
      report_file: `reviewer-${reviewerId.toLowerCase()}-report.md`,
      report_sha256: sha256(report),
    },
    gates: {
      second_independent_reviewer_completed: false,
      human_adjudication_completed: false,
      dataset_labels_updated: false,
      training_eligible: false,
    },
    blockers: [
      "second_independent_reviewer_not_completed",
      "human_adjudication_not_completed",
      "dataset_owner_approval_not_completed",
    ],
  };

  return {
    normalizedRows,
    normalizedText,
    report,
    manifest,
    reviewerArtifact,
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const datasetText = readFileSync(DATASET_PATH, "utf8");
  let rowsByBatch;
  let sourceZip;

  if (options.checkOnly) {
    const manifestPath = path.join(
      options.outputRoot,
      `reviewer-${options.reviewerId.toLowerCase()}-import-manifest.json`,
    );
    const existingManifest = readJson(manifestPath);
    sourceZip = existingManifest.source_zip;
    const normalizedRows = readJsonl(
      path.join(
        options.outputRoot,
        `reviewer-${options.reviewerId.toLowerCase()}-results.normalized.jsonl`,
      ),
    );
    rowsByBatch = resultRowsFromNormalized(normalizedRows);
  } else {
    sourceZip = sourceMetadataFromZip(options.sourceZip);
    const packetArtifacts = buildArtifacts(datasetText);
    const reviewerArtifact = packetArtifacts.reviewerArtifacts.find(
      ({ reviewer }) => reviewer.id === options.reviewerId,
    );
    rowsByBatch = resultRowsFromDirectory({
      resultsRoot: options.resultsRoot,
      reviewerArtifact,
    });
  }

  const built = buildImportArtifacts({
    datasetText,
    reviewerId: options.reviewerId,
    rowsByBatch,
    sourceZip,
  });
  const prefix = `reviewer-${options.reviewerId.toLowerCase()}`;
  writeOrCheck(
    path.join(options.outputRoot, `${prefix}-results.normalized.jsonl`),
    built.normalizedText,
    options.checkOnly,
  );
  writeOrCheck(
    path.join(options.outputRoot, `${prefix}-report.md`),
    built.report,
    options.checkOnly,
  );
  writeOrCheck(
    path.join(options.outputRoot, `${prefix}-import-manifest.json`),
    `${JSON.stringify(built.manifest, null, 2)}\n`,
    options.checkOnly,
  );

  console.log(
    `${options.checkOnly ? "verified" : "imported"} reviewer ${options.reviewerId}: ${built.normalizedRows.length} results, ${built.manifest.counts.candidate_comparison.disagreement} candidate disagreements, training eligibility remains false`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
