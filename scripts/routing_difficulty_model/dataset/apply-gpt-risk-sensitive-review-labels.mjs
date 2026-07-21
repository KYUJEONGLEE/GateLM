import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lengthLabelDistribution, lengthOnlyRocAuc } from "./dataset-bias.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const PATHS = Object.freeze({
  enterpriseBase: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.codex-advisory-revised.jsonl",
  enterpriseBaseManifest: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.codex-advisory-revised.manifest.json",
  publicBase: "docs/routing/datasets/difficulty/data/public-prompts-7000.codex-advisory-revised.jsonl",
  publicBaseManifest: "docs/routing/datasets/difficulty/data/public-prompts-7000.codex-advisory-revised.manifest.json",
  bundleBase: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.jsonl",
  bundleBaseManifest: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.manifest.json",
  reviewerEResults: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-e-gpt/reviewer-e-results.normalized.jsonl",
  semanticResolution: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-e-gpt/reviewer-e-semantic-dedup-resolution.json",
  enterpriseRevised: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-e-risk-revised.jsonl",
  enterpriseRevisedManifest: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-e-risk-revised.manifest.json",
  publicRevised: "docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-e-risk-revised.jsonl",
  publicRevisedManifest: "docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-e-risk-revised.manifest.json",
  bundleRevised: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-e-risk-revised.jsonl",
  bundleRevisedManifest: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-e-risk-revised.manifest.json",
  semanticAudit: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-e-risk-revised.semantic-dedup.json",
  report: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-e-gpt/reviewer-e-label-application-report.md",
});

const VERSIONS = Object.freeze({
  enterprise: "routing_difficulty_enterprise_synthetic_8000_reviewer_e_risk_2026_07_22",
  public: "routing_difficulty_public_prompts_7000_reviewer_e_risk_2026_07_22",
  bundle: "routing_difficulty_initial_15000_reviewer_e_risk_2026_07_22",
});
const GENERATED_AT = "2026-07-22T00:00:00Z";

function absolute(relativePath) {
  return path.join(ROOT_DIR, ...relativePath.split("/"));
}

function read(relativePath) {
  return readFileSync(absolute(relativePath), "utf8");
}

function parseJsonl(text, name) {
  return text.replace(/^\uFEFF/u, "").trim().split(/\r?\n/u).filter(Boolean).map((line, index) => {
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

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = typeof selector === "function" ? selector(row) : row[selector];
    if (key === undefined || key === null) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
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
  }).map(([name]) => name).sort();
}

function promptProjectionSha(rows) {
  return sha256(jsonl(rows.map((row) => ({ sample_id: row.sample_id, group_id: row.group_id, redacted_prompt: row.redacted_prompt, split: row.split }))));
}

function promptContentSha(rows) {
  return sha256(jsonl(rows.map((row) => ({ sample_id: row.sample_id, redacted_prompt: row.redacted_prompt }))));
}

function groupSplitLeakCount(rows) {
  const splitsByGroup = new Map();
  for (const row of rows) {
    if (!splitsByGroup.has(row.group_id)) splitsByGroup.set(row.group_id, new Set());
    splitsByGroup.get(row.group_id).add(row.split);
  }
  return [...splitsByGroup.values()].filter((splits) => splits.size > 1).length;
}

function semanticGroupId(sampleIds) {
  return `semanticgrp:${sha256([...sampleIds].sort().join("\n")).slice(0, 24)}`;
}

function applySemanticResolution(rows, resolution, inputDatasetSha) {
  if (resolution.input_dataset_sha256 !== inputDatasetSha) throw new Error("semantic resolution input dataset hash mismatch");
  const byId = new Map(rows.map((row) => [row.sample_id, row]));
  const overrides = new Map();
  const clusterSampleIds = new Set();

  for (const cluster of resolution.clusters) {
    const expectedGroupIds = new Set(cluster.members.map((member) => member.expected_group_id));
    const resolvedRows = cluster.expand_expected_groups === true
      ? rows.filter((row) => expectedGroupIds.has(row.group_id))
      : cluster.members.map((member) => byId.get(member.sample_id));
    const resolvedGroupId = semanticGroupId(resolvedRows.map((row) => row.sample_id));
    for (const member of cluster.members) {
      const row = byId.get(member.sample_id);
      if (!row) throw new Error(`${member.sample_id}: semantic resolution sample missing`);
      if (row.group_id !== member.expected_group_id || row.split !== member.expected_split) throw new Error(`${member.sample_id}: semantic resolution precondition mismatch`);
    }
    for (const row of resolvedRows) {
      if (cluster.expand_expected_groups === true && row.split !== cluster.resolved_split) throw new Error(`${row.sample_id}: expanded semantic group split mismatch`);
      if (clusterSampleIds.has(row.sample_id)) throw new Error(`${row.sample_id}: repeated semantic resolution sample`);
      clusterSampleIds.add(row.sample_id);
      overrides.set(row.sample_id, { group_id: resolvedGroupId, split: cluster.resolved_split });
    }
  }

  for (const compensation of resolution.split_compensation) {
    const row = byId.get(compensation.sample_id);
    if (!row) throw new Error(`${compensation.sample_id}: split compensation sample missing`);
    if (row.group_id !== compensation.expected_group_id || row.split !== compensation.expected_split) throw new Error(`${compensation.sample_id}: split compensation precondition mismatch`);
    if (overrides.has(compensation.sample_id)) throw new Error(`${compensation.sample_id}: split compensation overlaps semantic cluster`);
    const matched = byId.get(compensation.matches_sample_id);
    if (!matched) throw new Error(`${compensation.sample_id}: split compensation match sample missing`);
    for (const field of compensation.matching_basis) {
      if (row[field] !== matched[field]) throw new Error(`${compensation.sample_id}: split compensation ${field} mismatch`);
    }
    overrides.set(compensation.sample_id, { group_id: row.group_id, split: compensation.resolved_split });
  }

  return {
    rows: rows.map((row) => overrides.has(row.sample_id) ? { ...row, ...overrides.get(row.sample_id) } : row),
    clusterSampleIds,
    overrides,
  };
}

function confidenceValue(confidence) {
  return { high: 0.9, medium: 0.6, low: 0.5 }[confidence];
}

function reasonFor(decisionBasis) {
  return {
    clearly_bounded_simple: "gpt_risk_sensitive_clearly_bounded_simple",
    complexity_evidence_present: "gpt_risk_sensitive_complexity_evidence",
    ambiguity_defaults_to_complex: "gpt_risk_sensitive_ambiguity_defaults_complex",
    unreadable_defaults_to_complex: "gpt_risk_sensitive_unreadable_defaults_complex",
  }[decisionBasis];
}

function applyComponent(records, resultsBySample, datasetVersion) {
  return records.map((record) => {
    const result = resultsBySample.get(record.sample_id);
    if (!result) return { ...record, dataset_version: datasetVersion };
    return {
      ...record,
      dataset_version: datasetVersion,
      label: result.difficulty,
      label_source: "llm_gpt_risk_sensitive_candidate",
      label_confidence: confidenceValue(result.confidence),
      label_reason: reasonFor(result.decision_basis),
      human_reviewed: false,
      review_status: record.review_status === "needs_adjudication" || result.needs_human_adjudication
        ? "needs_adjudication"
        : "pending",
    };
  });
}

function auditState(datasetSha) {
  if (!existsSync(absolute(PATHS.semanticAudit))) return { verified: false, candidatePairs: null, blocker: "semantic_embedding_dedup_not_completed_for_reviewer_e_labels" };
  const audit = JSON.parse(read(PATHS.semanticAudit));
  if (audit.dataset?.sha256 !== datasetSha || audit.dataset?.record_count !== 15000) return { verified: false, candidatePairs: null, blocker: "semantic_embedding_dedup_audit_hash_mismatch_for_reviewer_e_labels" };
  const candidatePairs = audit.result?.semantic_duplicate_candidate_pairs;
  const verified = audit.result?.semantic_duplicate_guardrail_met === true && candidatePairs === 0;
  return { verified, candidatePairs, blocker: verified ? null : "semantic_embedding_duplicate_candidates_remain_for_reviewer_e_labels" };
}

function distributions(rows, baseDistributions) {
  const fields = { label: "label", language: "language", source: "source", source_dataset: "source_dataset", split: "split", task_type: "task_type", service_domain: "service_domain", length_bucket: "length_bucket", source_prompt_kind: "source_prompt_kind", source_transform: "source_transform" };
  const result = {};
  for (const key of Object.keys(baseDistributions)) result[key] = fields[key] ? countBy(rows, fields[key]) : baseDistributions[key];
  result.automatic_label = countBy(rows, "automatic_label");
  result.label_source = countBy(rows, "label_source");
  result.review_status = countBy(rows, "review_status");
  return result;
}

function buildManifest({ base, baseRows, rows, datasetPath, datasetVersion, datasetText, kind, enterpriseText, publicText, audit, resolution }) {
  const labels = countBy(rows, "label");
  const automaticLabels = countBy(rows, "automatic_label");
  const lengthAuc = lengthOnlyRocAuc(rows);
  const taskViolations = violatingSlices(rows, "task_type");
  const domainViolations = violatingSlices(rows, "service_domain");
  const reviewerERecords = rows.filter((row) => row.label_source === "llm_gpt_risk_sensitive_candidate").length;
  const rowIds = new Set(rows.map((row) => row.sample_id));
  const localResolvedClusters = resolution.clusters.filter((cluster) => cluster.members.some((member) => rowIds.has(member.sample_id)));
  const localSplitChanges = new Set([
    ...localResolvedClusters.flatMap((cluster) => cluster.members.filter((member) => rowIds.has(member.sample_id) && member.expected_split !== cluster.resolved_split).map((member) => member.sample_id)),
    ...resolution.split_compensation.filter((item) => rowIds.has(item.sample_id) && item.expected_split !== item.resolved_split).map((item) => item.sample_id),
  ]);
  const blockers = ["reviewer_e_same_family_policy_labels_not_human_reviewed", "independent_reviewer_a_not_completed", "human_adjudication_not_completed"];
  if (kind !== "enterprise") blockers.push("direct_human_authored_share_below_60_percent", "anonymous_real_user_source_unavailable_without_additional_approval");
  if (Math.abs(labels.simple / rows.length - 0.5) > 0.05) blockers.push("current_label_class_imbalance_after_reviewer_e_relabel");
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
  manifest.counts.groups = new Set(rows.map((row) => row.group_id)).size;
  manifest.distributions = distributions(rows, base.distributions);
  manifest.coverage = {
    ...base.coverage,
    label_ratio: `${labels.simple}:${labels.complex}`,
    automatic_label_ratio: `${automaticLabels.simple}:${automaticLabels.complex}`,
    current_label_distribution_by_language: nestedCounts(rows, "language", "label"),
    length_label_distribution: lengthLabelDistribution(rows),
    length_only_roc_auc: lengthAuc,
    every_task_type_label_share_between_35_and_65_percent: taskViolations.length === 0,
    every_service_domain_label_share_between_35_and_65_percent: domainViolations.length === 0,
    task_type_label_share_guardrail_violations: taskViolations,
    service_domain_label_share_guardrail_violations: domainViolations,
    reviewer_e_risk_sensitive_label_records: reviewerERecords,
    reviewer_e_needs_human_adjudication_records: rows.filter((row) => row.label_source === "llm_gpt_risk_sensitive_candidate" && row.review_status === "needs_adjudication").length,
    total_needs_adjudication_records: rows.filter((row) => row.review_status === "needs_adjudication").length,
    independent_reviewer_a_complete: false,
    base_prompt_projection_sha256: promptProjectionSha(baseRows),
    revised_prompt_projection_sha256: promptProjectionSha(rows),
    base_prompt_content_sha256: promptContentSha(baseRows),
    revised_prompt_content_sha256: promptContentSha(rows),
    semantic_dedup_resolution_path: PATHS.semanticResolution,
    semantic_dedup_resolved_clusters: localResolvedClusters.length,
    semantic_dedup_split_reassigned_records: localSplitChanges.size,
    semantic_embedding_dedup_audit_path: PATHS.semanticAudit,
    semantic_embedding_dedup_threshold: 0.985,
    semantic_embedding_dedup_verified: audit.verified,
  };
  manifest.deduplication = { ...base.deduplication, group_split_leaks: groupSplitLeakCount(rows), semantic_duplicate_candidate_pairs: audit.candidatePairs, semantic_duplicate_method: "pinned multilingual-E5 native 384D cosine plus same-label/task/domain candidate policy after atomic semantic-group resolution", semantic_duplicate_threshold: 0.985 };
  manifest.review = {
    label_source_distribution: countBy(rows, "label_source"),
    review_status_distribution: countBy(rows, "review_status"),
    reviewer_e_risk_sensitive_label_records: reviewerERecords,
    reviewer_e_policy: "Simple only when clearly bounded with high confidence; uncertainty defaults to Complex",
    independent_reviewer_credit: false,
    human_reviewed: false,
    production_gold: false,
  };
  if (kind === "bundle") manifest.components = [
    { dataset_version: VERSIONS.enterprise, dataset_path: PATHS.enterpriseRevised, records: 8000, sha256: sha256(enterpriseText) },
    { dataset_version: VERSIONS.public, dataset_path: PATHS.publicRevised, records: 7000, sha256: sha256(publicText) },
  ];
  return manifest;
}

function buildReport({ baseRows, rows, results, audit }) {
  const baseById = new Map(baseRows.map((row) => [row.sample_id, row]));
  const transitions = countBy(results, (result) => `${baseById.get(result.sample_id).label}_to_${result.difficulty}`);
  const labels = countBy(rows, "label");
  const language = nestedCounts(rows, "language", "label");
  const source = nestedCounts(rows, "source", "label");
  const taskViolations = violatingSlices(rows, "task_type");
  const domainViolations = violatingSlices(rows, "service_domain");
  return [
    "# Reviewer E 위험 회피형 라벨 적용 보고서",
    "",
    "기준일은 2026-07-22이다. 검증된 Reviewer E 결과 7,974건을 Codex advisory 수정본 위에 별도 revision으로 적용했다. 이전 revision과 Reviewer E import 증거는 보존한다.",
    "",
    "## 적용 결과",
    "",
    "| 항목 | 건수 |",
    "|---|---:|",
    `| Reviewer E Simple | ${results.filter((row) => row.difficulty === "simple").length.toLocaleString("en-US")} |`,
    `| Reviewer E Complex | ${results.filter((row) => row.difficulty === "complex").length.toLocaleString("en-US")} |`,
    `| Simple → Complex | ${(transitions.simple_to_complex ?? 0).toLocaleString("en-US")} |`,
    `| Complex → Simple | ${(transitions.complex_to_simple ?? 0).toLocaleString("en-US")} |`,
    `| 기존과 동일 | ${((transitions.simple_to_simple ?? 0) + (transitions.complex_to_complex ?? 0)).toLocaleString("en-US")} |`,
    "",
    `전체 15,000건은 Simple ${labels.simple.toLocaleString("en-US")} / Complex ${labels.complex.toLocaleString("en-US")}다. 기존 review queue와 E의 사람 요청을 합친 \`needs_adjudication\`은 ${rows.filter((row) => row.review_status === "needs_adjudication").length.toLocaleString("en-US")}건이다.`,
    "",
    "## 현재 균형",
    "",
    `- 길이 단독 ROC-AUC: ${lengthOnlyRocAuc(rows).toFixed(4)}`,
    `- 35~65% 이탈 작업 유형: ${taskViolations.length}개 (${taskViolations.join(", ")})`,
    `- 35~65% 이탈 서비스 도메인: ${domainViolations.length}개 (${domainViolations.join(", ")})`,
    `- 한국어 Simple ${language.ko.simple} / Complex ${language.ko.complex}, 영어 Simple ${language.en.simple} / Complex ${language.en.complex}, 한영 혼합 Simple ${language.mixed.simple} / Complex ${language.mixed.complex}`,
    `- 합성 Simple ${source.synthetic.simple} / Complex ${source.synthetic.complex}, 경계 Simple ${source.boundary.simple} / Complex ${source.boundary.complex}, 공개 Simple ${source.public.simple} / Complex ${source.public.complex}`,
    `- embedding 의미 중복 검사: ${audit.verified ? "통과" : "미통과"}${audit.candidatePairs === null ? "" : `, 후보 ${audit.candidatePairs}쌍`}`,
    "",
    "Reviewer E는 같은 GPT 계열의 위험 회피형 정책 판정이다. 모든 record는 `human_reviewed=false`이며 Gemini A, 사람 adjudication, 중복 재검사와 dataset owner의 학습 승격 결정 전까지 `training_eligible=false`다.",
    "",
  ].join("\n");
}

function buildResolvedReport({ baseRows, rows, results, audit, resolution }) {
  const baseById = new Map(baseRows.map((row) => [row.sample_id, row]));
  const transitions = countBy(results, (result) => `${baseById.get(result.sample_id).label}_to_${result.difficulty}`);
  const labels = countBy(rows, "label");
  return [
    "# Reviewer E 위험 회피형 라벨 적용 보고서",
    "",
    "기준일은 2026-07-22이다. 검증된 Reviewer E 결과 7,974건을 Codex advisory 수정본 위에 별도 revision으로 적용했다.",
    "",
    "## 적용 결과",
    "",
    "| 항목 | 건수 |",
    "|---|---:|",
    `| Reviewer E Simple | ${results.filter((row) => row.difficulty === "simple").length.toLocaleString("en-US")} |`,
    `| Reviewer E Complex | ${results.filter((row) => row.difficulty === "complex").length.toLocaleString("en-US")} |`,
    `| Simple → Complex | ${(transitions.simple_to_complex ?? 0).toLocaleString("en-US")} |`,
    `| Complex → Simple | ${(transitions.complex_to_simple ?? 0).toLocaleString("en-US")} |`,
    "",
    `전체 15,000건은 Simple ${labels.simple.toLocaleString("en-US")} / Complex ${labels.complex.toLocaleString("en-US")}이며 \`needs_adjudication\`은 ${rows.filter((row) => row.review_status === "needs_adjudication").length.toLocaleString("en-US")}건이다.`,
    "",
    "## 의미 중복 해소",
    "",
    `누적 후보 ${resolution.expected_invariants.semantic_candidate_pairs_resolved}쌍을 ${resolution.clusters.length}개 의미 클러스터로 묶었다. Prompt와 라벨은 변경하지 않았고, 연결된 기존 합성 변형 그룹까지 원자적으로 병합했다.`,
    `교차 split 클러스터를 원자화하고 70/15/15 건수를 유지하기 위해 ${resolution.expected_invariants.split_reassigned_records}개 record의 split만 재배치했다.`,
    `pinned multilingual-E5 재감사 결과는 ${audit.verified ? "통과" : "미통과"}${audit.candidatePairs === null ? "" : `이며 후보는 ${audit.candidatePairs}쌍`}이다.`,
    `해소 근거는 \`${PATHS.semanticResolution}\`에 Prompt 없이 기록했다.`,
    "",
    "Reviewer E는 같은 GPT 계열의 위험 회피형 정책 재판정이다. 모든 record는 `human_reviewed=false`이며 독립 검수와 사람 adjudication 완료 전까지 `training_eligible=false`다.",
    "",
  ].join("\n");
}

export function buildArtifacts() {
  const enterpriseBaseRows = parseJsonl(read(PATHS.enterpriseBase), PATHS.enterpriseBase);
  const publicBaseRows = parseJsonl(read(PATHS.publicBase), PATHS.publicBase);
  const bundleBaseRows = parseJsonl(read(PATHS.bundleBase), PATHS.bundleBase);
  const results = parseJsonl(read(PATHS.reviewerEResults), PATHS.reviewerEResults);
  const resolution = JSON.parse(read(PATHS.semanticResolution));
  if (enterpriseBaseRows.length !== 8000 || publicBaseRows.length !== 7000 || bundleBaseRows.length !== 15000 || results.length !== 7974) throw new Error("base or Reviewer E record count mismatch");
  const componentIds = [...enterpriseBaseRows, ...publicBaseRows].map((row) => row.sample_id);
  if (JSON.stringify(componentIds) !== JSON.stringify(bundleBaseRows.map((row) => row.sample_id))) throw new Error("base component order mismatch");
  const resultsBySample = new Map(results.map((row) => [row.sample_id, row]));
  if (resultsBySample.size !== 7974) throw new Error("Reviewer E duplicate sample_id values");
  const preliminaryRows = [
    ...applyComponent(enterpriseBaseRows, resultsBySample, VERSIONS.enterprise),
    ...applyComponent(publicBaseRows, resultsBySample, VERSIONS.public),
  ];
  const semanticResolution = applySemanticResolution(preliminaryRows, resolution, sha256(jsonl(preliminaryRows)));
  const rows = semanticResolution.rows;
  const enterpriseRows = rows.slice(0, 8000);
  const publicRows = rows.slice(8000);
  const enterpriseText = jsonl(enterpriseRows);
  const publicText = jsonl(publicRows);
  const datasetText = jsonl(rows);
  const audit = auditState(sha256(datasetText));
  const enterpriseManifest = buildManifest({ base: JSON.parse(read(PATHS.enterpriseBaseManifest)), baseRows: enterpriseBaseRows, rows: enterpriseRows, datasetPath: PATHS.enterpriseRevised, datasetVersion: VERSIONS.enterprise, datasetText: enterpriseText, kind: "enterprise", enterpriseText, publicText, audit, resolution });
  const publicManifest = buildManifest({ base: JSON.parse(read(PATHS.publicBaseManifest)), baseRows: publicBaseRows, rows: publicRows, datasetPath: PATHS.publicRevised, datasetVersion: VERSIONS.public, datasetText: publicText, kind: "public", enterpriseText, publicText, audit, resolution });
  const bundleManifest = buildManifest({ base: JSON.parse(read(PATHS.bundleBaseManifest)), baseRows: bundleBaseRows, rows, datasetPath: PATHS.bundleRevised, datasetVersion: VERSIONS.bundle, datasetText, kind: "bundle", enterpriseText, publicText, audit, resolution });
  return {
    baseRows: bundleBaseRows, enterpriseRows, publicRows, rows, results, audit, resolution, semanticResolution,
    outputs: new Map([
      [PATHS.enterpriseRevised, enterpriseText],
      [PATHS.enterpriseRevisedManifest, pretty(enterpriseManifest)],
      [PATHS.publicRevised, publicText],
      [PATHS.publicRevisedManifest, pretty(publicManifest)],
      [PATHS.bundleRevised, datasetText],
      [PATHS.bundleRevisedManifest, pretty(bundleManifest)],
      [PATHS.report, buildResolvedReport({ baseRows: bundleBaseRows, rows, results, audit, resolution })],
    ]),
  };
}

export function verifyArtifacts(artifacts) {
  const failures = [];
  const { baseRows, enterpriseRows, publicRows, rows, results, resolution, semanticResolution } = artifacts;
  if (enterpriseRows.length !== 8000 || publicRows.length !== 7000 || rows.length !== 15000 || results.length !== 7974) failures.push("record count mismatch");
  const resultLabels = countBy(results, "difficulty");
  if (resultLabels.simple !== 3915 || resultLabels.complex !== 4059) failures.push(`unexpected Reviewer E results ${JSON.stringify(resultLabels)}`);
  const baseById = new Map(baseRows.map((row) => [row.sample_id, row]));
  const transitions = countBy(results, (row) => `${baseById.get(row.sample_id).label}_to_${row.difficulty}`);
  const expectedTransitions = { complex_to_complex: 1273, complex_to_simple: 4, simple_to_complex: 2786, simple_to_simple: 3911 };
  if (JSON.stringify(transitions) !== JSON.stringify(expectedTransitions)) failures.push(`unexpected transitions ${JSON.stringify(transitions)}`);
  const labels = countBy(rows, "label");
  if (labels.simple !== 6576 || labels.complex !== 8424) failures.push(`unexpected labels ${JSON.stringify(labels)}`);
  if (rows.filter((row) => row.label_source === "llm_gpt_risk_sensitive_candidate").length !== 7974) failures.push("Reviewer E label_source count must be 7974");
  if (rows.filter((row) => row.review_status === "needs_adjudication").length !== 3565) failures.push("needs_adjudication union must be 3565");
  if (rows.some((row) => row.human_reviewed !== false)) failures.push("human_reviewed must remain false");
  if (promptContentSha(baseRows) !== promptContentSha(rows)) failures.push("Prompt content changed");
  if (new Set(rows.map((row) => row.group_id)).size !== resolution.expected_invariants.group_count_after_resolution) failures.push("unexpected group count after semantic resolution");
  if (groupSplitLeakCount(rows) !== 0) failures.push("group split leak remains after semantic resolution");
  const expectedSplitChanges = new Set([
    ...resolution.clusters.flatMap((cluster) => cluster.members.filter((member) => member.expected_split !== cluster.resolved_split).map((member) => member.sample_id)),
    ...resolution.split_compensation.filter((item) => item.expected_split !== item.resolved_split).map((item) => item.sample_id),
  ]);
  const actualGroupChanges = new Set(rows.filter((row, index) => row.group_id !== baseRows[index].group_id).map((row) => row.sample_id));
  const actualSplitChanges = new Set(rows.filter((row, index) => row.split !== baseRows[index].split).map((row) => row.sample_id));
  if (actualGroupChanges.size !== semanticResolution.clusterSampleIds.size || [...actualGroupChanges].some((id) => !semanticResolution.clusterSampleIds.has(id))) failures.push("unexpected group_id changes");
  if (actualSplitChanges.size !== expectedSplitChanges.size || [...actualSplitChanges].some((id) => !expectedSplitChanges.has(id))) failures.push("unexpected split changes");
  if (JSON.stringify(countBy(rows, "split")) !== JSON.stringify({ test: 2250, train: 10500, validation: 2250 })) failures.push("split distribution changed");
  const schema = JSON.parse(read("docs/routing/datasets/difficulty/schemas/difficulty-dataset-record.schema.json"));
  const allowedFields = new Set(Object.keys(schema.properties));
  const enumFields = Object.fromEntries(Object.entries(schema.properties).filter(([, value]) => Array.isArray(value.enum)).map(([key, value]) => [key, new Set(value.enum)]));
  for (const row of rows) {
    const missing = schema.required.filter((field) => !Object.hasOwn(row, field));
    const unexpected = Object.keys(row).filter((field) => !allowedFields.has(field));
    if (missing.length) failures.push(`${row.sample_id}: missing ${missing.join(",")}`);
    if (unexpected.length) failures.push(`${row.sample_id}: unexpected ${unexpected.join(",")}`);
    for (const [field, allowed] of Object.entries(enumFields)) if (Object.hasOwn(row, field) && !allowed.has(row[field])) failures.push(`${row.sample_id}: invalid ${field}`);
    if (row.label_source === "llm_gpt_risk_sensitive_candidate" && (row.human_reviewed !== false || !["pending", "needs_adjudication"].includes(row.review_status))) failures.push(`${row.sample_id}: invalid Reviewer E review state`);
    if (failures.length > 100) break;
  }
  return failures;
}

function persist(artifacts, checkOnly) {
  const failures = verifyArtifacts(artifacts);
  for (const [relativePath, contents] of artifacts.outputs) {
    const target = absolute(relativePath);
    if (checkOnly) {
      if (!existsSync(target)) failures.push(`${relativePath}: missing`);
      else if (readFileSync(target, "utf8") !== contents) failures.push(`${relativePath}: stale`);
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf8");
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const checkOnly = process.argv.includes("--check");
  const artifacts = buildArtifacts();
  persist(artifacts, checkOnly);
  console.log(`Reviewer E label ${checkOnly ? "verification" : "generation"} passed.`);
  console.log(`labels=${JSON.stringify(countBy(artifacts.rows, "label"))}`);
  console.log(`needs_adjudication=${artifacts.rows.filter((row) => row.review_status === "needs_adjudication").length}`);
  console.log(`semantic_dedup_verified=${artifacts.audit.verified}`);
}
