import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const PATHS = Object.freeze({
  enterpriseBase: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-e-risk-revised.jsonl",
  enterpriseBaseManifest: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-e-risk-revised.manifest.json",
  publicBase: "docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-e-risk-revised.jsonl",
  publicBaseManifest: "docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-e-risk-revised.manifest.json",
  bundleBase: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-e-risk-revised.jsonl",
  bundleBaseManifest: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-e-risk-revised.manifest.json",
  approval: "docs/routing/datasets/difficulty/reviews/human/dataset-owner-full-review-attestation.json",
  enterpriseApproved: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.owner-approved.jsonl",
  enterpriseApprovedManifest: "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.owner-approved.manifest.json",
  publicApproved: "docs/routing/datasets/difficulty/data/public-prompts-7000.owner-approved.jsonl",
  publicApprovedManifest: "docs/routing/datasets/difficulty/data/public-prompts-7000.owner-approved.manifest.json",
  bundleApproved: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.owner-approved.jsonl",
  bundleApprovedManifest: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.owner-approved.manifest.json",
  semanticAudit: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.owner-approved.semantic-dedup.json",
  report: "docs/routing/datasets/difficulty/reviews/human/dataset-owner-training-promotion-report.md",
});

const VERSIONS = Object.freeze({
  enterprise: "routing_difficulty_enterprise_synthetic_8000_owner_approved_2026_07_22",
  public: "routing_difficulty_public_prompts_7000_owner_approved_2026_07_22",
  bundle: "routing_difficulty_initial_15000_owner_approved_2026_07_22",
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

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) counts[row[field]] = (counts[row[field]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function projectionSha(rows) {
  return sha256(jsonl(rows.map((row) => ({
    sample_id: row.sample_id,
    group_id: row.group_id,
    redacted_prompt: row.redacted_prompt,
    label: row.label,
    split: row.split,
    label_source: row.label_source,
  }))));
}

function auditState(datasetSha) {
  if (!existsSync(absolute(PATHS.semanticAudit))) return { verified: false, candidatePairs: null, reason: "owner_approved_semantic_audit_pending" };
  const audit = JSON.parse(read(PATHS.semanticAudit));
  if (audit.dataset?.sha256 !== datasetSha || audit.dataset?.record_count !== 15000) return { verified: false, candidatePairs: null, reason: "owner_approved_semantic_audit_hash_mismatch" };
  const candidatePairs = audit.result?.semantic_duplicate_candidate_pairs;
  const verified = audit.result?.semantic_duplicate_guardrail_met === true && candidatePairs === 0;
  return { verified, candidatePairs, reason: verified ? null : "owner_approved_semantic_candidates_remain" };
}

function approveRows(rows, datasetVersion) {
  return rows.map((row) => ({
    ...row,
    dataset_version: datasetVersion,
    human_reviewed: true,
    review_status: "approved",
  }));
}

function buildManifest({ base, baseRows, rows, datasetPath, datasetVersion, datasetText, kind, enterpriseText, publicText, approval, audit }) {
  const manifest = structuredClone(base);
  manifest.dataset_version = datasetVersion;
  manifest.dataset_path = datasetPath;
  manifest.dataset_sha256 = sha256(datasetText);
  manifest.generated_at = GENERATED_AT;
  manifest.scope.training_eligible = audit.verified;
  manifest.scope.training_blockers = audit.verified ? [] : [audit.reason];
  manifest.counts.human_reviewed_records = rows.length;
  manifest.distributions.review_status = { approved: rows.length };
  manifest.distributions.label_source = countBy(rows, "label_source");
  manifest.coverage = {
    ...base.coverage,
    reviewer_e_needs_human_adjudication_records: 0,
    total_needs_adjudication_records: 0,
    dataset_owner_full_review_complete: true,
    dataset_owner_approved_records: rows.length,
    owner_approval_attestation_path: PATHS.approval,
    accepted_known_limitations: approval.accepted_known_limitations,
    base_owner_approval_projection_sha256: projectionSha(baseRows),
    approved_owner_projection_sha256: projectionSha(rows),
    semantic_embedding_dedup_audit_path: PATHS.semanticAudit,
    semantic_embedding_dedup_verified: audit.verified,
  };
  manifest.deduplication = {
    ...base.deduplication,
    semantic_duplicate_candidate_pairs: audit.candidatePairs,
  };
  manifest.review = {
    ...base.review,
    label_source_distribution: countBy(rows, "label_source"),
    review_status_distribution: { approved: rows.length },
    human_reviewed: true,
    production_gold: true,
    training_eligible: audit.verified,
    runtime_promotion_authorized: false,
    dataset_owner_full_review_complete: true,
    dataset_owner_approved_records: rows.length,
    owner_approval_attestation_path: PATHS.approval,
    accepted_known_limitations: approval.accepted_known_limitations,
  };
  if (kind === "bundle") manifest.components = [
    { dataset_version: VERSIONS.enterprise, dataset_path: PATHS.enterpriseApproved, records: 8000, sha256: sha256(enterpriseText) },
    { dataset_version: VERSIONS.public, dataset_path: PATHS.publicApproved, records: 7000, sha256: sha256(publicText) },
  ];
  return manifest;
}

function buildReport({ rows, approval, audit }) {
  const labels = countBy(rows, "label");
  return [
    "# Dataset owner 전수 검수 및 학습 승격 보고서",
    "",
    "2026-07-22 dataset owner가 Reviewer E 위험 회피형 revision 15,000건을 전수 검수하고 현재 라벨을 승인했다.",
    "",
    `- 승인 record: ${rows.length.toLocaleString("en-US")}건`,
    `- 승인 라벨: Simple ${labels.simple.toLocaleString("en-US")} / Complex ${labels.complex.toLocaleString("en-US")}`,
    "- 모든 record: `human_reviewed=true`, `review_status=approved`",
    `- semantic audit: ${audit.verified ? "통과, 후보 0쌍" : `미완료(${audit.reason})`}`,
    `- training eligibility: ${audit.verified ? "true" : "false"}`,
    "- runtime promotion authorization: false",
    "",
    `승인 근거는 \`${PATHS.approval}\`에 Prompt 없이 기록했다.`,
    "",
    "다음 알려진 한계는 dataset owner가 학습 사용 시 수용했지만 해소된 것으로 표시하지 않는다.",
    "",
    ...approval.accepted_known_limitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export function buildArtifacts() {
  const enterpriseBaseText = read(PATHS.enterpriseBase);
  const publicBaseText = read(PATHS.publicBase);
  const bundleBaseText = read(PATHS.bundleBase);
  const enterpriseBaseRows = parseJsonl(enterpriseBaseText, PATHS.enterpriseBase);
  const publicBaseRows = parseJsonl(publicBaseText, PATHS.publicBase);
  const bundleBaseRows = parseJsonl(bundleBaseText, PATHS.bundleBase);
  const approval = JSON.parse(read(PATHS.approval));
  if (sha256(bundleBaseText) !== approval.reviewed_dataset_sha256) throw new Error("owner approval dataset hash mismatch");
  if (approval.reviewed_records !== 15000 || approval.decision?.approve_all_current_labels !== true || approval.decision?.training_eligible !== true) throw new Error("owner approval scope mismatch");
  if (enterpriseBaseRows.length !== 8000 || publicBaseRows.length !== 7000 || bundleBaseRows.length !== 15000) throw new Error("base record count mismatch");
  if (JSON.stringify([...enterpriseBaseRows, ...publicBaseRows].map((row) => row.sample_id)) !== JSON.stringify(bundleBaseRows.map((row) => row.sample_id))) throw new Error("base component order mismatch");

  const enterpriseRows = approveRows(enterpriseBaseRows, VERSIONS.enterprise);
  const publicRows = approveRows(publicBaseRows, VERSIONS.public);
  const rows = [...enterpriseRows, ...publicRows];
  const enterpriseText = jsonl(enterpriseRows);
  const publicText = jsonl(publicRows);
  const datasetText = jsonl(rows);
  const audit = auditState(sha256(datasetText));
  const enterpriseManifest = buildManifest({ base: JSON.parse(read(PATHS.enterpriseBaseManifest)), baseRows: enterpriseBaseRows, rows: enterpriseRows, datasetPath: PATHS.enterpriseApproved, datasetVersion: VERSIONS.enterprise, datasetText: enterpriseText, kind: "enterprise", enterpriseText, publicText, approval, audit });
  const publicManifest = buildManifest({ base: JSON.parse(read(PATHS.publicBaseManifest)), baseRows: publicBaseRows, rows: publicRows, datasetPath: PATHS.publicApproved, datasetVersion: VERSIONS.public, datasetText: publicText, kind: "public", enterpriseText, publicText, approval, audit });
  const bundleManifest = buildManifest({ base: JSON.parse(read(PATHS.bundleBaseManifest)), baseRows: bundleBaseRows, rows, datasetPath: PATHS.bundleApproved, datasetVersion: VERSIONS.bundle, datasetText, kind: "bundle", enterpriseText, publicText, approval, audit });
  return {
    baseRows: bundleBaseRows,
    enterpriseRows,
    publicRows,
    rows,
    approval,
    audit,
    bundleManifest,
    outputs: new Map([
      [PATHS.enterpriseApproved, enterpriseText],
      [PATHS.enterpriseApprovedManifest, pretty(enterpriseManifest)],
      [PATHS.publicApproved, publicText],
      [PATHS.publicApprovedManifest, pretty(publicManifest)],
      [PATHS.bundleApproved, datasetText],
      [PATHS.bundleApprovedManifest, pretty(bundleManifest)],
      [PATHS.report, buildReport({ rows, approval, audit })],
    ]),
  };
}

export function verifyArtifacts(artifacts) {
  const failures = [];
  const { baseRows, enterpriseRows, publicRows, rows, approval, audit, bundleManifest } = artifacts;
  if (enterpriseRows.length !== 8000 || publicRows.length !== 7000 || rows.length !== 15000) failures.push("record count mismatch");
  if (rows.some((row) => row.human_reviewed !== true || row.review_status !== "approved")) failures.push("not every record is human approved");
  if (countBy(rows, "label").simple !== 6576 || countBy(rows, "label").complex !== 8424) failures.push("label distribution changed");
  const projection = (records) => records.map((row) => [row.sample_id, row.redacted_prompt, row.label, row.group_id, row.split, row.label_source]);
  if (JSON.stringify(projection(rows)) !== JSON.stringify(projection(baseRows))) failures.push("Prompt, label, group, split, or label source changed");
  if (approval.reviewed_records !== rows.length || approval.decision.human_reviewed !== true || approval.decision.review_status !== "approved") failures.push("approval attestation mismatch");
  if (audit.verified) {
    if (bundleManifest.scope.training_eligible !== true || bundleManifest.scope.training_blockers.length !== 0) failures.push("verified owner dataset is not training eligible");
    if (bundleManifest.review.production_gold !== true || bundleManifest.review.human_reviewed !== true) failures.push("owner approval review state mismatch");
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
  console.log(`Owner-approved dataset ${checkOnly ? "verification" : "generation"} passed.`);
  console.log(`human_reviewed=${artifacts.rows.filter((row) => row.human_reviewed).length}`);
  console.log(`training_eligible=${artifacts.bundleManifest.scope.training_eligible}`);
}
