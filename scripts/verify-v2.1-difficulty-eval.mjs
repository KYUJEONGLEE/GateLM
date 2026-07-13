import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPath = "docs/v2.1.0/schemas/difficulty-evaluation-record.schema.json";
const fixturePath = "docs/v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl";
const trainingFixturePath =
  "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl";
const splitManifestPath = "docs/v2.1.0/fixtures/difficulty-training-split-manifest.v1.json";
const splitManifestSchemaPath =
  "docs/v2.1.0/schemas/difficulty-training-split-manifest.schema.json";
const modelArtifactSchemaPath = "docs/v2.1.0/schemas/difficulty-model-artifact.schema.json";
const trainingPolicyPath = "scripts/routing_difficulty_model/training-policy.v1.json";
const activeSchemaVersion = "gatelm.difficulty-evaluation-record.v1";
const activeDifficulties = ["simple", "complex"];
const requiredEvaluationFields = ["redactedPrompt", "expectedCategory", "expectedDifficulty", "language"];
const sensitiveStringPattern =
  /(sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]{12,}|-----BEGIN\s+(RSA|OPENSSH|EC|PRIVATE)\s+KEY-----)/i;

function readText(rootDir, relativePath, failures) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`);
    return null;
  }

  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    failures.push(`${relativePath}: unable to read file (${error.message})`);
    return null;
  }
}

function readJson(rootDir, relativePath, failures) {
  const text = readText(rootDir, relativePath, failures);
  if (text === null) return undefined;

  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function isJsonType(value, type) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

function validateProperty(propertySchema, value, jsonPath, failures) {
  if (propertySchema.type && !isJsonType(value, propertySchema.type)) {
    failures.push(`${jsonPath}: expected type ${propertySchema.type}`);
    return;
  }

  if ("const" in propertySchema && value !== propertySchema.const) {
    failures.push(`${jsonPath}: expected const ${JSON.stringify(propertySchema.const)}`);
  }

  if (propertySchema.enum && !propertySchema.enum.includes(value)) {
    failures.push(`${jsonPath}: expected one of ${JSON.stringify(propertySchema.enum)}`);
  }

  if (typeof value === "string") {
    if (propertySchema.minLength !== undefined && value.length < propertySchema.minLength) {
      failures.push(`${jsonPath}: expected minLength ${propertySchema.minLength}`);
    }
    if (propertySchema.maxLength !== undefined && value.length > propertySchema.maxLength) {
      failures.push(`${jsonPath}: expected maxLength ${propertySchema.maxLength}`);
    }
    if (propertySchema.pattern && !new RegExp(propertySchema.pattern).test(value)) {
      failures.push(`${jsonPath}: expected pattern ${propertySchema.pattern}`);
    }
    if (propertySchema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      failures.push(`${jsonPath}: expected date-time format`);
    }
    if (sensitiveStringPattern.test(value)) {
      failures.push(`${jsonPath}: forbidden secret-shaped string`);
    }
  }
}

function validateRecord(schema, record, lineNumber, failures, recordPath = fixturePath) {
  const prefix = `${recordPath}: line ${lineNumber}`;
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    failures.push(`${prefix}: expected JSON object`);
    return;
  }

  const properties = schema.properties ?? {};
  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in record)) {
      failures.push(`${prefix}: missing required property ${requiredKey}`);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (!(key in properties)) {
      if (schema.additionalProperties === false) {
        failures.push(`${prefix}: unexpected property ${key}`);
      }
      continue;
    }
    validateProperty(properties[key], value, `${prefix}.${key}`, failures);
  }

  if (record.source === "synthetic_fixture") {
    if (record.consentType !== "synthetic") {
      failures.push(`${prefix}: synthetic_fixture must use consentType=synthetic`);
    }
    if (record.labelSource !== "synthetic_fixture") {
      failures.push(`${prefix}: synthetic_fixture must use labelSource=synthetic_fixture`);
    }
  }
}

function validateSchemaShape(schema, failures) {
  if (schema?.properties?.schemaVersion?.const !== activeSchemaVersion) {
    failures.push(`${schemaPath}: schemaVersion const must be ${activeSchemaVersion}`);
  }

  if (schema.additionalProperties !== false) {
    failures.push(`${schemaPath}: top-level additionalProperties must be false`);
  }

  for (const field of requiredEvaluationFields) {
    if (!Array.isArray(schema.required) || !schema.required.includes(field)) {
      failures.push(`${schemaPath}: canonical difficulty schema must require ${field}`);
    }
  }

  const difficultyEnum = schema?.properties?.expectedDifficulty?.enum;
  if (
    !Array.isArray(difficultyEnum) ||
    difficultyEnum.length !== activeDifficulties.length ||
    !activeDifficulties.every((difficulty) => difficultyEnum.includes(difficulty))
  ) {
    failures.push(`${schemaPath}: expectedDifficulty enum must contain exactly simple,complex`);
  }
}

export function verifyDifficultyEvaluationDataset(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const failures = [];
  const schema = readJson(rootDir, schemaPath, failures);
  const fixtureText = readText(rootDir, fixturePath, failures);

  if (!schema || fixtureText === null) return failures;

  validateSchemaShape(schema, failures);

  const lines = fixtureText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    failures.push(`${fixturePath}: expected at least one JSONL record`);
  }

  lines.forEach((line, index) => {
    try {
      validateRecord(schema, JSON.parse(line), index + 1, failures);
    } catch (error) {
      failures.push(`${fixturePath}: line ${index + 1}: invalid JSON (${error.message})`);
    }
  });

  return failures;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function trainingFamilyId(sampleId) {
  const match =
    /^difficulty_(general|code|translation|summarization|reasoning)_(simple|complex)_.+_(f\d{2})_v\d{2}$/.exec(
      sampleId,
    );
  return match ? `${match[1]}/${match[3]}` : null;
}

export function verifyDifficultyTrainingPilot(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const failures = [];
  const schema = readJson(rootDir, schemaPath, failures);
  const fixtureText = readText(rootDir, trainingFixturePath, failures);
  const manifest = readJson(rootDir, splitManifestPath, failures);
  const manifestSchema = readJson(rootDir, splitManifestSchemaPath, failures);
  const artifactSchema = readJson(rootDir, modelArtifactSchemaPath, failures);
  const trainingPolicy = readJson(rootDir, trainingPolicyPath, failures);
  if (!schema || fixtureText === null || !manifest || !manifestSchema || !artifactSchema || !trainingPolicy) {
    return failures;
  }

  validateSchemaShape(schema, failures);
  const lines = fixtureText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const records = [];
  lines.forEach((line, index) => {
    try {
      const record = JSON.parse(line);
      records.push(record);
      validateRecord(schema, record, index + 1, failures, trainingFixturePath);
    } catch (error) {
      failures.push(`${trainingFixturePath}: line ${index + 1}: invalid JSON (${error.message})`);
    }
  });
  if (records.length !== 500) {
    failures.push(`${trainingFixturePath}: expected exactly 500 records, got ${records.length}`);
  }
  const datasetVersions = new Set(records.map((record) => record.datasetVersion));
  if (datasetVersions.size !== 1 || !datasetVersions.has("difficulty_eval_2026_07_13_pilot_500_v1")) {
    failures.push(`${trainingFixturePath}: unexpected datasetVersion set`);
  }
  if (new Set(records.map((record) => record.sampleId)).size !== records.length) {
    failures.push(`${trainingFixturePath}: sampleId values must be unique`);
  }
  if (new Set(records.map((record) => record.redactedPrompt)).size !== records.length) {
    failures.push(`${trainingFixturePath}: redactedPrompt values must be unique`);
  }

  const familySamples = new Map();
  for (const record of records) {
    const familyId = trainingFamilyId(record.sampleId);
    if (!familyId) {
      failures.push(`${trainingFixturePath}: invalid family sampleId ${record.sampleId}`);
      continue;
    }
    if (!familySamples.has(familyId)) familySamples.set(familyId, []);
    familySamples.get(familyId).push(record);
  }
  if (familySamples.size !== 25) {
    failures.push(`${trainingFixturePath}: expected 25 cross-label families, got ${familySamples.size}`);
  }
  for (const [familyId, samples] of familySamples) {
    const difficulties = new Set(samples.map((sample) => sample.expectedDifficulty));
    if (samples.length !== 20 || !difficulties.has("simple") || !difficulties.has("complex")) {
      failures.push(`${trainingFixturePath}: family ${familyId} must contain 20 simple/complex variants`);
    }
  }
  for (const category of ["general", "code", "translation", "summarization", "reasoning"]) {
    for (const difficulty of activeDifficulties) {
      const count = records.filter(
        (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
      ).length;
      if (count !== 50) {
        failures.push(`${trainingFixturePath}: ${category}/${difficulty} must contain 50 records`);
      }
    }
  }

  if (manifest.schemaVersion !== "gatelm.difficulty-training-split-manifest.v1") {
    failures.push(`${splitManifestPath}: unsupported schemaVersion`);
  }
  if (manifest.datasetVersion !== "difficulty_eval_2026_07_13_pilot_500_v1") {
    failures.push(`${splitManifestPath}: datasetVersion mismatch`);
  }
  const canonicalFixtureText = fixtureText.replace(/\r\n/g, "\n");
  if (manifest.datasetSha256 !== sha256(canonicalFixtureText)) {
    failures.push(`${splitManifestPath}: datasetSha256 mismatch`);
  }
  if (
    manifest.splitPolicyVersion !== "difficulty-family-split.v1" ||
    manifest.familyRuleVersion !== "difficulty-sample-family.v1"
  ) {
    failures.push(`${splitManifestPath}: split or family policy version mismatch`);
  }
  const assignments = Array.isArray(manifest.families) ? manifest.families : [];
  const assignmentMap = new Map(assignments.map((assignment) => [assignment.familyId, assignment.split]));
  if (assignments.length !== 25 || assignmentMap.size !== 25) {
    failures.push(`${splitManifestPath}: expected 25 unique family assignments`);
  }
  for (const familyId of familySamples.keys()) {
    if (!assignmentMap.has(familyId)) {
      failures.push(`${splitManifestPath}: missing family assignment ${familyId}`);
    }
  }
  const expectedSplitCounts = {
    train: { families: 15, samples: 300 },
    calibration: { families: 5, samples: 100 },
    holdout: { families: 5, samples: 100 },
  };
  for (const [split, expected] of Object.entries(expectedSplitCounts)) {
    const families = new Set(
      assignments.filter((assignment) => assignment.split === split).map((assignment) => assignment.familyId),
    );
    const samples = [...families].reduce(
      (total, familyId) => total + (familySamples.get(familyId)?.length ?? 0),
      0,
    );
    if (families.size !== expected.families || samples !== expected.samples) {
      failures.push(`${splitManifestPath}: ${split} split must contain ${expected.families} families/${expected.samples} samples`);
    }
  }

  if (
    manifestSchema?.properties?.schemaVersion?.const !==
      "gatelm.difficulty-training-split-manifest.v1" ||
    manifestSchema.additionalProperties !== false
  ) {
    failures.push(`${splitManifestSchemaPath}: closed v1 manifest schema is required`);
  }
  const calibratorBranches = artifactSchema?.properties?.calibrator?.oneOf;
  const calibratorFields = {
    platt: ["type", "input", "coefficient", "intercept"],
    isotonic: ["type", "input", "xThresholds", "yThresholds"],
  };
  const calibratorShapeIsCanonical =
    Array.isArray(calibratorBranches) &&
    calibratorBranches.length === 2 &&
    calibratorBranches.every((branch) => {
      const type = branch?.properties?.type?.const;
      const expectedFields = calibratorFields[type];
      return (
        expectedFields !== undefined &&
        branch.additionalProperties === false &&
        JSON.stringify(Object.keys(branch.properties ?? {}).sort()) === JSON.stringify([...expectedFields].sort()) &&
        JSON.stringify([...(branch.required ?? [])].sort()) === JSON.stringify([...expectedFields].sort())
      );
    }) &&
    !Object.hasOwn(artifactSchema?.properties ?? {}, "calibratorType");
  const isotonicBranch = calibratorBranches?.find(
    (branch) => branch?.properties?.type?.const === "isotonic",
  );
  const isotonicStepShapeIsCanonical =
    isotonicBranch?.properties?.xThresholds?.minItems === 1 &&
    isotonicBranch?.properties?.yThresholds?.minItems === 1 &&
    isotonicBranch?.properties?.xThresholds?.description?.includes("inclusive lower") &&
    isotonicBranch?.properties?.xThresholds?.description?.includes("floor lookup") &&
    isotonicBranch?.properties?.yThresholds?.description?.includes("PAVA block");
  const calibrationPolicy = trainingPolicy?.calibration;
  const isotonicPolicyIsCanonical =
    JSON.stringify(calibrationPolicy?.candidates) === JSON.stringify(["platt", "isotonic"]) &&
    JSON.stringify(calibrationPolicy?.simplicityOrder) === JSON.stringify(["platt", "isotonic"]) &&
    calibrationPolicy?.tieTolerance === 0.000001 &&
    JSON.stringify(calibrationPolicy?.isotonic) ===
      JSON.stringify({
        algorithm: "pava",
        tieGrouping: "exact_float64",
        weighting: "sample_count",
        lookup: "inclusive_lower_floor",
        outOfBounds: "clip",
        smallBlockMerge: "disabled",
      });
  if (
    artifactSchema?.properties?.schemaVersion?.const !== "gatelm.difficulty-model-artifact.v1" ||
    artifactSchema?.properties?.featureVersion?.const !== "difficulty-feature-vector.v1" ||
    artifactSchema?.properties?.threshold?.const !== 0.45 ||
    artifactSchema.additionalProperties !== false ||
    !calibratorShapeIsCanonical ||
    !isotonicStepShapeIsCanonical ||
    !isotonicPolicyIsCanonical
  ) {
    failures.push(
      `${modelArtifactSchemaPath} and ${trainingPolicyPath}: closed v1 artifact schema with threshold 0.45, nested Platt/Isotonic calibrators, and exact single-block PAVA floor-lookup policy is required`,
    );
  }
  return failures;
}

function main() {
  const failures = [
    ...verifyDifficultyEvaluationDataset(),
    ...verifyDifficultyTrainingPilot(),
  ];
  if (failures.length > 0) {
    console.error("v2.1 difficulty evaluation verification failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log("v2.1 difficulty evaluation verification passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
