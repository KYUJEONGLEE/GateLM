import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetRelative =
  "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.owner-approved.jsonl";
const manifestRelative =
  "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.owner-approved.manifest.json";
const datasetPath = path.join(root, datasetRelative);
const manifestPath = path.join(root, manifestRelative);
const failures = [];

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const datasetBytes = readFileSync(datasetPath);
const datasetHash = createHash("sha256").update(datasetBytes).digest("hex");
const records = datasetBytes
  .toString("utf8")
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const splitCounts = { train: 0, validation: 0, test: 0 };
for (const record of records) {
  if (record.human_reviewed !== true || record.review_status !== "approved") {
    failures.push(`${record.sample_id}: record is not owner-approved`);
    break;
  }
  if (!(record.split in splitCounts)) {
    failures.push(`${record.sample_id}: invalid canonical split`);
    break;
  }
  splitCounts[record.split] += 1;
}
if (
  records.length !== 15000 ||
  manifest.dataset_path !== datasetRelative ||
  manifest.dataset_sha256 !== datasetHash ||
  manifest.counts?.records !== 15000 ||
  manifest.scope?.training_eligible !== true ||
  manifest.review?.production_gold !== true ||
  manifest.review?.human_reviewed !== true ||
  JSON.stringify(splitCounts) !==
    JSON.stringify({ train: 10500, validation: 2250, test: 2250 })
) {
  failures.push("canonical 15,000-record dataset identity or approval state is invalid");
}

const activeModules = [
  "canonical_dataset.py",
  "cli.py",
  "semantic_heads_cli.py",
  "candidate_cli.py",
  "e5_encoder_cli.py",
  "calibration_feasibility_cli.py",
  "threshold_candidate_cli.py",
  "lightgbm_input_ablation_cli.py",
  "lightgbm_four_way_cli.py",
  "lightgbm_dimension_tuning_bridge.py",
  "lightgbm_embedding_experiment_cli.py",
];
const moduleRoot = path.join(
  root,
  "scripts/routing_difficulty_model/gatelm_difficulty_model",
);
const forbiddenDatasetMarkers = [
  "owner-approved-500",
  "difficulty-training-candidate-500.owner-approved",
  "difficulty-training-candidate-expansion-2000.owner-approved",
  "difficulty-model-path-5000.owner-approved",
  "difficulty-evaluation-training-pilot-500",
  "enterprise-synthetic-8000.owner-approved",
  "public-prompts-7000.owner-approved",
];
for (const name of activeModules) {
  const text = readFileSync(path.join(moduleRoot, name), "utf8");
  for (const marker of forbiddenDatasetMarkers) {
    if (text.includes(marker)) failures.push(`${name}: active code references ${marker}`);
  }
}

const config = JSON.parse(
  readFileSync(
    path.join(
      root,
      "docs/testing/routing/difficulty/fixtures/lightgbm-dimension-tuning-bridge.owner-approved-15000.config.json",
    ),
    "utf8",
  ),
);
if (
  config.dataset?.path !== datasetRelative ||
  config.dataset?.manifestPath !== manifestRelative ||
  JSON.stringify(config.split?.counts) !==
    JSON.stringify({ train: 10500, validation: 2250, test: 2250 })
) {
  failures.push("active LightGBM tuning config is not locked to the canonical dataset");
}

const pyproject = readFileSync(
  path.join(root, "scripts/routing_difficulty_model/pyproject.toml"),
  "utf8",
);
if (
  pyproject.includes("gatelm-train-difficulty-model-path-5000") ||
  pyproject.includes("gatelm-gateway-holdout-reference") ||
  !pyproject.includes("gatelm-replay-historical-difficulty-model-path-5000") ||
  !pyproject.includes("gatelm-replay-historical-gateway-holdout")
) {
  failures.push("legacy Dataset 1/2 commands are not isolated as historical replays");
}

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
for (const name of Object.keys(packageJson.scripts ?? {})) {
  if (
    name.startsWith("v2.1:routing:") &&
    /(training-pilot|training-candidate|model-path|expansion)/u.test(name)
  ) {
    failures.push(`${name}: legacy dataset mutation command must be historical-only`);
  }
}

if (failures.length > 0) {
  throw new Error(`routing experiment dataset verification failed:\n- ${failures.join("\n- ")}`);
}
console.log(
  `routing experiments are locked to ${records.length} canonical owner-approved records (${datasetHash})`,
);
