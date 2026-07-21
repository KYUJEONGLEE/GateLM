import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lengthOnlyRocAuc } from "./dataset-bias.mjs";
import { buildOutputSchema, buildPacket } from "./generate-gpt-risk-sensitive-slice-review-packet.mjs";

const DATASET_PATH = path.resolve("docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.jsonl");
const DEFAULT_OUTPUT_ROOT = path.resolve("docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-e-gpt");
const EXPECTED_RECORDS = 7_974;
const EXPECTED_BATCHES = 162;
const NORMALIZED_SCHEMA_VERSION = "gatelm.routing-difficulty-risk-sensitive-review-normalized.v1";
const COMPARISON_SCHEMA_VERSION = "gatelm.routing-difficulty-reviewer-e-comparison.v1";
const MANIFEST_SCHEMA_VERSION = "gatelm.routing-difficulty-reviewer-e-import-manifest.v1";
const EVIDENCE_DATE = "2026-07-22";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonl(text, name) {
  return text.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${name}:${index + 1}: ${error.message}`);
    }
  });
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function parseArguments(argv) {
  const options = { resultsRoot: null, sourceZip: null, outputRoot: DEFAULT_OUTPUT_ROOT, checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.checkOnly = true;
      continue;
    }
    if (["--results-root", "--source-zip", "--output-root"].includes(argument)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${argument} requires a path`);
      if (argument === "--results-root") options.resultsRoot = path.resolve(next);
      if (argument === "--source-zip") options.sourceZip = path.resolve(next);
      if (argument === "--output-root") options.outputRoot = path.resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  if (!options.checkOnly && (!options.resultsRoot || !options.sourceZip)) {
    throw new Error("import requires --results-root and --source-zip");
  }
  return options;
}

function countBy(rows, selector) {
  const result = {};
  for (const row of rows) {
    const key = typeof selector === "function" ? selector(row) : row[selector];
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function nestedCounts(rows, outer, inner) {
  const result = {};
  for (const row of rows) {
    result[row[outer]] ??= {};
    result[row[outer]][row[inner]] = (result[row[outer]][row[inner]] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function violatingSlices(rows, field, minimum = 0.35, maximum = 0.65) {
  return Object.entries(nestedCounts(rows, field, "label")).filter(([, labels]) => {
    const total = (labels.simple ?? 0) + (labels.complex ?? 0);
    const share = (labels.complex ?? 0) / total;
    return share < minimum || share > maximum;
  }).map(([name, labels]) => ({
    name,
    simple: labels.simple ?? 0,
    complex: labels.complex ?? 0,
    complex_share: (labels.complex ?? 0) / ((labels.simple ?? 0) + (labels.complex ?? 0)),
  })).sort((left, right) => left.complex_share - right.complex_share);
}

export function validateResultRow(row, { batchId, itemId, schema = buildOutputSchema() }) {
  const failures = [];
  const expectedKeys = [...schema.required].sort();
  if (!row || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expectedKeys)) failures.push("fields");
  if (row?.schema_version !== schema.properties.schema_version.const) failures.push("schema_version");
  if (row?.reviewer_id !== "E") failures.push("reviewer_id");
  if (row?.batch_id !== batchId) failures.push("batch_id");
  if (row?.item_id !== itemId) failures.push("item_id");
  for (const field of ["difficulty", "confidence", "false_simple_risk", "decision_basis"]) {
    if (!schema.properties[field].enum.includes(row?.[field])) failures.push(field);
  }
  if (typeof row?.needs_human_adjudication !== "boolean") failures.push("needs_human_adjudication");
  const axisSchema = schema.properties.axis_decisions;
  if (!row?.axis_decisions || JSON.stringify(Object.keys(row.axis_decisions).sort()) !== JSON.stringify([...axisSchema.required].sort())) failures.push("axis_fields");
  else for (const field of axisSchema.required) {
    if (!axisSchema.properties[field].enum.includes(row.axis_decisions[field])) failures.push(`axis_${field}`);
  }
  const reasonSchema = schema.properties.reason_codes;
  if (!Array.isArray(row?.reason_codes)
      || row.reason_codes.length < reasonSchema.minItems
      || row.reason_codes.length > reasonSchema.maxItems
      || new Set(row.reason_codes).size !== row.reason_codes.length
      || row.reason_codes.some((code) => !reasonSchema.items.enum.includes(code))) failures.push("reason_codes");
  if (row?.difficulty === "simple" && (row.confidence !== "high" || row.false_simple_risk !== "low"
      || row.decision_basis !== "clearly_bounded_simple" || row.needs_human_adjudication !== false)) failures.push("simple_contract");
  if (["medium", "low"].includes(row?.confidence) && row.difficulty !== "complex") failures.push("uncertain_defaults_complex");
  if (row?.needs_human_adjudication === true && row.difficulty !== "complex") failures.push("human_request_defaults_complex");
  return [...new Set(failures)];
}

function packetInputRows(packet) {
  const rows = [];
  for (const batch of packet.manifest.batch_index) {
    const key = batch.input_file.replaceAll("/", path.sep);
    rows.push(...parseJsonl(packet.files.get(key), batch.input_file));
  }
  return rows;
}

function readReceivedResults(resultsRoot, packet) {
  const expectedFiles = packet.manifest.batch_index.map((batch) => path.basename(batch.expected_output_file));
  const outputRoot = path.join(resultsRoot, "outputs");
  const actualFiles = readdirSync(outputRoot).filter((name) => name.endsWith(".jsonl")).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles].sort())) throw new Error("Reviewer E output file set mismatch");
  const inputByBatch = new Map();
  for (const input of packetInputRows(packet)) {
    const rows = inputByBatch.get(input.batch_id) ?? [];
    rows.push(input);
    inputByBatch.set(input.batch_id, rows);
  }
  const rows = [];
  const fileIndex = [];
  const schema = buildOutputSchema();
  for (const batch of packet.manifest.batch_index) {
    const fileName = path.basename(batch.expected_output_file);
    const text = readFileSync(path.join(outputRoot, fileName), "utf8");
    const outputRows = parseJsonl(text, fileName);
    const inputRows = inputByBatch.get(batch.batch_id);
    if (outputRows.length !== inputRows.length) throw new Error(`${batch.batch_id}: output count mismatch`);
    for (const [index, row] of outputRows.entries()) {
      const failures = validateResultRow(row, { batchId: batch.batch_id, itemId: inputRows[index].item_id, schema });
      if (failures.length) throw new Error(`${batch.batch_id}:${index + 1}: ${failures.join(",")}`);
      rows.push(row);
    }
    fileIndex.push({ file_name: fileName, records: outputRows.length, sha256: sha256(text) });
  }
  return { rows, fileIndex };
}

function normalize(rows, privateManifest) {
  const byItem = new Map(privateManifest.mapping.map((row) => [row.item_id, row]));
  const normalized = rows.map((row) => {
    const provenance = byItem.get(row.item_id);
    if (!provenance) throw new Error(`${row.item_id}: missing private provenance`);
    return {
      schema_version: NORMALIZED_SCHEMA_VERSION,
      reviewer_id: "E",
      batch_id: row.batch_id,
      item_id: row.item_id,
      sample_id: provenance.sample_id,
      axis_decisions: row.axis_decisions,
      difficulty: row.difficulty,
      confidence: row.confidence,
      false_simple_risk: row.false_simple_risk,
      decision_basis: row.decision_basis,
      reason_codes: row.reason_codes,
      needs_human_adjudication: row.needs_human_adjudication,
    };
  });
  if (normalized.length !== EXPECTED_RECORDS || new Set(normalized.map((row) => row.item_id)).size !== EXPECTED_RECORDS) throw new Error("normalized Reviewer E result set mismatch");
  return normalized;
}

function comparisons(normalized, privateManifest) {
  const byItem = new Map(privateManifest.mapping.map((row) => [row.item_id, row]));
  return normalized.map((row) => {
    const provenance = byItem.get(row.item_id);
    return {
      schema_version: COMPARISON_SCHEMA_VERSION,
      item_id: row.item_id,
      sample_id: row.sample_id,
      current_label: provenance.current_label,
      reviewer_e_label: row.difficulty,
      transition: `${provenance.current_label}_to_${row.difficulty}`,
      changed: provenance.current_label !== row.difficulty,
      confidence: row.confidence,
      false_simple_risk: row.false_simple_risk,
      decision_basis: row.decision_basis,
      needs_human_adjudication: row.needs_human_adjudication,
      selection_reasons: provenance.selection_reasons,
      task_type: provenance.task_type,
      service_domain: provenance.service_domain,
      language: provenance.language,
      length_bucket: provenance.length_bucket,
      source: provenance.source,
      split: provenance.split,
    };
  });
}

function projectDataset(datasetRows, normalized) {
  const labels = new Map(normalized.map((row) => [row.sample_id, row.difficulty]));
  return datasetRows.map((row) => labels.has(row.sample_id) ? { ...row, label: labels.get(row.sample_id) } : row);
}

function buildReport({ normalized, comparison, projected, sourceIntake }) {
  const resultLabels = countBy(normalized, "difficulty");
  const confidence = countBy(normalized, "confidence");
  const transitions = countBy(comparison, "transition");
  const projectedLabels = countBy(projected, "label");
  const taskViolations = violatingSlices(projected, "task_type");
  const domainViolations = violatingSlices(projected, "service_domain");
  const language = nestedCounts(projected, "language", "label");
  return [
    "# Reviewer E(GPT) 위험 회피형 재검수 결과",
    "",
    `기준일은 ${EVIDENCE_DATE}이다. 수신 ZIP SHA-256은 \`${sourceIntake.sha256}\`이며 162개 batch의 7,974건이 모두 schema와 입력 순서를 통과했다.`,
    "",
    "## 판정 결과",
    "",
    "| 항목 | 건수 |",
    "|---|---:|",
    `| Simple | ${resultLabels.simple.toLocaleString("en-US")} |`,
    `| Complex | ${resultLabels.complex.toLocaleString("en-US")} |`,
    `| high confidence | ${confidence.high.toLocaleString("en-US")} |`,
    `| medium confidence | ${confidence.medium.toLocaleString("en-US")} |`,
    `| low confidence | ${confidence.low.toLocaleString("en-US")} |`,
    `| needs_human_adjudication | ${normalized.filter((row) => row.needs_human_adjudication).length.toLocaleString("en-US")} |`,
    "",
    "## 현재 Codex 수정본 대비",
    "",
    "| 전환 | 건수 |",
    "|---|---:|",
    `| Simple → Simple | ${(transitions.simple_to_simple ?? 0).toLocaleString("en-US")} |`,
    `| Simple → Complex | ${(transitions.simple_to_complex ?? 0).toLocaleString("en-US")} |`,
    `| Complex → Complex | ${(transitions.complex_to_complex ?? 0).toLocaleString("en-US")} |`,
    `| Complex → Simple | ${(transitions.complex_to_simple ?? 0).toLocaleString("en-US")} |`,
    "",
    `전부 적용한다고 가정하면 전체 15,000건은 Simple ${projectedLabels.simple.toLocaleString("en-US")} / Complex ${projectedLabels.complex.toLocaleString("en-US")}가 된다. 길이 단독 ROC-AUC는 ${lengthOnlyRocAuc(projected).toFixed(4)}, 35~65%를 벗어나는 작업 유형은 ${taskViolations.length}개, 서비스 도메인은 ${domainViolations.length}개다.`,
    "",
    `언어별 예상 분포는 한국어 Simple ${language.ko.simple} / Complex ${language.ko.complex}, 영어 Simple ${language.en.simple} / Complex ${language.en.complex}, 한영 혼합 Simple ${language.mixed.simple} / Complex ${language.mixed.complex}다.`,
    "",
    "## 해석과 제한",
    "",
    "- False Simple 위험 회피 정책 때문에 현재 Simple 중 2,786건이 Complex로 이동하는 반면, 현재 Complex 중 Simple로 내려가는 항목은 4건뿐이다.",
    "- 전체·언어·도메인 균형은 개선되지만 수학과 연구의 Complex 과다 문제는 해소되지 않는다. 적용 예상 기준 math_problem Complex 비율은 93.9%, research는 77.3%다.",
    "- 이 결과는 같은 GPT 계열의 비대칭 routing-policy 리뷰다. 의미론적 gold label이나 사람 승인으로 취급하지 않는다.",
    "- 현재 dataset label, human_reviewed, review_status, training_eligible은 이 import에서 변경하지 않는다.",
    "",
  ].join("\n");
}

export function buildImportArtifacts({ datasetText, normalized, sourceIntake }) {
  const packet = buildPacket(datasetText);
  const privateManifest = packet.privateManifest;
  const inputOrder = packetInputRows(packet).map((row) => row.item_id);
  if (JSON.stringify(inputOrder) !== JSON.stringify(normalized.map((row) => row.item_id))) throw new Error("normalized Reviewer E order mismatch");
  const datasetRows = parseJsonl(datasetText, DATASET_PATH);
  const comparison = comparisons(normalized, privateManifest);
  const projected = projectDataset(datasetRows, normalized);
  const normalizedText = jsonl(normalized);
  const comparisonText = jsonl(comparison);
  const report = buildReport({ normalized, comparison, projected, sourceIntake });
  const taskViolations = violatingSlices(projected, "task_type");
  const domainViolations = violatingSlices(projected, "service_domain");
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    status: "validated_same_model_family_risk_sensitive_review_not_applied",
    evidence_date: EVIDENCE_DATE,
    reviewer: { id: "E", intended_model_family: "GPT", role: "same_model_family_risk_sensitive_policy_review", independent_reviewer_credit: false },
    packet: {
      records: packet.manifest.records,
      batches: packet.manifest.batches,
      dataset_sha256: packet.manifest.dataset_sha256,
      review_set_sha256: packet.manifest.review_set_sha256,
      current_labels_included: false,
      prior_reviewer_results_included: false,
    },
    source_intake: sourceIntake,
    validation: { file_set_complete: true, record_set_complete: true, input_order_preserved: true, unique_item_ids: true, seven_axis_schema_valid: true, asymmetric_complex_contract_valid: true, prompt_or_rationale_in_results: false },
    counts: {
      records: normalized.length,
      result_labels: countBy(normalized, "difficulty"),
      confidence: countBy(normalized, "confidence"),
      false_simple_risk: countBy(normalized, "false_simple_risk"),
      decision_basis: countBy(normalized, "decision_basis"),
      needs_human_adjudication: normalized.filter((row) => row.needs_human_adjudication).length,
      transitions: countBy(comparison, "transition"),
    },
    projected_if_applied: {
      labels: countBy(projected, "label"),
      language_labels: nestedCounts(projected, "language", "label"),
      source_labels: nestedCounts(projected, "source", "label"),
      length_labels: nestedCounts(projected, "length_bucket", "label"),
      length_only_roc_auc: lengthOnlyRocAuc(projected),
      task_type_guardrail_violations: taskViolations,
      service_domain_guardrail_violations: domainViolations,
      semantic_dedup_reaudit_required: true,
    },
    artifacts: {
      normalized_file: "reviewer-e-results.normalized.jsonl",
      normalized_sha256: sha256(normalizedText),
      comparison_file: "reviewer-e-comparison.jsonl",
      comparison_sha256: sha256(comparisonText),
      report_file: "reviewer-e-report.md",
      report_sha256: sha256(report),
    },
    gates: { dataset_labels_updated: false, human_review_completed: false, training_eligible: false },
    blockers: ["same_model_family_policy_review_only", "human_adjudication_not_completed", "dataset_owner_application_decision_not_recorded", "semantic_dedup_reaudit_required_if_applied"],
  };
  return { normalizedText, comparisonText, report, manifest };
}

function writeOrCheck(filePath, contents, checkOnly) {
  if (checkOnly) {
    if (readFileSync(filePath, "utf8") !== contents) throw new Error(`stale Reviewer E import artifact: ${filePath}`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const datasetText = readFileSync(DATASET_PATH, "utf8");
  const packet = buildPacket(datasetText);
  let normalized;
  let sourceIntake;
  if (options.checkOnly) {
    normalized = parseJsonl(readFileSync(path.join(options.outputRoot, "reviewer-e-results.normalized.jsonl"), "utf8"), "stored Reviewer E normalized results");
    sourceIntake = readJson(path.join(options.outputRoot, "reviewer-e-import-manifest.json")).source_intake;
  } else {
    const received = readReceivedResults(options.resultsRoot, packet);
    normalized = normalize(received.rows, packet.privateManifest);
    const zipBytes = readFileSync(options.sourceZip);
    sourceIntake = {
      file_name: path.basename(options.sourceZip),
      bytes: statSync(options.sourceZip).size,
      sha256: sha256(zipBytes),
      files: received.fileIndex.length,
      records: received.fileIndex.reduce((total, file) => total + file.records, 0),
      aggregate_file_index_sha256: sha256(`${received.fileIndex.map((file) => `${file.file_name}:${file.records}:${file.sha256}`).join("\n")}\n`),
      file_index: received.fileIndex,
    };
  }
  const built = buildImportArtifacts({ datasetText, normalized, sourceIntake });
  const outputs = new Map([
    ["reviewer-e-results.normalized.jsonl", built.normalizedText],
    ["reviewer-e-comparison.jsonl", built.comparisonText],
    ["reviewer-e-report.md", built.report],
    ["reviewer-e-import-manifest.json", `${JSON.stringify(built.manifest, null, 2)}\n`],
  ]);
  for (const [name, contents] of outputs) writeOrCheck(path.join(options.outputRoot, name), contents, options.checkOnly);
  console.log(`${options.checkOnly ? "verified" : "imported"} Reviewer E: ${built.manifest.counts.records} results, ${JSON.stringify(built.manifest.counts.result_labels)}, labels remain unapplied`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
