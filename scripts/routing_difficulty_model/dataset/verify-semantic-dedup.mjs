import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const resolveRepoPath = (relativePath) => path.join(rootDir, ...relativePath.split("/"));
const datasetPath = "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.jsonl";
const manifestPath = "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.manifest.json";
const auditPath = "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.semantic-dedup.json";
const remediationPath = "scripts/routing_difficulty_model/dataset/semantic-dedup-remediation.v1.json";
const expectedModel = {
  model_id: "intfloat/multilingual-e5-small",
  revision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
  onnx_sha256: "a374ca7b87cdafc3c2a4b8b3c7db4a6500803ced02c750351d5fa80f60e94a94",
};

const failures = [];
const datasetBytes = readFileSync(resolveRepoPath(datasetPath));
const datasetText = datasetBytes.toString("utf8");
const records = datasetText.trim().split(/\r?\n/).map(JSON.parse);
const manifest = JSON.parse(readFileSync(resolveRepoPath(manifestPath), "utf8"));
const audit = JSON.parse(readFileSync(resolveRepoPath(auditPath), "utf8"));
const remediation = JSON.parse(readFileSync(resolveRepoPath(remediationPath), "utf8"));
const datasetSha256 = createHash("sha256").update(datasetBytes).digest("hex");
const recordsById = new Map(records.map((record) => [record.sample_id, record]));

if (audit.schema_version !== "gatelm.routing-difficulty-semantic-dedup-audit.v1") {
  failures.push(`audit schema: unexpected ${audit.schema_version}`);
}
if (audit.dataset?.path !== datasetPath) failures.push("audit dataset path mismatch");
if (audit.dataset?.sha256 !== datasetSha256) failures.push("audit dataset SHA-256 mismatch");
if (manifest.dataset_sha256 !== datasetSha256) failures.push("bundle manifest dataset SHA-256 mismatch");
if (audit.dataset?.record_count !== 15000 || records.length !== 15000) failures.push("audit record count must be 15000");
for (const [field, expected] of Object.entries(expectedModel)) {
  if (audit.encoder?.[field] !== expected) failures.push(`audit encoder ${field} mismatch`);
}
if (audit.encoder?.embedding_dimension !== 384 || audit.encoder?.maximum_token_length !== 128) {
  failures.push("audit encoder shape or truncation policy mismatch");
}
if (audit.execution?.embeddings_persisted !== false || audit.execution?.prompt_text_persisted !== false) {
  failures.push("audit must not persist prompt text or embeddings");
}
if (audit.execution?.similarity !== "cosine_on_l2_normalized_native_e5_embeddings") {
  failures.push("audit similarity policy mismatch");
}
if (audit.calibration?.threshold !== 0.985) failures.push("audit threshold must be 0.985");
if (audit.calibration?.precision_at_threshold < 0.95 || audit.calibration?.precision_requirement_met !== true) {
  failures.push("audit calibration precision guardrail failed");
}
if (audit.result?.semantic_duplicate_candidate_pairs !== 0) failures.push("semantic duplicate candidates remain");
if (audit.result?.clusters !== 0 || audit.result?.split_conflict_clusters !== 0) {
  failures.push("semantic duplicate clusters or split conflicts remain");
}
if (audit.result?.semantic_duplicate_guardrail_met !== true) failures.push("semantic duplicate guardrail is not met");

for (const pair of audit.pairs ?? []) {
  const left = recordsById.get(pair.left_sample_id);
  const right = recordsById.get(pair.right_sample_id);
  if (!left || !right) {
    failures.push(`audit pair references an unknown sample: ${pair.left_sample_id}/${pair.right_sample_id}`);
    continue;
  }
  if (pair.similarity < audit.calibration.threshold) failures.push("audit pair is below the declared threshold");
  const sameLabel = left.label === right.label;
  const sameTask = left.task_type === right.task_type;
  const sameDomain = left.service_domain === right.service_domain;
  const sameSplit = left.split === right.split;
  if (pair.same_label !== sameLabel || pair.same_task_type !== sameTask
      || pair.same_service_domain !== sameDomain || pair.same_split !== sameSplit) {
    failures.push(`audit pair metadata mismatch: ${pair.left_sample_id}/${pair.right_sample_id}`);
  }
  if (sameLabel && sameTask && sameDomain) {
    failures.push(`audit contains an unresolved semantic duplicate candidate: ${pair.left_sample_id}/${pair.right_sample_id}`);
  }
}
if ((audit.pairs ?? []).length !== audit.result?.observed_cross_group_pairs_at_or_above_threshold) {
  failures.push("audit observed pair count mismatch");
}
if ((audit.clusters ?? []).length !== 0) failures.push("audit cluster list must be empty after remediation");

if (manifest.coverage?.semantic_embedding_dedup_verified !== true
    || manifest.coverage?.semantic_embedding_dedup_threshold !== 0.985
    || manifest.coverage?.semantic_embedding_dedup_audit_path !== auditPath) {
  failures.push("bundle manifest semantic dedup evidence mismatch");
}
for (const resolvedBlocker of [
  "task_type_strict_900_record_cap_not_met_by_approved_public_pool",
  "service_domain_strict_12_5_percent_cap_not_met_by_approved_public_pool",
  "public_top_five_task_share_above_strict_55_percent_target",
  "semantic_embedding_dedup_not_completed",
]) {
  if (manifest.scope?.training_blockers?.includes(resolvedBlocker)) {
    failures.push(`resolved blocker remains in manifest: ${resolvedBlocker}`);
  }
}

if (remediation.schema_version !== "gatelm.routing-difficulty-semantic-dedup-remediation.v1") {
  failures.push("semantic remediation schema mismatch");
}
for (const field of [
  "excluded_public_sample_ids",
  "diversified_enterprise_sample_ids",
  "alternative_enterprise_sample_ids",
]) {
  const values = remediation[field] ?? [];
  if (new Set(values).size !== values.length) failures.push(`${field}: duplicate remediation IDs`);
}
for (const sampleId of remediation.excluded_public_sample_ids ?? []) {
  if (recordsById.has(sampleId)) failures.push(`excluded public sample remains selected: ${sampleId}`);
}

if (failures.length) {
  console.error("routing difficulty semantic dedup verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("routing difficulty semantic dedup verification passed.");
console.log(`dataset_sha256=${datasetSha256}`);
console.log(`threshold=${audit.calibration.threshold}`);
console.log(`calibration_precision=${audit.calibration.precision_at_threshold}`);
console.log(`observed_contrast_pairs=${audit.result.observed_cross_group_pairs_at_or_above_threshold}`);
console.log(`semantic_duplicate_candidate_pairs=${audit.result.semantic_duplicate_candidate_pairs}`);
