import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPath = "docs/v2.1.0/schemas/difficulty-evaluation-record.schema.json";
const fixturePath = "docs/v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl";
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

function validateRecord(schema, record, lineNumber, failures) {
  const prefix = `${fixturePath}: line ${lineNumber}`;
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

function main() {
  const failures = verifyDifficultyEvaluationDataset();
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
