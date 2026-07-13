import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPath = "docs/v2.1.0/schemas/difficulty-evaluation-record.schema.json";
const fixturePath = "docs/v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl";
const activeSchemaVersion = "gatelm.difficulty-evaluation-record.v1";
const activeDifficulties = ["simple", "complex"];
const activeCategories = ["general", "code", "translation", "summarization", "reasoning"];
const pilotDatasetVersion = "difficulty_eval_2026_07_13_pilot_500_v1";
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

  for (const scoreField of ["expectedComplexityScore", "complexityScore"]) {
    if (scoreField in (schema?.properties ?? {})) {
      failures.push(`${schemaPath}: dataset ground truth must not define ${scoreField}`);
    }
  }
}

function validatePilotProfile(records, failures) {
  if (!records.some((record) => record?.datasetVersion === pilotDatasetVersion)) return;

  if (records.length !== 500) {
    failures.push(`${fixturePath}: pilot dataset must contain exactly 500 records, got ${records.length}`);
  }

  const sampleIds = new Set();
  const prompts = new Set();
  for (const record of records) {
    if (record.datasetVersion !== pilotDatasetVersion) {
      failures.push(`${fixturePath}: pilot dataset records must use datasetVersion=${pilotDatasetVersion}`);
    }
    if (sampleIds.has(record.sampleId)) {
      failures.push(`${fixturePath}: duplicate sampleId ${record.sampleId}`);
    }
    sampleIds.add(record.sampleId);
    if (prompts.has(record.redactedPrompt)) {
      failures.push(`${fixturePath}: duplicate redactedPrompt detected`);
    }
    prompts.add(record.redactedPrompt);
  }

  for (const category of activeCategories) {
    for (const difficulty of activeDifficulties) {
      const cellRecords = records.filter(
        (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
      );
      const cell = `${category}/${difficulty}`;
      if (cellRecords.length !== 50) {
        failures.push(`${fixturePath}: ${cell} must contain exactly 50 records, got ${cellRecords.length}`);
      }

      const boundaryCount = cellRecords.filter((record) => record.sampleId?.includes("_boundary_")).length;
      if (boundaryCount < 15) {
        failures.push(`${fixturePath}: ${cell} must contain at least 15 boundary records, got ${boundaryCount}`);
      }

      const expectedLanguageCounts = { ko: 30, en: 15, mixed: 5 };
      for (const [language, expectedCount] of Object.entries(expectedLanguageCounts)) {
        const actualCount = cellRecords.filter((record) => record.language === language).length;
        if (actualCount !== expectedCount) {
          failures.push(
            `${fixturePath}: ${cell} language=${language} must contain ${expectedCount} records, got ${actualCount}`,
          );
        }
      }

      const requiredProfiles = [
        "clear",
        "threshold",
        "taskcontrast",
        "constraintcontrast",
        "categoryconfusion",
        "negativecontext",
        difficulty === "simple" ? "longsimple" : "shortcomplex",
      ];
      for (const profile of requiredProfiles) {
        if (!cellRecords.some((record) => record.sampleId?.includes(`_${profile}_`))) {
          failures.push(`${fixturePath}: ${cell} must include profile=${profile}`);
        }
      }

      if (
        cellRecords.some(
          (record) => "expectedComplexityScore" in record || "complexityScore" in record,
        )
      ) {
        failures.push(`${fixturePath}: ${cell} must not contain a ground-truth complexity score`);
      }
    }
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

  const records = [];
  lines.forEach((line, index) => {
    try {
      const record = JSON.parse(line);
      records.push(record);
      validateRecord(schema, record, index + 1, failures);
    } catch (error) {
      failures.push(`${fixturePath}: line ${index + 1}: invalid JSON (${error.message})`);
    }
  });
  validatePilotProfile(records, failures);

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
