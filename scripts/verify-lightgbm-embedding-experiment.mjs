import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configSchemaPath =
  "docs/testing/routing/difficulty/schemas/lightgbm-embedding-experiment-config.schema.json";
const evidenceSchemaPath =
  "docs/testing/routing/difficulty/schemas/lightgbm-embedding-aggregate-evidence.schema.json";
const pyprojectPath = "scripts/routing_difficulty_model/pyproject.toml";
const moduleRoot =
  "scripts/routing_difficulty_model/gatelm_difficulty_model";
const requiredModules = [
  "lightgbm_embedding_experiment.py",
  "lightgbm_embedding_search.py",
  "lightgbm_embedding_calibration.py",
  "lightgbm_embedding_artifacts.py",
  "lightgbm_embedding_reporting.py",
  "lightgbm_embedding_experiment_cli.py",
];
const requiredCommands = [
  "validate",
  "tune",
  "prepare-freeze",
  "freeze",
  "evaluate-test",
  "render-report",
];

const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
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

const configSchema = readJson(configSchemaPath);
const evidenceSchema = readJson(evidenceSchemaPath);
if (configSchema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
  failures.push(`${configSchemaPath}: Draft 2020-12 is required`);
}
if (
  configSchema.properties?.schemaVersion?.const !==
  "gatelm.lightgbm-embedding-experiment-config.v1"
) {
  failures.push(`${configSchemaPath}: config schema identity drifted`);
}
if (
  evidenceSchema.properties?.schemaVersion?.const !==
    "gatelm.lightgbm-embedding-aggregate-evidence.v1" ||
  evidenceSchema.properties?.promotionState?.const !== "exploratory_only" ||
  evidenceSchema.properties?.runtimeProfileGenerated?.const !== false ||
  evidenceSchema.properties?.containsEmbeddingMatrix?.const !== false ||
  evidenceSchema.properties?.containsPerSampleScore?.const !== false
) {
  failures.push(`${evidenceSchemaPath}: aggregate-only boundary drifted`);
}

const pyproject = read(pyprojectPath);
if (
  !pyproject.includes(
    'gatelm-lightgbm-embedding-experiment = "gatelm_difficulty_model.lightgbm_embedding_experiment_cli:main"',
  )
) {
  failures.push(`${pyprojectPath}: offline CLI entrypoint is missing`);
}
if (!pyproject.includes('"lightgbm==4.6.0"')) {
  failures.push(`${pyprojectPath}: exact LightGBM dependency is missing`);
}

for (const moduleName of requiredModules) {
  read(path.join(moduleRoot, moduleName));
}
const cli = read(path.join(moduleRoot, "lightgbm_embedding_experiment_cli.py"));
for (const command of requiredCommands) {
  if (!cli.includes(`"${command}"`)) {
    failures.push(`CLI: ${command} stage is missing`);
  }
}
if (cli.includes("import_module(") || cli.includes("pip install") || cli.includes("http://")) {
  failures.push("CLI: dynamic import, runtime install, or network URL is prohibited");
}

const search = read(path.join(moduleRoot, "lightgbm_embedding_search.py"));
for (const expected of [
  "FINAL_CANDIDATE_COUNT = 80",
  "SEARCH_NUM_BOOST_ROUND = 3000",
  "SEARCH_EARLY_STOPPING_ROUNDS = 100",
  '"num_threads": 1',
  '"deterministic": True',
]) {
  if (!search.includes(expected)) {
    failures.push(`search protocol: missing ${expected}`);
  }
}

const calibration = read(path.join(moduleRoot, "lightgbm_embedding_calibration.py"));
for (const expected of [
  'CALIBRATOR_NAMES = ("none", "platt", "isotonic")',
  "C_FN_SCENARIOS = (1.0, 3.0, 5.0, 10.0)",
  "MIN_COMPLEX_RECALL = 0.95",
  "np.nextafter",
]) {
  if (!calibration.includes(expected)) {
    failures.push(`calibration protocol: missing ${expected}`);
  }
}

if (failures.length > 0) {
  console.error("LightGBM embedding experiment verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("LightGBM embedding experiment verification passed.");
