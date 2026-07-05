import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPath = "docs/drafts/gateway-v2.1.0/schemas/category-evaluation-record.schema.json";
const fixturePath = "docs/drafts/gateway-v2.1.0/fixtures/category-evaluation-dataset.fixture.jsonl";

const requiredTopLevelSchemaFields = [
  "$schema",
  "$id",
  "title",
  "type",
  "properties",
  "required",
  "additionalProperties",
];

const sensitiveKeyPattern =
  /(rawPrompt|rawResponse|rawDetectedValue|rawPromptFragment|apiKey|appToken|providerKey|authorizationHeader|providerRawErrorBody|actualSecret|requestId|traceId)/i;

const sensitiveStringPattern =
  /(sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]{12,}|-----BEGIN\s+(RSA|OPENSSH|EC|PRIVATE)\s+KEY-----)/i;

const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const regexCache = new Map();

function toAbsolute(rootDir, relativePath) {
  return path.join(rootDir, relativePath);
}

function readText(rootDir, relativePath, failures) {
  const absolutePath = toAbsolute(rootDir, relativePath);
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
  if (text === null) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function compilePattern(pattern, jsonPath, failures) {
  if (regexCache.has(pattern)) {
    return regexCache.get(pattern);
  }

  try {
    const regex = new RegExp(pattern);
    regexCache.set(pattern, regex);
    return regex;
  } catch (error) {
    failures.push(`${jsonPath}: invalid pattern regex ${pattern} (${error.message})`);
    regexCache.set(pattern, null);
    return null;
  }
}

function isJsonType(value, type) {
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function validateProperty(schema, value, jsonPath, failures) {
  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((type) => isJsonType(value, type))) {
      failures.push(`${jsonPath}: expected type ${allowedTypes.join("|")}`);
      return;
    }
  }

  if ("const" in schema && value !== schema.const) {
    failures.push(`${jsonPath}: expected const ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    failures.push(`${jsonPath}: expected one of ${JSON.stringify(schema.enum)}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      failures.push(`${jsonPath}: expected minLength ${schema.minLength}`);
    }

    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      failures.push(`${jsonPath}: expected maxLength ${schema.maxLength}`);
    }

    if (schema.pattern) {
      const regex = compilePattern(schema.pattern, jsonPath, failures);
      if (regex && !regex.test(value)) {
        failures.push(`${jsonPath}: expected pattern ${schema.pattern}`);
      }
    }

    if (schema.format === "date-time") {
      if (!isoDateTimePattern.test(value) || Number.isNaN(Date.parse(value))) {
        failures.push(`${jsonPath}: expected date-time format`);
      }
    }

    if (sensitiveStringPattern.test(value)) {
      failures.push(`${jsonPath}: forbidden secret-shaped string`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      failures.push(`${jsonPath}: expected minimum ${schema.minimum}`);
    }

    if (schema.maximum !== undefined && value > schema.maximum) {
      failures.push(`${jsonPath}: expected maximum ${schema.maximum}`);
    }
  }
}

function validateSourceConsentLabelCombination(record, lineNumber, failures) {
  const prefix = `${fixturePath}: line ${lineNumber}`;

  if (record.source === "synthetic_fixture") {
    if (record.consentType !== "synthetic") {
      failures.push(`${prefix}: synthetic_fixture must use consentType=synthetic`);
    }

    if (record.labelSource !== "synthetic_fixture") {
      failures.push(`${prefix}: synthetic_fixture must use labelSource=synthetic_fixture`);
    }
  }

  if (record.source === "manual_seed" && record.consentType === "synthetic" && record.labelSource === "human_review") {
    failures.push(`${prefix}: human-reviewed manual_seed must use consentType=internal_manual_review`);
  }
}

function validateRecord(schema, record, lineNumber, failures) {
  const properties = schema.properties ?? {};
  const allowedKeys = new Set(Object.keys(properties));
  const prefix = `${fixturePath}: line ${lineNumber}`;

  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    failures.push(`${prefix}: expected JSON object`);
    return;
  }

  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in record)) {
      failures.push(`${prefix}: missing required property ${requiredKey}`);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (sensitiveKeyPattern.test(key)) {
      failures.push(`${prefix}: forbidden sensitive key ${key}`);
    }

    if (!allowedKeys.has(key)) {
      if (schema.additionalProperties === false) {
        failures.push(`${prefix}: unexpected property ${key}`);
      }
      continue;
    }

    validateProperty(properties[key], value, `${prefix}.${key}`, failures);
  }

  validateSourceConsentLabelCombination(record, lineNumber, failures);
}

function validateSchemaShape(schema, failures) {
  if (!schema || typeof schema !== "object") {
    return;
  }

  for (const field of requiredTopLevelSchemaFields) {
    if (!(field in schema)) {
      failures.push(`${schemaPath}: missing top-level schema field ${field}`);
    }
  }

  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    failures.push(`${schemaPath}: expected JSON Schema Draft 2020-12`);
  }

  if (schema.type !== "object") {
    failures.push(`${schemaPath}: top-level type must be object`);
  }

  if (schema.additionalProperties !== false) {
    failures.push(`${schemaPath}: top-level additionalProperties must be false`);
  }

  if (!Array.isArray(schema.required)) {
    failures.push(`${schemaPath}: required must be an array`);
  } else {
    for (const requiredKey of schema.required) {
      if (!schema.properties || !(requiredKey in schema.properties)) {
        failures.push(`${schemaPath}: required key ${requiredKey} is not declared in properties`);
      }
    }
  }

  if (schema.properties?.redactedPrompt?.maxLength !== 65536) {
    failures.push(`${schemaPath}: redactedPrompt.maxLength must be 65536`);
  }

  if (!Array.isArray(schema.allOf) || schema.allOf.length < 1) {
    failures.push(`${schemaPath}: expected source/consentType/labelSource allOf constraints`);
  }
}

export function verifyCategoryEvaluationDataset(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const failures = [];
  const schema = readJson(rootDir, schemaPath, failures);

  validateSchemaShape(schema, failures);

  const fixtureText = readText(rootDir, fixturePath, failures);
  if (fixtureText === null) {
    return failures;
  }

  const lines = fixtureText.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    failures.push(`${fixturePath}: expected at least one JSONL record`);
  }

  if (schema) {
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      try {
        const record = JSON.parse(line);
        validateRecord(schema, record, lineNumber, failures);
      } catch (error) {
        failures.push(`${fixturePath}: line ${lineNumber}: invalid JSON (${error.message})`);
      }
    });
  }

  return failures;
}

function main() {
  const failures = verifyCategoryEvaluationDataset();

  if (failures.length > 0) {
    console.error("v2.1 category evaluation verification failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("v2.1 category evaluation verification passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
