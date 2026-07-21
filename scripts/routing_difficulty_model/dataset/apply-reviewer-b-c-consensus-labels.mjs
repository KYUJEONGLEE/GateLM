import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lengthLabelDistribution, lengthOnlyRocAuc } from "./dataset-bias.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const PATHS = Object.freeze({
  enterprise: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.jsonl",
  enterpriseBaseManifest: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.manifest.json",
  publicBase: "docs/routing/datasets/difficulty/data/public-prompts-7000.jsonl",
  publicBaseManifest: "docs/routing/datasets/difficulty/data/public-prompts-7000.manifest.json",
  bundleBase: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.jsonl",
  bundleBaseManifest: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.manifest.json",
  comparison: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-comparison.jsonl",
  enterpriseRevised: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-b-c-revised.jsonl",
  enterpriseRevisedManifest: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-b-c-revised.manifest.json",
  publicRevised: "docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-b-c-revised.jsonl",
  publicRevisedManifest: "docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-b-c-revised.manifest.json",
  bundleRevised: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-b-c-revised.jsonl",
  bundleRevisedManifest: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-b-c-revised.manifest.json",
  semanticAudit: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-b-c-revised.semantic-dedup.json",
  overrides: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-label-overrides.jsonl",
  report: "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-label-application-report.md",
});

const ENTERPRISE_VERSION = "routing_difficulty_enterprise_synthetic_8000_gpt_b_c_review_status_2026_07_21";
const PUBLIC_VERSION = "routing_difficulty_public_prompts_7000_gpt_b_c_revised_2026_07_21";
const BUNDLE_VERSION = "routing_difficulty_initial_15000_gpt_b_c_revised_2026_07_21";
const GENERATED_AT = "2026-07-21T00:00:00Z";

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
    const outerKey = record[outer];
    const innerKey = record[inner];
    result[outerKey] ??= {};
    result[outerKey][innerKey] = (result[outerKey][innerKey] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function everySliceHasBothLabels(records, field) {
  const slices = new Map();
  for (const record of records) {
    if (!slices.has(record[field])) slices.set(record[field], new Set());
    slices.get(record[field]).add(record.label);
  }
  return [...slices.values()].every((labels) => labels.has("simple") && labels.has("complex"));
}

function everySliceWithinShare(records, field, minimum = 0.35, maximum = 0.65) {
  const slices = new Map();
  for (const record of records) {
    const current = slices.get(record[field]) ?? { simple: 0, complex: 0 };
    current[record.label] += 1;
    slices.set(record[field], current);
  }
  return [...slices.values()].every((counts) => {
    const total = counts.simple + counts.complex;
    const complexShare = counts.complex / total;
    return complexShare >= minimum && complexShare <= maximum;
  });
}

function violatingSlices(records, field, minimum = 0.35, maximum = 0.65) {
  const counts = nestedCounts(records, field, "label");
  return Object.entries(counts).filter(([, labels]) => {
    const total = (labels.simple ?? 0) + (labels.complex ?? 0);
    const share = (labels.complex ?? 0) / total;
    return share < minimum || share > maximum;
  }).map(([name]) => name).sort();
}

function labelConfidence(comparison) {
  if (!comparison.human_adjudication_required
      && comparison.reviewer_b.confidence === "high"
      && comparison.reviewer_c.confidence === "high") return 0.9;
  return 0.5;
}

function promptProjectionSha(records) {
  return sha256(jsonl(records.map((record) => ({
    sample_id: record.sample_id,
    group_id: record.group_id,
    redacted_prompt: record.redacted_prompt,
    split: record.split,
  }))));
}

function auditState(datasetSha) {
  if (!existsSync(absolute(PATHS.semanticAudit))) {
    return { verified: false, candidatePairs: null, blocker: "semantic_embedding_dedup_not_completed_for_revised_labels" };
  }
  const audit = JSON.parse(read(PATHS.semanticAudit));
  if (audit.dataset?.sha256 !== datasetSha || audit.dataset?.record_count !== 15000) {
    return { verified: false, candidatePairs: null, blocker: "semantic_embedding_dedup_audit_hash_mismatch_for_revised_labels" };
  }
  const candidatePairs = audit.result?.semantic_duplicate_candidate_pairs;
  const verified = audit.result?.semantic_duplicate_guardrail_met === true && candidatePairs === 0;
  return {
    verified,
    candidatePairs,
    blocker: verified ? null : "semantic_embedding_duplicate_candidates_remain_for_revised_labels",
  };
}

function revisedDistributions(records, baseDistributions) {
  const fieldByDistribution = {
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
    distributions[key] = fieldByDistribution[key] ? countBy(records, fieldByDistribution[key]) : baseDistributions[key];
  }
  distributions.automatic_label = countBy(records, "automatic_label");
  distributions.label_source = countBy(records, "label_source");
  distributions.review_status = countBy(records, "review_status");
  return distributions;
}

function applyRecords(publicRecords, comparisons) {
  const comparisonById = new Map(comparisons.map((row) => [row.sample_id, row]));
  if (comparisonById.size !== comparisons.length) throw new Error("reviewer B/C comparison contains duplicate sample_id values");

  const changeRows = comparisons.filter((row) => (
    row.reviewer_b?.difficulty === row.reviewer_c?.difficulty
    && row.candidate_label !== row.reviewer_b.difficulty
  ));
  if (changeRows.length !== 3215) throw new Error(`expected 3215 B/C label changes, got ${changeRows.length}`);
  const changeIds = new Set(changeRows.map((row) => row.sample_id));
  const humanQueueIds = new Set(comparisons.filter((row) => row.human_adjudication_required).map((row) => row.sample_id));
  if (humanQueueIds.size !== 2249) throw new Error(`expected 2249 B/C human-queue records, got ${humanQueueIds.size}`);

  const overrides = [];
  const revisedRecords = publicRecords.map((record) => {
    const comparison = comparisonById.get(record.sample_id);
    const needsAdjudication = humanQueueIds.has(record.sample_id);
    if (!changeIds.has(record.sample_id)) {
      return {
        ...record,
        dataset_version: PUBLIC_VERSION,
        review_status: needsAdjudication ? "needs_adjudication" : record.review_status,
      };
    }
    if (!comparison) throw new Error(`${record.sample_id}: missing comparison row`);
    if (record.source !== "public" || record.label !== comparison.candidate_label) {
      throw new Error(`${record.sample_id}: base candidate does not match reviewer comparison`);
    }
    const reviewStatus = comparison.human_adjudication_required ? "needs_adjudication" : "pending";
    overrides.push({
      schema_version: "gatelm.routing-difficulty-same-family-label-override.v1",
      item_id: comparison.item_id,
      sample_id: record.sample_id,
      automatic_label: record.automatic_label,
      prior_candidate_label: record.label,
      revised_label: comparison.reviewer_b.difficulty,
      reviewer_b_confidence: comparison.reviewer_b.confidence,
      reviewer_c_confidence: comparison.reviewer_c.confidence,
      reviewer_b_needs_human_adjudication: comparison.reviewer_b.needs_human_adjudication,
      reviewer_c_needs_human_adjudication: comparison.reviewer_c.needs_human_adjudication,
      human_adjudication_required: comparison.human_adjudication_required,
      review_status: reviewStatus,
      decision_basis: "reviewer_b_c_same_family_agreement_candidate_differs",
    });
    return {
      ...record,
      dataset_version: PUBLIC_VERSION,
      label: comparison.reviewer_b.difficulty,
      label_source: "llm_same_family_consensus_candidate",
      label_confidence: labelConfidence(comparison),
      label_reason: comparison.human_adjudication_required
        ? "same_family_llm_agreement_pending_human_adjudication"
        : "same_family_llm_high_confidence_agreement_candidate",
      human_reviewed: false,
      review_status: reviewStatus,
    };
  });
  if (overrides.length !== 3215) throw new Error(`expected to apply 3215 overrides, applied ${overrides.length}`);
  return { revisedRecords, overrides, humanQueueIds };
}

function buildManifest({ base, baseRecords, records, datasetPath, datasetVersion, datasetText, scopeKind, enterpriseText, publicText, audit }) {
  const labelCounts = countBy(records, "label");
  const automaticLabelCounts = countBy(records, "automatic_label");
  const klueRecords = records.filter((record) => record.source_dataset === "klue_mrc");
  const labelOverrideRecords = records.filter((record) => record.label_source === "llm_same_family_consensus_candidate").length;
  const highConfidenceOverrides = records.filter((record) => (
    record.label_source === "llm_same_family_consensus_candidate" && record.label_confidence === 0.9
  )).length;
  const needsAdjudicationRecords = records.filter((record) => record.review_status === "needs_adjudication").length;
  const lengthAuc = lengthOnlyRocAuc(records);
  const taskBalanceMet = everySliceWithinShare(records, "task_type");
  const domainBalanceMet = everySliceWithinShare(records, "service_domain");
  const labelShare = labelCounts.simple / records.length;
  const blockers = [
    "candidate_labels_not_human_reviewed",
    "independent_reviewer_a_not_completed",
    "human_adjudication_not_completed",
  ];
  if (scopeKind !== "enterprise") {
    blockers.push(
      "direct_human_authored_share_below_60_percent",
      "anonymous_real_user_source_unavailable_without_additional_approval",
    );
  }
  if (Math.abs(labelShare - 0.5) > 0.05) blockers.push("current_label_class_imbalance_after_same_family_override");
  if (lengthAuc > 0.6) blockers.push("length_label_proxy_above_0_60_guardrail");
  if (!taskBalanceMet || !domainBalanceMet) blockers.push("task_or_domain_label_balance_guardrail_failed");
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
    every_language_has_both_labels: everySliceHasBothLabels(records, "language"),
    label_ratio: `${labelCounts.simple}:${labelCounts.complex}`,
    automatic_label_ratio: `${automaticLabelCounts.simple}:${automaticLabelCounts.complex}`,
    current_label_distribution_by_language: nestedCounts(records, "language", "label"),
    length_label_distribution: lengthLabelDistribution(records),
    length_only_roc_auc: lengthAuc,
    klue_label_distribution: countBy(klueRecords, "label"),
    klue_length_only_roc_auc: lengthOnlyRocAuc(klueRecords),
    every_task_type_label_share_between_35_and_65_percent: taskBalanceMet,
    every_service_domain_label_share_between_35_and_65_percent: domainBalanceMet,
    task_type_label_share_guardrail_violations: violatingSlices(records, "task_type"),
    service_domain_label_share_guardrail_violations: violatingSlices(records, "service_domain"),
    reviewer_b_c_same_family_label_overrides: labelOverrideRecords,
    reviewer_b_c_high_confidence_consensus_overrides: highConfidenceOverrides,
    reviewer_b_c_human_adjudication_queue_records_in_dataset: needsAdjudicationRecords,
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
    semantic_duplicate_method: "pinned multilingual-E5 native 384D cosine plus same-label/task/domain candidate policy on revised labels",
    semantic_duplicate_threshold: 0.985,
  };
  manifest.review = {
    label_source_distribution: countBy(records, "label_source"),
    review_status_distribution: countBy(records, "review_status"),
    reviewer_b_c_same_family_label_overrides: labelOverrideRecords,
    reviewer_b_c_high_confidence_consensus_overrides: highConfidenceOverrides,
    human_adjudication_queue_records: needsAdjudicationRecords,
    independent_reviewer_a_complete: false,
    human_reviewed: false,
    production_gold: false,
  };
  if (scopeKind === "bundle") {
    manifest.components = [
      {
        dataset_version: ENTERPRISE_VERSION,
        dataset_path: PATHS.enterpriseRevised,
        records: 8000,
        sha256: sha256(enterpriseText),
      },
      {
        dataset_version: PUBLIC_VERSION,
        dataset_path: PATHS.publicRevised,
        records: 7000,
        sha256: sha256(publicText),
      },
    ];
  }
  return manifest;
}

function buildReport({ publicRecords, bundleRecords, overrides, humanQueueIds, audit }) {
  const labelCounts = countBy(bundleRecords, "label");
  const publicLabelCounts = countBy(publicRecords, "label");
  const transitions = countBy(overrides, (row) => `${row.prior_candidate_label}_to_${row.revised_label}`);
  const languageLabels = nestedCounts(bundleRecords, "language", "label");
  const taskViolations = violatingSlices(bundleRecords, "task_type");
  const domainViolations = violatingSlices(bundleRecords, "service_domain");
  const lengthAuc = lengthOnlyRocAuc(bundleRecords);
  const humanMinimum = new Set(humanQueueIds);
  for (const record of bundleRecords) {
    if (record.source === "boundary" || record.split === "test") humanMinimum.add(record.sample_id);
  }
  return [
    "# Reviewer B/C GPT 합의 라벨 적용 보고서",
    "",
    `기준일은 2026-07-21이다. 같은 GPT 계열의 블라인드 1차(B)·정밀 2차(C)가 동일한 라벨을 냈고 기존 후보와 달랐던 3,215건을 현재 후보 라벨에 반영했다. 원본 15,000건은 리뷰 입력 증거로 보존하고, 수정본을 별도 dataset revision으로 생성한다.`,
    "",
    "## 적용 결과",
    "",
    "| 항목 | 건수 |",
    "|---|---:|",
    `| 전체 라벨 변경 | ${overrides.length.toLocaleString("en-US")} |`,
    `| Complex → Simple | ${(transitions.complex_to_simple ?? 0).toLocaleString("en-US")} |`,
    `| Simple → Complex | ${(transitions.simple_to_complex ?? 0).toLocaleString("en-US")} |`,
    "| B/C 모두 high, 기존 사람 queue 밖 | 1,401 |",
    "| 라벨은 변경했지만 사람 adjudication 유지 | 1,814 |",
    "| B/C 비교 전체 사람 adjudication queue | 2,249 |",
    "",
    `수정 후 공개 7,000건은 Simple ${publicLabelCounts.simple.toLocaleString("en-US")} / Complex ${publicLabelCounts.complex.toLocaleString("en-US")}이고, 전체 15,000건은 Simple ${labelCounts.simple.toLocaleString("en-US")} / Complex ${labelCounts.complex.toLocaleString("en-US")}이다. 요청대로 GPT 합의를 모두 반영했기 때문에 기존 50:50 후보 균형은 유지되지 않는다.`,
    "",
    "`automatic_label`은 최초 규칙 후보의 provenance로 보존한다. 변경된 3,215건만 `label_source=llm_same_family_consensus_candidate`로 기록한다. `label_confidence=0.9`는 B/C 모두 high이고 사람 요청 이력이 없는 1,401건, 나머지는 보수적으로 `0.5`다. 이 값은 보정된 확률이 아니라 workflow tier다.",
    "",
    "## 아직 남은 작업",
    "",
    "- Gemini Reviewer A의 독립 판정 3,650건은 아직 미수신이다. B/C는 같은 GPT 계열이므로 독립 리뷰어 두 명의 합의로 계산하지 않는다.",
    "- 현재 B/C 비교 기준 사람 adjudication queue는 2,249건이다. 라벨을 GPT 답으로 바꾼 3,215건 중에서도 1,814건은 이 queue에 남는다.",
    `- 기존 정책의 B/C queue, 모든 boundary record, 모든 Test record를 합친 최소 사람 검수 집합은 중복 제거 후 ${humanMinimum.size.toLocaleString("en-US")}건이다. 언어·작업·도메인·source별 무작위 품질 표본은 아직 더 정해야 한다.`,
    "- 전체 15,000건의 `human_reviewed`는 여전히 0건이며 dataset-owner 승격도 없다.",
    `- 현재 라벨은 Simple ${labelCounts.simple.toLocaleString("en-US")}건(${(labelCounts.simple / bundleRecords.length * 100).toFixed(1)}%) / Complex ${labelCounts.complex.toLocaleString("en-US")}건(${(labelCounts.complex / bundleRecords.length * 100).toFixed(1)}%)으로 class 재균형이 필요하다. 최초 \`automatic_label\`은 7,500/7,500으로 별도 보존된다.`,
    `- 길이 단독 ROC-AUC는 ${lengthAuc.toFixed(4)}로 0.60 상한을 다시 초과했다.`,
    `- 35~65% 라벨 비율을 벗어난 작업 유형은 ${taskViolations.length}개, 서비스 도메인은 ${domainViolations.length}개다.`,
    `- 영어는 Simple ${(languageLabels.en?.simple ?? 0).toLocaleString("en-US")} / Complex ${(languageLabels.en?.complex ?? 0).toLocaleString("en-US")}, 한영 혼합은 Simple ${(languageLabels.mixed?.simple ?? 0).toLocaleString("en-US")} / Complex ${(languageLabels.mixed?.complex ?? 0).toLocaleString("en-US")}로 GPT 판정의 언어별 편향을 별도 교정해야 한다.`,
    "- 직접 사람 작성 공개 Prompt는 2,674건으로 60% 목표보다 1,526건 부족하고, 승인된 실제 서비스 사용자 Prompt는 0건이다.",
    `- 수정 라벨 기준 embedding 의미 중복 재검사는 ${audit.verified ? "통과했다" : "아직 통과하지 않았다"}${audit.candidatePairs === null ? "" : ` (후보 ${audit.candidatePairs}쌍)`}.`,
    "- 따라서 수정본도 `training_eligible=false`이며 gold label이나 운영 승격 근거가 아니다.",
    "",
    "## 산출물",
    "",
    `- \`${PATHS.publicRevised}\``,
    `- \`${PATHS.enterpriseRevised}\` (라벨 변경 없음; 19건의 review status만 반영)`,
    `- \`${PATHS.bundleRevised}\``,
    `- \`${PATHS.overrides}\` (Prompt 원문 미포함)`,
    "",
  ].join("\n");
}

export function buildArtifacts() {
  const enterpriseText = read(PATHS.enterprise);
  const publicBaseText = read(PATHS.publicBase);
  const bundleBaseText = read(PATHS.bundleBase);
  const enterpriseRecords = parseJsonl(enterpriseText, PATHS.enterprise);
  const publicRecords = parseJsonl(publicBaseText, PATHS.publicBase);
  const bundleBaseRecords = parseJsonl(bundleBaseText, PATHS.bundleBase);
  const comparisons = parseJsonl(read(PATHS.comparison), PATHS.comparison);
  const enterpriseBaseManifest = JSON.parse(read(PATHS.enterpriseBaseManifest));
  const publicBaseManifest = JSON.parse(read(PATHS.publicBaseManifest));
  const bundleBaseManifest = JSON.parse(read(PATHS.bundleBaseManifest));
  if (enterpriseRecords.length !== 8000 || publicRecords.length !== 7000 || bundleBaseRecords.length !== 15000) {
    throw new Error("base dataset record count mismatch");
  }
  const expectedBaseIds = [...enterpriseRecords, ...publicRecords].map((record) => record.sample_id);
  if (JSON.stringify(expectedBaseIds) !== JSON.stringify(bundleBaseRecords.map((record) => record.sample_id))) {
    throw new Error("base bundle component order mismatch");
  }
  const { revisedRecords: publicRevisedRecords, overrides, humanQueueIds } = applyRecords(publicRecords, comparisons);
  const enterpriseRevisedRecords = enterpriseRecords.map((record) => ({
    ...record,
    dataset_version: ENTERPRISE_VERSION,
    review_status: humanQueueIds.has(record.sample_id) ? "needs_adjudication" : record.review_status,
  }));
  const enterpriseRevisedText = jsonl(enterpriseRevisedRecords);
  const publicRevisedText = jsonl(publicRevisedRecords);
  const bundleRevisedRecords = [...enterpriseRevisedRecords, ...publicRevisedRecords];
  const bundleRevisedText = jsonl(bundleRevisedRecords);
  const audit = auditState(sha256(bundleRevisedText));
  const enterpriseManifest = buildManifest({
    base: enterpriseBaseManifest,
    baseRecords: enterpriseRecords,
    records: enterpriseRevisedRecords,
    datasetPath: PATHS.enterpriseRevised,
    datasetVersion: ENTERPRISE_VERSION,
    datasetText: enterpriseRevisedText,
    scopeKind: "enterprise",
    enterpriseText: enterpriseRevisedText,
    publicText: publicRevisedText,
    audit,
  });
  const publicManifest = buildManifest({
    base: publicBaseManifest,
    baseRecords: publicRecords,
    records: publicRevisedRecords,
    datasetPath: PATHS.publicRevised,
    datasetVersion: PUBLIC_VERSION,
    datasetText: publicRevisedText,
    scopeKind: "public",
    enterpriseText: enterpriseRevisedText,
    publicText: publicRevisedText,
    audit,
  });
  const bundleManifest = buildManifest({
    base: bundleBaseManifest,
    baseRecords: bundleBaseRecords,
    records: bundleRevisedRecords,
    datasetPath: PATHS.bundleRevised,
    datasetVersion: BUNDLE_VERSION,
    datasetText: bundleRevisedText,
    scopeKind: "bundle",
    enterpriseText: enterpriseRevisedText,
    publicText: publicRevisedText,
    audit,
  });
  return {
    enterpriseRevisedRecords,
    publicRevisedRecords,
    bundleRevisedRecords,
    overrides,
    humanQueueIds,
    audit,
    outputs: new Map([
      [PATHS.enterpriseRevised, enterpriseRevisedText],
      [PATHS.enterpriseRevisedManifest, pretty(enterpriseManifest)],
      [PATHS.publicRevised, publicRevisedText],
      [PATHS.publicRevisedManifest, pretty(publicManifest)],
      [PATHS.bundleRevised, bundleRevisedText],
      [PATHS.bundleRevisedManifest, pretty(bundleManifest)],
      [PATHS.overrides, jsonl(overrides)],
      [PATHS.report, buildReport({ publicRecords: publicRevisedRecords, bundleRecords: bundleRevisedRecords, overrides, humanQueueIds, audit })],
    ]),
  };
}

export function verifyArtifacts(artifacts) {
  const failures = [];
  const { enterpriseRevisedRecords, publicRevisedRecords, bundleRevisedRecords, overrides, humanQueueIds } = artifacts;
  if (enterpriseRevisedRecords.length !== 8000) failures.push("revised enterprise record count must be 8000");
  if (publicRevisedRecords.length !== 7000) failures.push("revised public record count must be 7000");
  if (bundleRevisedRecords.length !== 15000) failures.push("revised bundle record count must be 15000");
  if (overrides.length !== 3215) failures.push("label override count must be 3215");
  if (humanQueueIds.size !== 2249) failures.push("B/C human queue count must be 2249");
  if (overrides.some((row) => "prompt" in row || "redacted_prompt" in row)) failures.push("override evidence must not contain Prompt text");
  const labels = countBy(bundleRevisedRecords, "label");
  if (labels.simple !== 9729 || labels.complex !== 5271) failures.push(`unexpected revised labels: ${JSON.stringify(labels)}`);
  const transitions = countBy(overrides, (row) => `${row.prior_candidate_label}_to_${row.revised_label}`);
  if (transitions.complex_to_simple !== 2722 || transitions.simple_to_complex !== 493) {
    failures.push(`unexpected label transitions: ${JSON.stringify(transitions)}`);
  }
  if (bundleRevisedRecords.some((record) => record.human_reviewed !== false)) failures.push("human_reviewed must remain false");
  if (countBy(enterpriseRevisedRecords, "review_status").needs_adjudication !== 19) failures.push("enterprise needs_adjudication must be 19");
  if (countBy(publicRevisedRecords, "review_status").needs_adjudication !== 2230) failures.push("public needs_adjudication must be 2230");
  if (countBy(bundleRevisedRecords, "review_status").needs_adjudication !== 2249) failures.push("bundle needs_adjudication must be 2249");
  if (countBy(bundleRevisedRecords, "label_source").llm_same_family_consensus_candidate !== 3215) {
    failures.push("LLM same-family label source count must be 3215");
  }
  const schema = JSON.parse(read("docs/routing/datasets/difficulty/schemas/difficulty-dataset-record.schema.json"));
  const allowedFields = new Set(Object.keys(schema.properties));
  const requiredFields = new Set(schema.required);
  const enumFields = Object.fromEntries(Object.entries(schema.properties)
    .filter(([, definition]) => Array.isArray(definition.enum))
    .map(([field, definition]) => [field, new Set(definition.enum)]));
  for (const record of bundleRevisedRecords) {
    const missing = [...requiredFields].filter((field) => !Object.hasOwn(record, field));
    const unexpected = Object.keys(record).filter((field) => !allowedFields.has(field));
    if (missing.length) failures.push(`${record.sample_id}: missing schema fields ${missing.join(",")}`);
    if (unexpected.length) failures.push(`${record.sample_id}: unexpected schema fields ${unexpected.join(",")}`);
    for (const [field, values] of Object.entries(enumFields)) {
      if (Object.hasOwn(record, field) && !values.has(record[field])) failures.push(`${record.sample_id}: invalid ${field}`);
    }
    if (record.label_source === "llm_same_family_consensus_candidate"
        && (record.source !== "public" || record.human_reviewed !== false
          || !["pending", "needs_adjudication"].includes(record.review_status))) {
      failures.push(`${record.sample_id}: invalid same-family LLM review state`);
    }
    if (failures.length > 100) break;
  }
  return failures;
}

function writeArtifacts(artifacts, checkOnly) {
  const failures = verifyArtifacts(artifacts);
  for (const [relativePath, expected] of artifacts.outputs) {
    const target = absolute(relativePath);
    if (checkOnly) {
      if (!existsSync(target)) failures.push(`${relativePath}: missing generated artifact`);
      else if (readFileSync(target, "utf8") !== expected) failures.push(`${relativePath}: generated artifact is stale`);
    } else {
      writeFileSync(target, expected, "utf8");
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const checkOnly = process.argv.includes("--check");
  const artifacts = buildArtifacts();
  writeArtifacts(artifacts, checkOnly);
  const labelCounts = countBy(artifacts.bundleRevisedRecords, "label");
  console.log(`reviewer B/C label application ${checkOnly ? "verification" : "generation"} passed.`);
  console.log(`label_overrides=${artifacts.overrides.length}`);
  console.log(`labels=${JSON.stringify(labelCounts)}`);
  console.log(`human_adjudication_queue=${artifacts.humanQueueIds.size}`);
  console.log(`semantic_dedup_verified=${artifacts.audit.verified}`);
}

export { PATHS };
