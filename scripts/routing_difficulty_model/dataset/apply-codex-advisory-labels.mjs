import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lengthLabelDistribution, lengthOnlyRocAuc } from "./dataset-bias.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const PATHS = Object.freeze({
  enterpriseBase: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-b-c-revised.jsonl",
  enterpriseBaseManifest: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-b-c-revised.manifest.json",
  publicBase: "docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-b-c-revised.jsonl",
  publicBaseManifest: "docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-b-c-revised.manifest.json",
  bundleBase: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-b-c-revised.jsonl",
  bundleBaseManifest: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-b-c-revised.manifest.json",
  humanQueue: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-human-adjudication-queue.jsonl",
  reviewerCResults: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-c-gpt/reviewer-c-results.normalized.jsonl",
  enterpriseRevised: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.codex-advisory-revised.jsonl",
  enterpriseRevisedManifest: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.codex-advisory-revised.manifest.json",
  publicRevised: "docs/routing/datasets/difficulty/data/public-prompts-7000.codex-advisory-revised.jsonl",
  publicRevisedManifest: "docs/routing/datasets/difficulty/data/public-prompts-7000.codex-advisory-revised.manifest.json",
  bundleRevised: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.jsonl",
  bundleRevisedManifest: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.manifest.json",
  semanticAudit: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.semantic-dedup.json",
  decisions: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-d-codex/codex-advisory-decisions.jsonl",
  report: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-d-codex/codex-advisory-label-application-report.md",
});

const VERSIONS = Object.freeze({
  enterprise: "routing_difficulty_enterprise_synthetic_8000_codex_advisory_2026_07_22",
  public: "routing_difficulty_public_prompts_7000_codex_advisory_2026_07_22",
  bundle: "routing_difficulty_initial_15000_codex_advisory_2026_07_22",
});
const GENERATED_AT = "2026-07-22T00:00:00Z";

function absolute(relativePath) {
  return path.join(ROOT_DIR, ...relativePath.split("/"));
}

function read(relativePath) {
  return readFileSync(absolute(relativePath), "utf8");
}

function parseJsonl(text, name) {
  return text.trim().split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${name}:${index + 1}: ${error.message}`);
    }
  });
}

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = typeof selector === "function" ? selector(record) : record[selector];
    if (key === undefined || key === null) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function nestedCounts(records, outer, inner) {
  const result = {};
  for (const record of records) {
    result[record[outer]] ??= {};
    result[record[outer]][record[inner]] = (result[record[outer]][record[inner]] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function violatingSlices(records, field, minimum = 0.35, maximum = 0.65) {
  return Object.entries(nestedCounts(records, field, "label")).filter(([, labels]) => {
    const total = (labels.simple ?? 0) + (labels.complex ?? 0);
    const share = (labels.complex ?? 0) / total;
    return share < minimum || share > maximum;
  }).map(([name]) => name).sort();
}

function promptProjectionSha(records) {
  return sha256(jsonl(records.map((record) => ({
    sample_id: record.sample_id,
    group_id: record.group_id,
    redacted_prompt: record.redacted_prompt,
    split: record.split,
  }))));
}

export function codexAdvisoryDecision(axisDecisions) {
  const strongSignals = [
    axisDecisions.reasoning_level === "multi_step_analysis",
    axisDecisions.task_dependency === "dependent_multi_step",
    axisDecisions.constraint_tradeoff === "high",
    axisDecisions.expert_judgment === "specialized_judgment",
    axisDecisions.context_integration === "multiple_sources_integrated",
    axisDecisions.tool_external_evidence === "multiple_tools_or_interpreted_evidence",
    axisDecisions.verification === "iterative_or_falsification",
  ].filter(Boolean).length;
  const moderateSignals = [
    axisDecisions.reasoning_level === "limited_local",
    axisDecisions.task_dependency === "dependent_two_step",
    axisDecisions.constraint_tradeoff === "moderate",
    axisDecisions.expert_judgment === "specialized_but_mechanical",
    axisDecisions.tool_external_evidence === "single_simple_tool",
    axisDecisions.verification === "bounded_check",
  ].filter(Boolean).length;
  const complex = strongSignals > 0
    || (axisDecisions.task_dependency === "dependent_two_step" && moderateSignals >= 2)
    || moderateSignals >= 3;
  return { label: complex ? "complex" : "simple", strongSignals, moderateSignals };
}

function buildDecisions(queue, reviewerCResults) {
  const reviewerCByItem = new Map(reviewerCResults.map((row) => [row.item_id, row]));
  if (reviewerCByItem.size !== reviewerCResults.length) throw new Error("Reviewer C results contain duplicate item_id values");
  return queue.map((row) => {
    const reviewerC = reviewerCByItem.get(row.item_id);
    if (!reviewerC || reviewerC.sample_id !== row.sample_id) throw new Error(`${row.item_id}: missing or mismatched Reviewer C axes`);
    const decision = codexAdvisoryDecision(reviewerC.axis_decisions);
    return {
      schema_version: "gatelm.routing-difficulty-codex-advisory-decision.v1",
      item_id: row.item_id,
      sample_id: row.sample_id,
      label: decision.label,
      strong_signal_count: decision.strongSignals,
      moderate_signal_count: decision.moderateSignals,
      decision_basis: "codex_seven_axis_advisory_policy_over_blind_structured_assessment",
      human_reviewed: false,
      review_status: "needs_adjudication",
    };
  });
}

function applyComponent(records, decisionsBySample, datasetVersion) {
  return records.map((record) => {
    const decision = decisionsBySample.get(record.sample_id);
    if (!decision) return { ...record, dataset_version: datasetVersion };
    return {
      ...record,
      dataset_version: datasetVersion,
      label: decision.label,
      label_source: "llm_codex_advisory_candidate",
      label_confidence: 0.5,
      label_reason: decision.label === "complex"
        ? "codex_seven_axis_advisory_complex_pending_human_adjudication"
        : "codex_seven_axis_advisory_simple_pending_human_adjudication",
      human_reviewed: false,
      review_status: "needs_adjudication",
    };
  });
}

function semanticAuditState(datasetSha) {
  if (!existsSync(absolute(PATHS.semanticAudit))) {
    return { verified: false, candidatePairs: null, blocker: "semantic_embedding_dedup_not_completed_for_codex_advisory_labels" };
  }
  const audit = JSON.parse(read(PATHS.semanticAudit));
  if (audit.dataset?.sha256 !== datasetSha || audit.dataset?.record_count !== 15000) {
    return { verified: false, candidatePairs: null, blocker: "semantic_embedding_dedup_audit_hash_mismatch_for_codex_advisory_labels" };
  }
  const candidatePairs = audit.result?.semantic_duplicate_candidate_pairs;
  const verified = audit.result?.semantic_duplicate_guardrail_met === true && candidatePairs === 0;
  return {
    verified,
    candidatePairs,
    blocker: verified ? null : "semantic_embedding_duplicate_candidates_remain_for_codex_advisory_labels",
  };
}

function revisedDistributions(records, baseDistributions) {
  const mapping = {
    label: "label",
    language: "language",
    source: "source",
    source_dataset: "source_dataset",
    split: "split",
    task_type: "task_type",
    service_domain: "service_domain",
    length_bucket: "length_bucket",
    source_prompt_kind: "source_prompt_kind",
    source_transform: "source_transform",
  };
  const distributions = {};
  for (const key of Object.keys(baseDistributions)) {
    distributions[key] = mapping[key] ? countBy(records, mapping[key]) : baseDistributions[key];
  }
  distributions.automatic_label = countBy(records, "automatic_label");
  distributions.label_source = countBy(records, "label_source");
  distributions.review_status = countBy(records, "review_status");
  return distributions;
}

function buildManifest({ base, baseRecords, records, datasetPath, datasetVersion, datasetText, kind, enterpriseText, publicText, audit }) {
  const labels = countBy(records, "label");
  const automaticLabels = countBy(records, "automatic_label");
  const lengthAuc = lengthOnlyRocAuc(records);
  const taskViolations = violatingSlices(records, "task_type");
  const domainViolations = violatingSlices(records, "service_domain");
  const codexRecords = records.filter((record) => record.label_source === "llm_codex_advisory_candidate").length;
  const blockers = [
    "codex_advisory_labels_not_human_reviewed",
    "independent_reviewer_a_not_completed",
    "human_adjudication_not_completed",
  ];
  if (kind !== "enterprise") blockers.push(
    "direct_human_authored_share_below_60_percent",
    "anonymous_real_user_source_unavailable_without_additional_approval",
  );
  if (Math.abs(labels.simple / records.length - 0.5) > 0.05) blockers.push("current_label_class_imbalance_after_codex_advisory_relabel");
  if (lengthAuc > 0.6) blockers.push("length_label_proxy_above_0_60_guardrail");
  if (taskViolations.length || domainViolations.length) blockers.push("task_or_domain_label_balance_guardrail_failed");
  if (audit.blocker) blockers.push(audit.blocker);

  const manifest = structuredClone(base);
  manifest.dataset_version = datasetVersion;
  manifest.dataset_path = datasetPath;
  manifest.dataset_sha256 = sha256(datasetText);
  manifest.generated_at = GENERATED_AT;
  manifest.scope.training_eligible = false;
  manifest.scope.training_blockers = blockers;
  manifest.counts.human_reviewed_records = 0;
  manifest.distributions = revisedDistributions(records, base.distributions);
  manifest.coverage = {
    ...base.coverage,
    label_ratio: `${labels.simple}:${labels.complex}`,
    automatic_label_ratio: `${automaticLabels.simple}:${automaticLabels.complex}`,
    current_label_distribution_by_language: nestedCounts(records, "language", "label"),
    length_label_distribution: lengthLabelDistribution(records),
    length_only_roc_auc: lengthAuc,
    every_task_type_label_share_between_35_and_65_percent: taskViolations.length === 0,
    every_service_domain_label_share_between_35_and_65_percent: domainViolations.length === 0,
    task_type_label_share_guardrail_violations: taskViolations,
    service_domain_label_share_guardrail_violations: domainViolations,
    codex_advisory_relabel_records: codexRecords,
    codex_advisory_simple_records: records.filter((record) => record.label_source === "llm_codex_advisory_candidate" && record.label === "simple").length,
    codex_advisory_complex_records: records.filter((record) => record.label_source === "llm_codex_advisory_candidate" && record.label === "complex").length,
    independent_reviewer_a_complete: false,
    base_prompt_projection_sha256: promptProjectionSha(baseRecords),
    revised_prompt_projection_sha256: promptProjectionSha(records),
    semantic_embedding_dedup_audit_path: PATHS.semanticAudit,
    semantic_embedding_dedup_threshold: 0.985,
    semantic_embedding_dedup_verified: audit.verified,
  };
  manifest.deduplication = {
    ...base.deduplication,
    semantic_duplicate_candidate_pairs: audit.candidatePairs,
    semantic_duplicate_method: "pinned multilingual-E5 native 384D cosine plus same-label/task/domain candidate policy on Codex advisory labels",
    semantic_duplicate_threshold: 0.985,
  };
  manifest.review = {
    label_source_distribution: countBy(records, "label_source"),
    review_status_distribution: countBy(records, "review_status"),
    codex_advisory_relabel_records: codexRecords,
    advisory_method: "deterministic seven-axis policy over blind Reviewer C structured assessments",
    independent_reviewer_a_complete: false,
    human_reviewed: false,
    production_gold: false,
  };
  if (kind === "bundle") {
    manifest.components = [
      { dataset_version: VERSIONS.enterprise, dataset_path: PATHS.enterpriseRevised, records: 8000, sha256: sha256(enterpriseText) },
      { dataset_version: VERSIONS.public, dataset_path: PATHS.publicRevised, records: 7000, sha256: sha256(publicText) },
    ];
  }
  return manifest;
}

function buildReport({ baseRecords, records, decisions, audit }) {
  const labels = countBy(records, "label");
  const decisionLabels = countBy(decisions, "label");
  const baseById = new Map(baseRecords.map((record) => [record.sample_id, record]));
  const transitions = countBy(decisions, (decision) => `${baseById.get(decision.sample_id).label}_to_${decision.label}`);
  const taskViolations = violatingSlices(records, "task_type");
  const domainViolations = violatingSlices(records, "service_domain");
  const languageLabels = nestedCounts(records, "language", "label");
  const humanMinimum = new Set(decisions.map((decision) => decision.sample_id));
  for (const record of records) if (record.source === "boundary" || record.split === "test") humanMinimum.add(record.sample_id);
  return [
    "# Codex 7축 advisory 라벨 적용 보고서",
    "",
    "기준일은 2026-07-22이다. B/C 사람 판정 대기 2,249건에 대해 저장된 블라인드 Reviewer C의 7축 구조화 판정을 Codex advisory 정책으로 다시 결합한 결과를 별도 dataset revision에 적용했다. Prompt를 새 판정 이력에 복제하지 않는다.",
    "",
    "## 적용 결과",
    "",
    "| 항목 | 건수 |",
    "|---|---:|",
    `| Codex Simple | ${decisionLabels.simple.toLocaleString("en-US")} |`,
    `| Codex Complex | ${decisionLabels.complex.toLocaleString("en-US")} |`,
    `| 기존 Simple → Codex Complex | ${(transitions.simple_to_complex ?? 0).toLocaleString("en-US")} |`,
    `| 기존 Complex → Codex Simple | ${(transitions.complex_to_simple ?? 0).toLocaleString("en-US")} |`,
    `| 기존과 동일 | ${((transitions.simple_to_simple ?? 0) + (transitions.complex_to_complex ?? 0)).toLocaleString("en-US")} |`,
    "",
    `전체 15,000건의 현재 라벨은 Simple ${labels.simple.toLocaleString("en-US")} / Complex ${labels.complex.toLocaleString("en-US")}다. 최초 규칙 후보는 \`automatic_label\`에 보존한다.`,
    "",
    "## 판정 정책",
    "",
    "- 7개 축 중 강한 복잡성 신호가 하나 이상이면 Complex다.",
    "- 강한 신호가 없더라도 의존적 2단계와 중간 신호 2개 이상이 결합되거나, 중간 신호가 3개 이상이면 Complex다.",
    "- 나머지는 Simple이다. 길이·언어·전문 용어·코드 포함 여부는 단독 신호로 사용하지 않는다.",
    "- 이는 새 독립 사람 판정이 아니라 같은 GPT 계열 구조화 판정에 대한 Codex advisory 재결합이다.",
    "",
    "## 남은 제한",
    "",
    "- 2,249건 모두 `needs_adjudication`, `human_reviewed=false`를 유지한다.",
    `- B/C queue, 모든 boundary, 모든 Test record의 최소 사람 검수 합집합은 ${humanMinimum.size.toLocaleString("en-US")}건이다.`,
    `- 현재 라벨은 Simple ${(labels.simple / records.length * 100).toFixed(1)}% / Complex ${(labels.complex / records.length * 100).toFixed(1)}%다.`,
    `- 길이 단독 ROC-AUC는 ${lengthOnlyRocAuc(records).toFixed(4)}이고, 라벨 비율 35~65%를 벗어난 작업 유형은 ${taskViolations.length}개, 서비스 도메인은 ${domainViolations.length}개다.`,
    `- 영어는 Simple ${(languageLabels.en?.simple ?? 0).toLocaleString("en-US")} / Complex ${(languageLabels.en?.complex ?? 0).toLocaleString("en-US")}, 한영 혼합은 Simple ${(languageLabels.mixed?.simple ?? 0).toLocaleString("en-US")} / Complex ${(languageLabels.mixed?.complex ?? 0).toLocaleString("en-US")}다.`,
    `- Codex 라벨 기준 embedding 의미 중복 검사는 ${audit.verified ? "통과했다" : "아직 통과하지 않았다"}${audit.candidatePairs === null ? "" : ` (후보 ${audit.candidatePairs}쌍)`}.`,
    "- Gemini Reviewer A, 실제 사람 adjudication, dataset owner 승격 전에는 `training_eligible=false`다.",
    "",
  ].join("\n");
}

export function buildArtifacts() {
  const enterpriseBaseText = read(PATHS.enterpriseBase);
  const publicBaseText = read(PATHS.publicBase);
  const bundleBaseText = read(PATHS.bundleBase);
  const enterpriseBaseRecords = parseJsonl(enterpriseBaseText, PATHS.enterpriseBase);
  const publicBaseRecords = parseJsonl(publicBaseText, PATHS.publicBase);
  const bundleBaseRecords = parseJsonl(bundleBaseText, PATHS.bundleBase);
  const queue = parseJsonl(read(PATHS.humanQueue), PATHS.humanQueue);
  const reviewerCResults = parseJsonl(read(PATHS.reviewerCResults), PATHS.reviewerCResults);
  if (enterpriseBaseRecords.length !== 8000 || publicBaseRecords.length !== 7000 || bundleBaseRecords.length !== 15000) throw new Error("base record count mismatch");
  if (queue.length !== 2249) throw new Error(`expected 2249 human-queue records, got ${queue.length}`);
  const componentIds = [...enterpriseBaseRecords, ...publicBaseRecords].map((record) => record.sample_id);
  if (JSON.stringify(componentIds) !== JSON.stringify(bundleBaseRecords.map((record) => record.sample_id))) throw new Error("base component order mismatch");

  const decisions = buildDecisions(queue, reviewerCResults);
  const decisionsBySample = new Map(decisions.map((decision) => [decision.sample_id, decision]));
  if (decisionsBySample.size !== 2249) throw new Error("Codex decisions contain duplicate sample_id values");
  const enterpriseRecords = applyComponent(enterpriseBaseRecords, decisionsBySample, VERSIONS.enterprise);
  const publicRecords = applyComponent(publicBaseRecords, decisionsBySample, VERSIONS.public);
  const records = [...enterpriseRecords, ...publicRecords];
  const enterpriseText = jsonl(enterpriseRecords);
  const publicText = jsonl(publicRecords);
  const datasetText = jsonl(records);
  const audit = semanticAuditState(sha256(datasetText));

  const enterpriseManifest = buildManifest({
    base: JSON.parse(read(PATHS.enterpriseBaseManifest)), baseRecords: enterpriseBaseRecords, records: enterpriseRecords,
    datasetPath: PATHS.enterpriseRevised, datasetVersion: VERSIONS.enterprise, datasetText: enterpriseText,
    kind: "enterprise", enterpriseText, publicText, audit,
  });
  const publicManifest = buildManifest({
    base: JSON.parse(read(PATHS.publicBaseManifest)), baseRecords: publicBaseRecords, records: publicRecords,
    datasetPath: PATHS.publicRevised, datasetVersion: VERSIONS.public, datasetText: publicText,
    kind: "public", enterpriseText, publicText, audit,
  });
  const bundleManifest = buildManifest({
    base: JSON.parse(read(PATHS.bundleBaseManifest)), baseRecords: bundleBaseRecords, records,
    datasetPath: PATHS.bundleRevised, datasetVersion: VERSIONS.bundle, datasetText,
    kind: "bundle", enterpriseText, publicText, audit,
  });

  return {
    baseRecords: bundleBaseRecords,
    enterpriseRecords,
    publicRecords,
    records,
    decisions,
    audit,
    outputs: new Map([
      [PATHS.enterpriseRevised, enterpriseText],
      [PATHS.enterpriseRevisedManifest, pretty(enterpriseManifest)],
      [PATHS.publicRevised, publicText],
      [PATHS.publicRevisedManifest, pretty(publicManifest)],
      [PATHS.bundleRevised, datasetText],
      [PATHS.bundleRevisedManifest, pretty(bundleManifest)],
      [PATHS.decisions, jsonl(decisions)],
      [PATHS.report, buildReport({ baseRecords: bundleBaseRecords, records, decisions, audit })],
    ]),
  };
}

export function verifyArtifacts(artifacts) {
  const failures = [];
  const { baseRecords, enterpriseRecords, publicRecords, records, decisions } = artifacts;
  if (enterpriseRecords.length !== 8000 || publicRecords.length !== 7000 || records.length !== 15000) failures.push("component or bundle record count mismatch");
  if (decisions.length !== 2249) failures.push("Codex decision count must be 2249");
  const decisionLabels = countBy(decisions, "label");
  if (decisionLabels.simple !== 1727 || decisionLabels.complex !== 522) failures.push(`unexpected Codex decision labels: ${JSON.stringify(decisionLabels)}`);
  const baseById = new Map(baseRecords.map((record) => [record.sample_id, record]));
  const transitions = countBy(decisions, (decision) => `${baseById.get(decision.sample_id).label}_to_${decision.label}`);
  const expectedTransitions = { complex_to_complex: 149, complex_to_simple: 2, simple_to_complex: 373, simple_to_simple: 1725 };
  if (JSON.stringify(transitions) !== JSON.stringify(expectedTransitions)) failures.push(`unexpected transitions: ${JSON.stringify(transitions)}`);
  const labels = countBy(records, "label");
  if (labels.simple !== 9358 || labels.complex !== 5642) failures.push(`unexpected bundle labels: ${JSON.stringify(labels)}`);
  if (records.filter((record) => record.label_source === "llm_codex_advisory_candidate").length !== 2249) failures.push("Codex label_source count must be 2249");
  if (records.filter((record) => record.review_status === "needs_adjudication").length !== 2249) failures.push("needs_adjudication count must be 2249");
  if (records.some((record) => record.human_reviewed !== false)) failures.push("human_reviewed must remain false");
  if (decisions.some((decision) => Object.hasOwn(decision, "prompt") || Object.hasOwn(decision, "redacted_prompt"))) failures.push("decision artifact must not contain Prompt text");
  if (promptProjectionSha(baseRecords) !== promptProjectionSha(records)) failures.push("Prompt projection changed during relabeling");

  const schema = JSON.parse(read("docs/routing/datasets/difficulty/schemas/difficulty-dataset-record.schema.json"));
  const allowedFields = new Set(Object.keys(schema.properties));
  const enumFields = Object.fromEntries(Object.entries(schema.properties).filter(([, value]) => Array.isArray(value.enum)).map(([key, value]) => [key, new Set(value.enum)]));
  for (const record of records) {
    const missing = schema.required.filter((field) => !Object.hasOwn(record, field));
    const unexpected = Object.keys(record).filter((field) => !allowedFields.has(field));
    if (missing.length) failures.push(`${record.sample_id}: missing ${missing.join(",")}`);
    if (unexpected.length) failures.push(`${record.sample_id}: unexpected ${unexpected.join(",")}`);
    for (const [field, allowed] of Object.entries(enumFields)) {
      if (Object.hasOwn(record, field) && !allowed.has(record[field])) failures.push(`${record.sample_id}: invalid ${field}`);
    }
    if (record.label_source === "llm_codex_advisory_candidate"
        && (record.human_reviewed !== false || record.review_status !== "needs_adjudication")) failures.push(`${record.sample_id}: invalid Codex advisory state`);
    if (failures.length > 100) break;
  }
  return failures;
}

function persist(artifacts, checkOnly) {
  const failures = verifyArtifacts(artifacts);
  for (const [relativePath, expected] of artifacts.outputs) {
    const target = absolute(relativePath);
    if (checkOnly) {
      if (!existsSync(target)) failures.push(`${relativePath}: missing`);
      else if (readFileSync(target, "utf8") !== expected) failures.push(`${relativePath}: stale`);
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, expected, "utf8");
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const checkOnly = process.argv.includes("--check");
  const artifacts = buildArtifacts();
  persist(artifacts, checkOnly);
  console.log(`Codex advisory label ${checkOnly ? "verification" : "generation"} passed.`);
  console.log(`decisions=${JSON.stringify(countBy(artifacts.decisions, "label"))}`);
  console.log(`bundle_labels=${JSON.stringify(countBy(artifacts.records, "label"))}`);
  console.log(`semantic_dedup_verified=${artifacts.audit.verified}`);
}
