import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath =
  "docs/testing/routing/difficulty/fixtures/lightgbm-dimension-tuning-bridge.owner-approved-15000.config.json";
const configSchemaPath =
  "docs/testing/routing/difficulty/schemas/lightgbm-dimension-tuning-bridge-config.schema.json";
const evidenceSchemaPath =
  "docs/testing/routing/difficulty/schemas/lightgbm-dimension-tuning-final-evidence.schema.json";
const runbookPath =
  "docs/testing/routing/difficulty/lightgbm-dimension-tuning-bridge-runbook.md";
const moduleRoot = "scripts/routing_difficulty_model/gatelm_difficulty_model";
const outputRoot = path.join(
  root,
  "scripts/routing_difficulty_model/artifacts/lightgbm-dimension-tuning-owner-approved-500",
);
const expectedCandidates = new Map([
  ["rule_42_plus_e5_small_pca_64", 106],
  ["rule_42_plus_semantic_heads_12", 54],
  ["e5_base_raw_768", 768],
  ["rule_42_plus_e5_base_raw_768", 810],
]);
const failures = [];

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  const file = absolute(relativePath);
  if (!existsSync(file)) {
    failures.push(`${relativePath}: file is missing`);
    return "";
  }
  return readFileSync(file, "utf8");
}

function readJson(relativePath) {
  const text = read(relativePath);
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON (${error.message})`);
    return {};
  }
}

function outputJson(relativePath) {
  const file = path.join(outputRoot, relativePath);
  if (!existsSync(file)) {
    failures.push(`artifact ${relativePath}: file is missing`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`artifact ${relativePath}: invalid JSON (${error.message})`);
    return {};
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function verifyIdentity(identity, label) {
  if (
    !identity ||
    typeof identity.relativePath !== "string" ||
    !Number.isInteger(identity.sizeBytes) ||
    identity.sizeBytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(identity.sha256 ?? "")
  ) {
    failures.push(`${label}: artifact identity is invalid`);
    return;
  }
  const file = path.resolve(outputRoot, identity.relativePath);
  const relative = path.relative(outputRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    failures.push(`${label}: artifact path escapes the output root`);
    return;
  }
  if (!existsSync(file)) {
    failures.push(`${label}: artifact file is missing`);
    return;
  }
  if (statSync(file).size !== identity.sizeBytes || sha256(file) !== identity.sha256) {
    failures.push(`${label}: artifact size or hash mismatched`);
  }
}

const safeNegativeKeys = new Set([
  "containspromptmaterial",
  "containsembeddingmatrix",
  "containspersamplescore",
]);
const forbiddenKeyFragments = [
  "rawprompt",
  "rawresponse",
  "instructiontext",
  "payloadtext",
  "normalizedtext",
  "tokenid",
  "embeddingvalues",
  "trainingmatrix",
  "evaluationmatrix",
  "rawlogit",
  "sampleprobability",
  "samplescore",
  "featurecontribution",
  "treepath",
  "authorizationheader",
  "apikey",
  "providerkey",
  "actualsecret",
];

function normalizedKey(key) {
  return String(key).toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function scanAggregate(value, label) {
  if (Array.isArray(value)) {
    value.forEach((child) => scanAggregate(child, label));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (safeNegativeKeys.has(normalized)) {
      if (child !== false) failures.push(`${label}: ${key} must remain false`);
      continue;
    }
    if (forbiddenKeyFragments.some((fragment) => normalized.includes(fragment))) {
      failures.push(`${label}: forbidden aggregate key ${key}`);
    }
    scanAggregate(child, label);
  }
}

const configSchema = readJson(configSchemaPath);
const evidenceSchema = readJson(evidenceSchemaPath);
const config = readJson(configPath);
const runbook = read(runbookPath);
const pyproject = read("scripts/routing_difficulty_model/pyproject.toml");
const bridge = read(path.join(moduleRoot, "lightgbm_dimension_tuning_bridge.py"));
const cli = read(path.join(moduleRoot, "lightgbm_dimension_tuning_bridge_cli.py"));

if (
  configSchema.properties?.schemaVersion?.const !==
  "gatelm.lightgbm-dimension-tuning-bridge-config.v1"
) {
  failures.push(`${configSchemaPath}: config schema identity drifted`);
}
if (
  evidenceSchema.properties?.schemaVersion?.const !==
    "gatelm.lightgbm-dimension-tuning-final-evidence.v1" ||
  evidenceSchema.properties?.promotionState?.const !== "exploratory_only" ||
  evidenceSchema.properties?.runtimeProfileGenerated?.const !== false
) {
  failures.push(`${evidenceSchemaPath}: evidence boundary drifted`);
}
if (
  JSON.stringify(config.candidateOrder) !==
    JSON.stringify([...expectedCandidates.keys()]) ||
  JSON.stringify(config.split?.counts) !==
    JSON.stringify({ train: 10500, validation: 2250, test: 2250 }) ||
  config.search?.candidateCount !== 80 ||
  config.search?.selectedCFn !== 5
) {
  failures.push(`${configPath}: exact four-candidate tuning protocol drifted`);
}
if (!config.inputRoot?.startsWith(".tmp/") || !config.outputRoot?.startsWith("scripts/")) {
  failures.push(`${configPath}: safe input/output roots drifted`);
}
for (const command of [
  "prepare-inputs",
  "tune",
  "freeze",
  "evaluate-test",
  "render-report",
]) {
  if (!cli.includes(`"${command}"`) || !runbook.includes(` ${command}`)) {
    failures.push(`stage ${command}: CLI or runbook coverage is missing`);
  }
}
if (cli.includes("run-all") || cli.includes("all-in-one")) {
  failures.push("CLI: all-in-one Test execution is prohibited");
}
for (const required of [
  "TARGET_SPLIT_COUNTS = {\"train\": 10_500, \"validation\": 2_250, \"test\": 2_250}",
  "SELECTED_C_FN = 5.0",
  "frozen_search_candidates()",
  "test_loader=load_test_after_access_is_consumed",
]) {
  if (!bridge.includes(required)) {
    failures.push(`bridge protocol: missing ${required}`);
  }
}
if (
  !pyproject.includes(
    'gatelm-lightgbm-dimension-tuning = "gatelm_difficulty_model.lightgbm_dimension_tuning_bridge_cli:main"',
  )
) {
  failures.push("pyproject: dimension tuning CLI entrypoint is missing");
}

const input = outputJson("input-manifest.v1.json");
const tuning = outputJson("tuning-evidence.v1.json");
const freeze = outputJson("pretest-freeze.json");
const access = outputJson("test-access-consumed.json");
const test = outputJson("test-evidence.v1.json");
const final = outputJson("final-evidence.v1.json");
const reproducibility = outputJson("reproducibility-manifest.v1.json");

if (
  input.familyOverlap !== 0 ||
  input.partitions?.train?.records !== 350 ||
  input.partitions?.validation?.records !== 75 ||
  input.partitions?.test?.records !== 75 ||
  new Set([
    input.partitions?.train?.sha256,
    input.partitions?.validation?.sha256,
    input.partitions?.test?.sha256,
  ]).size !== 3
) {
  failures.push("input manifest: 350/75/75 family-disjoint evidence is invalid");
}
if (tuning.testOutcomeAccessed !== false || tuning.candidates?.length !== 4) {
  failures.push("tuning evidence: Test boundary or candidate count is invalid");
}
let sharedHyperparameterSet = null;
for (const [candidate, dimension] of expectedCandidates) {
  const row = tuning.candidates?.find((value) => value.featureCandidate === candidate);
  if (!row || row.dimension !== dimension) {
    failures.push(`${candidate}: tuning evidence dimension is invalid`);
    continue;
  }
  const search = row.hyperparameterSearch;
  if (
    search?.candidateCount !== 80 ||
    search?.completedFoldRuns !== 400 ||
    search?.results?.length !== 80
  ) {
    failures.push(`${candidate}: 80 x 5 search evidence is incomplete`);
  }
  if (sharedHyperparameterSet === null) sharedHyperparameterSet = search?.candidateSetSha256;
  if (search?.candidateSetSha256 !== sharedHyperparameterSet) {
    failures.push(`${candidate}: hyperparameter candidate set drifted`);
  }
  verifyIdentity(row.model, `${candidate} model`);
  verifyIdentity(row.calibrator, `${candidate} calibrator`);
  if (row.model?.relativePath) {
    const modelText = readFileSync(path.join(outputRoot, row.model.relativePath), "utf8");
    const featureIndex = modelText.match(/^max_feature_idx=(\d+)$/m);
    if (!featureIndex || Number(featureIndex[1]) + 1 !== dimension) {
      failures.push(`${candidate}: serialized model feature count is invalid`);
    }
  }
}

const selected = tuning.candidates?.find(
  (value) => value.featureCandidate === tuning.selectedFeatureCandidate,
);
if (!selected?.eligibleForSelection || selected.selectedScenario === null) {
  failures.push("tuning evidence: selected feature is not eligible");
}
if (
  freeze.frozenCandidates?.length !== 1 ||
  freeze.testAccessState !== "untouched" ||
  access.evaluatedCandidateCount !== 1 ||
  test.testAccess?.evaluatedCandidateCount !== 1 ||
  test.frozenSelection?.candidateId !== freeze.frozenCandidates?.[0]?.selectedCandidateId
) {
  failures.push("freeze/Test evidence: one-candidate one-time boundary is invalid");
}
if (
  final.status !== "executed" ||
  final.promotionState !== "exploratory_only" ||
  final.runtimeProfileGenerated !== false ||
  final.completedFoldRuns !== 1600 ||
  final.selectedFeatureCandidate !== tuning.selectedFeatureCandidate ||
  final.test?.selectedCandidateCount !== 1
) {
  failures.push("final evidence: aggregate execution summary is invalid");
}
if (
  reproducibility.schemaVersion !==
    "gatelm.lightgbm-dimension-tuning-reproducibility-manifest.v1" ||
  reproducibility.candidateArtifacts?.length !== 4
) {
  failures.push("reproducibility manifest: identity or candidate count is invalid");
}
for (const [name, identity] of Object.entries(reproducibility.featureArtifacts ?? {})) {
  verifyIdentity(identity, `feature artifact ${name}`);
}
for (const row of reproducibility.candidateArtifacts ?? []) {
  verifyIdentity(row.model, `reproducibility ${row.featureCandidate} model`);
  verifyIdentity(row.calibrator, `reproducibility ${row.featureCandidate} calibrator`);
}
for (const [name, identity] of Object.entries(reproducibility.stageEvidence ?? {})) {
  verifyIdentity(identity, `stage evidence ${name}`);
}

for (const file of readdirSync(outputRoot, { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith(".json")) continue;
  const fullPath = path.join(file.parentPath, file.name);
  try {
    scanAggregate(JSON.parse(readFileSync(fullPath, "utf8")), path.relative(outputRoot, fullPath));
  } catch (error) {
    failures.push(`${path.relative(outputRoot, fullPath)}: invalid JSON (${error.message})`);
  }
}

if (failures.length > 0) {
  console.error("LightGBM dimension tuning bridge verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("LightGBM dimension tuning bridge verification passed.");
