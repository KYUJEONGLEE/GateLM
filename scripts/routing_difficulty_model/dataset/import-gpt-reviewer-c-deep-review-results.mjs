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
import {
  buildOutputSchema,
  buildReviewerCPacket,
} from "./generate-gpt-reviewer-c-deep-review-packet.mjs";
import { rocAuc } from "./import-independent-review-results.mjs";

const DATASET_PATH = path.resolve(
  "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.jsonl",
);
const REVIEWER_B_RESULTS_PATH = path.resolve(
  "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-b-gpt/reviewer-b-results.normalized.jsonl",
);
const REVIEWER_B_MANIFEST_PATH = path.resolve(
  "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-b-gpt/reviewer-b-import-manifest.json",
);
const DEFAULT_OUTPUT_ROOT = path.resolve(
  "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-c-gpt",
);
const INITIAL_RECEIVED_ROOT = path.resolve(
  ".tmp/routing-difficulty-independent-review/imports/reviewer-c/partial-2026-07-21/source-as-received",
);
const EVIDENCE_DATE = "2026-07-21";
const EXPECTED_RECORDS = 3_650;
const EXPECTED_BATCHES = 73;
const RESULT_SCHEMA_VERSION =
  "gatelm.routing-difficulty-axis-review-result.v1";
const NORMALIZED_SCHEMA_VERSION =
  "gatelm.routing-difficulty-axis-review-normalized.v1";
const COMPARISON_SCHEMA_VERSION =
  "gatelm.routing-difficulty-reviewer-b-c-comparison.v1";
const HUMAN_QUEUE_SCHEMA_VERSION =
  "gatelm.routing-difficulty-reviewer-b-c-human-queue.v1";
const IMPORT_MANIFEST_SCHEMA_VERSION =
  "gatelm.routing-difficulty-reviewer-c-import-manifest.v1";

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
  return rows.length === 0
    ? ""
    : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    resultsRoot: null,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    checkOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.checkOnly = true;
      continue;
    }
    if (["--results-root", "--output-root"].includes(argument)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${argument} requires a path`);
      if (argument === "--results-root") options.resultsRoot = path.resolve(next);
      else options.outputRoot = path.resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  if (!options.checkOnly && !options.resultsRoot) {
    throw new Error("import requires --results-root");
  }
  return options;
}

function increment(counter, key) {
  counter[key] = (counter[key] ?? 0) + 1;
}

function matrixIncrement(matrix, key, difficulty) {
  matrix[key] ??= { simple: 0, complex: 0 };
  matrix[key][difficulty] += 1;
}

export function validateAxisReviewRow(row, { batchId, itemId, schema }) {
  const failures = [];
  const expectedKeys = [...schema.required].sort();
  if (JSON.stringify(Object.keys(row ?? {}).sort()) !== JSON.stringify(expectedKeys)) {
    failures.push("fields");
  }
  if (row?.schema_version !== RESULT_SCHEMA_VERSION) failures.push("schema_version");
  if (row?.reviewer_id !== "C") failures.push("reviewer_id");
  if (row?.batch_id !== batchId) failures.push("batch_id");
  if (row?.item_id !== itemId) failures.push("item_id_or_order");
  if (!schema.properties.difficulty.enum.includes(row?.difficulty)) {
    failures.push("difficulty");
  }
  if (!schema.properties.confidence.enum.includes(row?.confidence)) {
    failures.push("confidence");
  }
  if (typeof row?.needs_human_adjudication !== "boolean") {
    failures.push("needs_human_adjudication");
  }
  const reasons = row?.reason_codes;
  if (
    !Array.isArray(reasons) ||
    reasons.length < 1 ||
    reasons.length > 4 ||
    new Set(reasons).size !== reasons.length ||
    reasons.some(
      (reason) => !schema.properties.reason_codes.items.enum.includes(reason),
    )
  ) {
    failures.push("reason_codes");
  }
  const axisSchema = schema.properties.axis_decisions;
  const expectedAxes = [...axisSchema.required].sort();
  if (
    !row?.axis_decisions ||
    JSON.stringify(Object.keys(row.axis_decisions).sort()) !==
      JSON.stringify(expectedAxes)
  ) {
    failures.push("axis_fields");
  } else {
    for (const axis of expectedAxes) {
      if (!axisSchema.properties[axis].enum.includes(row.axis_decisions[axis])) {
        failures.push(`axis_${axis}`);
      }
    }
  }
  return failures;
}

export function classifyComparison(reviewerB, reviewerC) {
  const reasons = [];
  if (reviewerB.difficulty !== reviewerC.difficulty) {
    reasons.push("reviewer_b_c_label_disagreement");
  }
  if (reviewerB.confidence !== "high") {
    reasons.push(`reviewer_b_confidence_${reviewerB.confidence}`);
  }
  if (reviewerC.confidence !== "high") {
    reasons.push(`reviewer_c_confidence_${reviewerC.confidence}`);
  }
  if (reviewerB.needs_human_adjudication) {
    reasons.push("reviewer_b_requested_human_adjudication");
  }
  if (reviewerC.needs_human_adjudication) {
    reasons.push("reviewer_c_requested_human_adjudication");
  }
  const llmConsensusCandidate =
    reviewerB.difficulty === reviewerC.difficulty &&
    reviewerB.confidence === "high" &&
    reviewerC.confidence === "high" &&
    !reviewerB.needs_human_adjudication &&
    !reviewerC.needs_human_adjudication;
  return {
    llmConsensusCandidate,
    humanAdjudicationRequired: !llmConsensusCandidate,
    reasons,
    status: llmConsensusCandidate
      ? "same_family_high_confidence_consensus_candidate"
      : reviewerB.difficulty !== reviewerC.difficulty
        ? "reviewer_b_c_disagreement_requires_human"
        : "insufficient_confidence_or_human_request_requires_human",
  };
}

function rowsFromDirectory(resultsRoot, packet) {
  const actualFiles = readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const expectedFiles = packet.packageManifest.batch_index
    .map((batch) => path.basename(batch.expected_output_file))
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Reviewer C result file set mismatch: expected ${expectedFiles.length}, got ${actualFiles.length}`,
    );
  }
  const rowsByBatch = new Map();
  const fileIndex = [];
  for (const batch of packet.packageManifest.batch_index) {
    const fileName = path.basename(batch.expected_output_file);
    const filePath = path.join(resultsRoot, fileName);
    const contents = readFileSync(filePath, "utf8");
    const rows = readJsonlText(contents, filePath);
    rowsByBatch.set(batch.batch_id, rows);
    fileIndex.push({
      file: fileName,
      records: rows.length,
      bytes: statSync(filePath).size,
      sha256: sha256(contents),
    });
  }
  return {
    rowsByBatch,
    fileIndex,
    aggregateSha256: sha256(`${JSON.stringify(fileIndex)}\n`),
  };
}

function rowsFromNormalized(normalizedRows) {
  const rowsByBatch = new Map();
  for (const row of normalizedRows) {
    const rows = rowsByBatch.get(row.batch_id) ?? [];
    rows.push({
      schema_version: RESULT_SCHEMA_VERSION,
      reviewer_id: row.reviewer_id,
      batch_id: row.batch_id,
      item_id: row.item_id,
      axis_decisions: row.axis_decisions,
      difficulty: row.difficulty,
      confidence: row.confidence,
      reason_codes: row.reason_codes,
      needs_human_adjudication: row.needs_human_adjudication,
    });
    rowsByBatch.set(row.batch_id, rows);
  }
  return rowsByBatch;
}

function normalizeRows({ packet, rowsByBatch, itemToSample }) {
  const schema = buildOutputSchema();
  const normalized = [];
  const seen = new Set();
  const failures = [];
  for (const batch of packet.packageManifest.batch_index) {
    const inputRows = readJsonlText(
      packet.files.get(batch.input_file.replaceAll("/", path.sep)),
      batch.input_file,
    );
    const outputRows = rowsByBatch.get(batch.batch_id);
    if (!outputRows) {
      failures.push(`${batch.batch_id}: missing output`);
      continue;
    }
    if (outputRows.length !== inputRows.length) {
      failures.push(
        `${batch.batch_id}: expected ${inputRows.length} rows, got ${outputRows.length}`,
      );
      continue;
    }
    for (const [index, row] of outputRows.entries()) {
      const rowFailures = validateAxisReviewRow(row, {
        batchId: batch.batch_id,
        itemId: inputRows[index].item_id,
        schema,
      });
      if (rowFailures.length > 0) {
        failures.push(
          `${batch.batch_id}:${index + 1}: ${rowFailures.join(", ")}`,
        );
        continue;
      }
      if (seen.has(row.item_id)) {
        failures.push(`${batch.batch_id}:${index + 1}: duplicate item_id`);
        continue;
      }
      seen.add(row.item_id);
      const sampleId = itemToSample.get(row.item_id);
      if (!sampleId) {
        failures.push(`${batch.batch_id}:${index + 1}: unknown item_id`);
        continue;
      }
      normalized.push({
        schema_version: NORMALIZED_SCHEMA_VERSION,
        reviewer_id: "C",
        batch_id: row.batch_id,
        item_id: row.item_id,
        sample_id: sampleId,
        axis_decisions: row.axis_decisions,
        difficulty: row.difficulty,
        confidence: row.confidence,
        reason_codes: row.reason_codes,
        needs_human_adjudication: row.needs_human_adjudication,
      });
    }
  }
  if (normalized.length !== EXPECTED_RECORDS) {
    failures.push(
      `expected ${EXPECTED_RECORDS} normalized rows, got ${normalized.length}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Reviewer C import failed:\n${failures.slice(0, 100).join("\n")}`);
  }
  return normalized;
}

function initialSubmissionProvenance() {
  const entries = readdirSync(INITIAL_RECEIVED_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(INITIAL_RECEIVED_ROOT, entry.name);
      const contents = readFileSync(filePath);
      return {
        file: entry.name,
        bytes: statSync(filePath).size,
        sha256: sha256(contents),
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file, "en"));
  return {
    files_received: entries.length,
    aggregate_sha256: sha256(`${JSON.stringify(entries)}\n`),
    diagnosed_pattern:
      "C-0002 duplicated C-0001; source files C-0003 through C-0073 contained batches C-0002 through C-0072; C-0073 was missing",
    unique_batches_recovered: 72,
    unique_records_recovered: 3_600,
  };
}

function comparisonRows({ normalized, reviewerBByItem, datasetById }) {
  return normalized.map((reviewerC) => {
    const reviewerB = reviewerBByItem.get(reviewerC.item_id);
    const dataset = datasetById.get(reviewerC.sample_id);
    if (!reviewerB || !dataset) {
      throw new Error(`${reviewerC.item_id}: missing Reviewer B or dataset record`);
    }
    const classification = classifyComparison(reviewerB, reviewerC);
    return {
      schema_version: COMPARISON_SCHEMA_VERSION,
      item_id: reviewerC.item_id,
      sample_id: reviewerC.sample_id,
      candidate_label: dataset.label,
      reviewer_b: {
        difficulty: reviewerB.difficulty,
        confidence: reviewerB.confidence,
        needs_human_adjudication: reviewerB.needs_human_adjudication,
      },
      reviewer_c: {
        difficulty: reviewerC.difficulty,
        confidence: reviewerC.confidence,
        needs_human_adjudication: reviewerC.needs_human_adjudication,
      },
      status: classification.status,
      llm_consensus_candidate: classification.llmConsensusCandidate,
      human_adjudication_required: classification.humanAdjudicationRequired,
      queue_reasons: classification.reasons,
    };
  });
}

function buildStatistics({ normalized, comparisons, datasetById }) {
  const labels = { simple: 0, complex: 0 };
  const confidence = { high: 0, medium: 0, low: 0 };
  const axisDecisions = {};
  const byLanguage = {};
  const bySource = {};
  const byLength = {};
  const patterns = {
    all_three_agree: 0,
    reviewer_b_c_agree_candidate_differs: 0,
    reviewer_b_c_disagree_candidate_matches_b: 0,
    reviewer_b_c_disagree_candidate_matches_c: 0,
  };
  let needsHuman = 0;
  let bcAgreement = 0;
  let bcDisagreement = 0;
  let consensusCandidates = 0;
  let humanQueue = 0;
  const lengths = [];
  const complexLabels = [];

  for (const row of normalized) {
    const dataset = datasetById.get(row.sample_id);
    increment(labels, row.difficulty);
    increment(confidence, row.confidence);
    if (row.needs_human_adjudication) needsHuman += 1;
    for (const [axis, decision] of Object.entries(row.axis_decisions)) {
      axisDecisions[axis] ??= {};
      increment(axisDecisions[axis], decision);
    }
    matrixIncrement(byLanguage, dataset.language, row.difficulty);
    matrixIncrement(bySource, dataset.source, row.difficulty);
    matrixIncrement(byLength, dataset.length_bucket, row.difficulty);
    lengths.push(dataset.redacted_prompt.length);
    complexLabels.push(row.difficulty === "complex" ? 1 : 0);
  }

  for (const row of comparisons) {
    const bEqualsC = row.reviewer_b.difficulty === row.reviewer_c.difficulty;
    if (bEqualsC) bcAgreement += 1;
    else bcDisagreement += 1;
    if (row.llm_consensus_candidate) consensusCandidates += 1;
    if (row.human_adjudication_required) humanQueue += 1;
    if (bEqualsC && row.candidate_label === row.reviewer_b.difficulty) {
      patterns.all_three_agree += 1;
    } else if (bEqualsC) {
      patterns.reviewer_b_c_agree_candidate_differs += 1;
    } else if (row.candidate_label === row.reviewer_b.difficulty) {
      patterns.reviewer_b_c_disagree_candidate_matches_b += 1;
    } else {
      patterns.reviewer_b_c_disagree_candidate_matches_c += 1;
    }
  }
  return {
    reviewer_c: {
      labels,
      confidence,
      needs_human_adjudication: needsHuman,
      length_only_roc_auc_on_targeted_subset: rocAuc(lengths, complexLabels),
      by_language: byLanguage,
      by_source: bySource,
      by_length_bucket: byLength,
      axis_decisions: axisDecisions,
    },
    comparison: {
      reviewer_b_c_agreement: bcAgreement,
      reviewer_b_c_disagreement: bcDisagreement,
      reviewer_b_c_agreement_rate: bcAgreement / comparisons.length,
      same_family_high_confidence_consensus_candidates: consensusCandidates,
      human_adjudication_queue: humanQueue,
      candidate_patterns: patterns,
    },
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

function buildReport(statistics) {
  const c = statistics.reviewer_c;
  const comparison = statistics.comparison;
  const patterns = comparison.candidate_patterns;
  return `${[
    "# Reviewer C 구조화 정밀 검토 및 B/C 비교",
    "",
    `- 증거일: ${EVIDENCE_DATE}`,
    `- 검증된 Reviewer C 결과: ${EXPECTED_RECORDS.toLocaleString("en-US")}건 / ${EXPECTED_BATCHES} batch`,
    "- Reviewer C 역할: 같은 GPT 계열의 blind second pass; 독립 리뷰어 수에는 포함하지 않음",
    "- dataset label, human_reviewed, review_status, training_eligible 변경: 없음",
    "",
    "## 수신 복구",
    "",
    "첫 제출은 C-0002가 C-0001의 복제본이고 이후 파일 내용이 한 batch씩 밀려 실제 C-0073이 없었다. 내부 batch_id와 item_id로 C-0001~C-0072 3,600건을 복구하고 별도 재요청한 C-0073 50건을 결합했다.",
    "",
    "## Reviewer C 판정",
    "",
    "| 항목 | 개수 |",
    "|---|---:|",
    `| Simple | ${c.labels.simple.toLocaleString("en-US")} |`,
    `| Complex | ${c.labels.complex.toLocaleString("en-US")} |`,
    `| High confidence | ${c.confidence.high.toLocaleString("en-US")} |`,
    `| Medium confidence | ${c.confidence.medium.toLocaleString("en-US")} |`,
    `| Low confidence | ${c.confidence.low.toLocaleString("en-US")} |`,
    `| needs_human_adjudication | ${c.needs_human_adjudication.toLocaleString("en-US")} |`,
    `| 대상 subset 길이 단독 ROC-AUC | ${c.length_only_roc_auc_on_targeted_subset.toFixed(4)} |`,
    "",
    "이 ROC-AUC는 B와 후보가 다르거나 B가 불확실했던 3,650건 subset에 한정되므로 전체 15,000개 길이 편향 수치로 해석하지 않는다.",
    "",
    "## Reviewer B/C 비교",
    "",
    "| 항목 | 개수 |",
    "|---|---:|",
    `| B/C 라벨 일치 | ${comparison.reviewer_b_c_agreement.toLocaleString("en-US")} |`,
    `| B/C 라벨 불일치 | ${comparison.reviewer_b_c_disagreement.toLocaleString("en-US")} |`,
    `| B/C 일치율 | ${(comparison.reviewer_b_c_agreement_rate * 100).toFixed(2)}% |`,
    `| 같은 계열 고신뢰 합의 후보 | ${comparison.same_family_high_confidence_consensus_candidates.toLocaleString("en-US")} |`,
    `| 사람 adjudication queue | ${comparison.human_adjudication_queue.toLocaleString("en-US")} |`,
    "",
    "## 기존 후보까지 포함한 패턴",
    "",
    "| 패턴 | 개수 |",
    "|---|---:|",
    `| 후보=B=C | ${patterns.all_three_agree.toLocaleString("en-US")} |`,
    `| B=C, 후보만 다름 | ${patterns.reviewer_b_c_agree_candidate_differs.toLocaleString("en-US")} |`,
    `| B/C 불일치, 후보=B | ${patterns.reviewer_b_c_disagree_candidate_matches_b.toLocaleString("en-US")} |`,
    `| B/C 불일치, 후보=C | ${patterns.reviewer_b_c_disagree_candidate_matches_c.toLocaleString("en-US")} |`,
    "",
    ...matrixTable("Reviewer C 언어별 판정", c.by_language),
    "",
    ...matrixTable("Reviewer C 출처별 판정", c.by_source),
    "",
    ...matrixTable("Reviewer C 길이 bucket별 판정", c.by_length_bucket),
    "",
    "## Gate 상태",
    "",
    "B/C가 일치하고 양쪽 모두 high confidence이며 어느 쪽도 사람 판정을 요청하지 않은 항목만 같은 계열 LLM 합의 후보로 둔다. 그 외 항목은 사람 adjudication queue에 남긴다.",
    "",
    "Reviewer C는 Reviewer B와 같은 GPT 계열이므로 B/C 일치를 독립 모델 합의로 계산하지 않는다. Gemini A 또는 사람 adjudication과 dataset owner 승인이 끝나기 전에는 training eligible이 아니다.",
    "",
  ].join("\n")}`;
}

function writeOrCheck(filePath, contents, checkOnly) {
  if (checkOnly) {
    const actual = readFileSync(filePath, "utf8");
    if (actual !== contents) throw new Error(`stale Reviewer C artifact: ${filePath}`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

export function buildImportArtifacts({
  datasetText,
  reviewerBText,
  reviewerBManifest,
  rowsByBatch,
  sourceIntake,
}) {
  const packet = buildReviewerCPacket({
    datasetText,
    reviewerBText,
    reviewerBManifest,
  });
  const baseArtifacts = buildArtifacts(datasetText);
  const itemMapRows = readJsonlText(
    baseArtifacts.privateFiles.get("review-item-map.jsonl"),
    "review item map",
  );
  const itemToSample = new Map(
    itemMapRows.map((row) => [row.item_id, row.sample_id]),
  );
  const normalized = normalizeRows({ packet, rowsByBatch, itemToSample });
  const datasetRows = readJsonlText(datasetText, DATASET_PATH);
  const datasetById = new Map(datasetRows.map((row) => [row.sample_id, row]));
  const reviewerBRows = readJsonlText(reviewerBText, REVIEWER_B_RESULTS_PATH);
  const reviewerBByItem = new Map(
    reviewerBRows.map((row) => [row.item_id, row]),
  );
  const comparisons = comparisonRows({
    normalized,
    reviewerBByItem,
    datasetById,
  });
  const humanQueue = comparisons
    .filter((row) => row.human_adjudication_required)
    .map((row) => ({
      schema_version: HUMAN_QUEUE_SCHEMA_VERSION,
      ...Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== "schema_version"),
      ),
    }));
  const statistics = buildStatistics({
    normalized,
    comparisons,
    datasetById,
  });
  const normalizedText = jsonl(normalized);
  const comparisonText = jsonl(comparisons);
  const humanQueueText = jsonl(humanQueue);
  const report = buildReport(statistics);
  const manifest = {
    schema_version: IMPORT_MANIFEST_SCHEMA_VERSION,
    status:
      "validated_same_model_family_second_pass_human_adjudication_pending",
    evidence_date: EVIDENCE_DATE,
    reviewer: {
      id: "C",
      intended_model_family: "GPT",
      role: "same_model_family_blind_second_pass",
      independent_reviewer_credit: false,
    },
    packet: {
      records: packet.packageManifest.records,
      batches: packet.packageManifest.batches,
      dataset_sha256: packet.packageManifest.dataset_sha256,
      review_set_sha256: packet.packageManifest.review_set_sha256,
      reviewer_order_sha256: packet.packageManifest.reviewer_order_sha256,
      required_axis_count: packet.packageManifest.required_axis_count,
      candidate_labels_included: false,
      prior_reviewer_results_included: false,
    },
    source_intake: sourceIntake,
    validation: {
      file_set_complete: true,
      record_set_complete: true,
      input_order_preserved: true,
      unique_item_ids: true,
      seven_axis_schema_valid: true,
      prompt_or_rationale_in_results: false,
    },
    counts: {
      records: normalized.length,
      ...statistics,
    },
    artifacts: {
      normalized_file: "reviewer-c-results.normalized.jsonl",
      normalized_sha256: sha256(normalizedText),
      comparison_file: "reviewer-b-c-comparison.jsonl",
      comparison_sha256: sha256(comparisonText),
      human_queue_file: "reviewer-b-c-human-adjudication-queue.jsonl",
      human_queue_sha256: sha256(humanQueueText),
      report_file: "reviewer-c-report.md",
      report_sha256: sha256(report),
    },
    gates: {
      independent_reviewer_a_completed: false,
      human_adjudication_completed: false,
      dataset_labels_updated: false,
      training_eligible: false,
    },
    blockers: [
      "independent_reviewer_a_not_completed",
      "human_adjudication_not_completed",
      "dataset_owner_approval_not_completed",
    ],
  };
  return {
    normalized,
    normalizedText,
    comparisons,
    comparisonText,
    humanQueue,
    humanQueueText,
    statistics,
    report,
    manifest,
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const datasetText = readFileSync(DATASET_PATH, "utf8");
  const reviewerBText = readFileSync(REVIEWER_B_RESULTS_PATH, "utf8");
  const reviewerBManifest = readJson(REVIEWER_B_MANIFEST_PATH);
  let rowsByBatch;
  let sourceIntake;

  if (options.checkOnly) {
    const existingManifest = readJson(
      path.join(options.outputRoot, "reviewer-c-import-manifest.json"),
    );
    const normalized = readJsonl(
      path.join(options.outputRoot, "reviewer-c-results.normalized.jsonl"),
    );
    rowsByBatch = rowsFromNormalized(normalized);
    sourceIntake = existingManifest.source_intake;
  } else {
    const source = rowsFromDirectory(options.resultsRoot, buildReviewerCPacket({
      datasetText,
      reviewerBText,
      reviewerBManifest,
    }));
    rowsByBatch = source.rowsByBatch;
    sourceIntake = {
      initial_submission: initialSubmissionProvenance(),
      retry_batch: {
        batch_id: "C-0073",
        file_name: "C-0073.output.jsonl",
        records: source.rowsByBatch.get("C-0073").length,
        sha256: source.fileIndex.find((file) => file.file === "C-0073.output.jsonl")
          .sha256,
      },
      canonical_results: {
        files: source.fileIndex.length,
        records: source.fileIndex.reduce((total, file) => total + file.records, 0),
        aggregate_sha256: source.aggregateSha256,
        file_index: source.fileIndex,
      },
    };
  }

  const built = buildImportArtifacts({
    datasetText,
    reviewerBText,
    reviewerBManifest,
    rowsByBatch,
    sourceIntake,
  });
  const outputs = new Map([
    ["reviewer-c-results.normalized.jsonl", built.normalizedText],
    ["reviewer-b-c-comparison.jsonl", built.comparisonText],
    ["reviewer-b-c-human-adjudication-queue.jsonl", built.humanQueueText],
    ["reviewer-c-report.md", built.report],
    [
      "reviewer-c-import-manifest.json",
      `${JSON.stringify(built.manifest, null, 2)}\n`,
    ],
  ]);
  for (const [fileName, contents] of outputs) {
    writeOrCheck(
      path.join(options.outputRoot, fileName),
      contents,
      options.checkOnly,
    );
  }
  console.log(
    `${options.checkOnly ? "verified" : "imported"} Reviewer C: ${built.normalized.length} results, ${built.statistics.comparison.reviewer_b_c_disagreement} B/C disagreements, ${built.humanQueue.length} human queue, training eligibility remains false`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

