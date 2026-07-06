import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCategoryEvaluationDataset } from "./verify-v2.1-category-eval.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const requiredTopLevelSchemaFields = [
  "$schema",
  "$id",
  "title",
  "type",
  "properties",
  "required",
  "additionalProperties",
];

const sourceOfTruthDocs = [
  "specs/gateway/v2.0.0/contracts.md",
  "specs/gateway/v2.0.0/schemas/*.schema.json",
  "specs/gateway/v2.0.0/fixtures/*.fixture.json",
  "docs/releases/v0.1.0.md",
];

const requiredPublicDocs = [
  "README.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/architecture/README.md",
  "docs/configuration.md",
  "docs/development.md",
  "docs/deployment.md",
  "docs/roadmap.md",
  "docs/releases/README.md",
  "docs/releases/v0.1.0.md",
  "specs/README.md",
  "specs/gateway/v2.0.0/README.md",
];

const archiveDocs = [
  "docs/archive/README.md",
  "docs/archive/v1.0.0/contracts.md",
  "docs/archive/gateway-v2.0.0-planning/implementation-plan.md",
  "docs/archive/gateway-v2.0.0-planning/implementation-tasks.md",
  "docs/archive/gateway-v2.0.0-planning/acceptance-test-matrix.md",
  "docs/archive/gateway-v2.0.0-planning/db-migration-plan.md",
];

const draftDocs = [
  "docs/drafts/README.md",
  "docs/drafts/gateway-v2.1.0/README.md",
  "docs/drafts/gateway-v2.1.0/contracts.md",
];

const entryDocs = ["AGENTS.md", "README.md", "docs/README.md"];

const activePathRoots = ["apps", "infra", "scripts", "specs", ".github"];
const ignoredScanDirs = new Set(["node_modules", ".next", "dist", "build", "coverage", "reports"]);
const staleVersionedDocsPathPattern = /docs[\\/](v1\.0\.0|v2\.0\.0|v2\.1\.0)[\\/]/;
const scannableFilePattern =
  /(^Dockerfile$|\.Dockerfile$|\.(md|txt|ts|tsx|js|mjs|cjs|json|jsonl|go|ps1|yml|yaml|toml|prisma|env|example)$)/i;

const entryDocRequiredRefs = {
  "AGENTS.md": sourceOfTruthDocs,
  "docs/README.md": sourceOfTruthDocs,
  "README.md": [
    "docs/README.md",
    "docs/releases/v0.1.0.md",
    "specs/gateway/v2.0.0",
  ],
};

const sensitiveKeyPattern =
  /(rawPrompt|rawResponse|rawDetectedValue|rawPromptFragment|apiKey|appToken|providerKey|authorizationHeader|providerRawErrorBody|actualSecret)/i;

const sensitiveStringPattern =
  /(sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]{12,}|-----BEGIN\s+(RSA|OPENSSH|EC|PRIVATE)\s+KEY-----)/i;

const providerModelFieldPattern =
  /^(providerName|providerId|modelName|modelId|requestedModel|selectedProvider|selectedModel|fallbackProvider|fallbackModel|defaultProvider|defaultModel)$/i;

function fail(message) {
  failures.push(message);
}

function toAbsolute(relativePath) {
  return path.join(rootDir, relativePath);
}

function readText(relativePath) {
  try {
    return readFileSync(toAbsolute(relativePath), "utf8");
  } catch (error) {
    fail(`${relativePath}: unable to read file (${error.message})`);
    return "";
  }
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    fail(`${relativePath}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function assertExists(relativePath) {
  if (!existsSync(toAbsolute(relativePath))) {
    fail(`${relativePath}: required file is missing`);
  }
}

function listJsonFiles(relativeDir, suffix) {
  const dir = toAbsolute(relativeDir);
  if (!existsSync(dir)) {
    fail(`${relativeDir}: required directory is missing`);
    return [];
  }

  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(suffix))
    .sort()
    .map((fileName) => path.posix.join(relativeDir.replaceAll("\\", "/"), fileName));
}

function listFilesRecursive(relativeDir) {
  const dir = toAbsolute(relativeDir);
  if (!existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredScanDirs.has(entry.name)) {
        files.push(...listFilesRecursive(path.posix.join(relativeDir, entry.name)));
      }
    } else if (entry.isFile()) {
      files.push(path.posix.join(relativeDir, entry.name));
    }
  }
  return files;
}

function baseName(relativePath, suffix) {
  return path.basename(relativePath, suffix);
}

function assertIncludes(relativePath, expectedText) {
  const text = readText(relativePath);
  if (!text.includes(expectedText)) {
    fail(`${relativePath}: missing expected reference "${expectedText}"`);
  }
}

function assertRuntimeBaseline() {
  const packageJson = readJson("package.json");
  if (!packageJson) {
    return;
  }

  if (readText(".nvmrc").trim() !== "22") {
    fail(".nvmrc: expected Node baseline 22");
  }

  if (readText(".node-version").trim() !== "22") {
    fail(".node-version: expected Node baseline 22");
  }

  if (packageJson.packageManager !== "pnpm@9.15.0") {
    fail("package.json: expected packageManager pnpm@9.15.0");
  }

  if (packageJson.engines?.node !== ">=22 <23") {
    fail('package.json: expected engines.node ">=22 <23"');
  }

  if (packageJson.scripts?.["verify:v2-docs"] !== "node scripts/verify-v2-docs.mjs") {
    fail('package.json: expected script "verify:v2-docs"');
  }
}

function assertEntryDocs() {
  for (const doc of entryDocs) {
    assertExists(doc);
    for (const expectedRef of entryDocRequiredRefs[doc]) {
      assertIncludes(doc, expectedRef);
    }
  }

  assertIncludes("AGENTS.md", "docs/archive/gateway-v2.0.0-planning/");
  assertIncludes("AGENTS.md", "docs/archive/v1.0.0/");
  assertIncludes("AGENTS.md", "docs/drafts/gateway-v2.1.0/");
  assertIncludes("docs/README.md", "docs/archive/gateway-v2.0.0-planning/");
  assertIncludes("docs/README.md", "docs/archive/v1.0.0/");
  assertIncludes("docs/README.md", "docs/drafts/gateway-v2.1.0/");
}

function assertCiGate() {
  const workflowPath = ".github/workflows/ci.yml";
  assertExists(workflowPath);

  const workflow = readText(workflowPath);
  for (const expectedText of [
    "branches: [main, dev]",
    "node-version-file: .node-version",
    "corepack prepare pnpm@9.15.0 --activate",
    "pnpm verify:v2-docs",
  ]) {
    if (!workflow.includes(expectedText)) {
      fail(`${workflowPath}: missing CI gate "${expectedText}"`);
    }
  }
}

function assertNoStaleVersionedDocsPaths() {
  for (const root of activePathRoots) {
    for (const filePath of listFilesRecursive(root)) {
      if (!scannableFilePattern.test(path.basename(filePath))) {
        continue;
      }

      const text = readText(filePath);
      if (staleVersionedDocsPathPattern.test(text)) {
        fail(`${filePath}: use specs/, docs/archive/, or docs/drafts/ instead of stale docs/v* paths`);
      }
    }
  }
}

function resolveRef(ref, rootSchema, filePath) {
  if (!ref.startsWith("#/")) {
    fail(`${filePath}: only local JSON Pointer refs are allowed (${ref})`);
    return undefined;
  }

  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));

  let current = rootSchema;
  for (const part of parts) {
    if (current === undefined || current === null || !(part in current)) {
      fail(`${filePath}: unresolved $ref ${ref}`);
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isJsonType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateData(schema, data, context, rootSchema, localFailures) {
  if (!schema || typeof schema !== "object") {
    return;
  }

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, rootSchema, context.filePath);
    validateData(resolved, data, context, rootSchema, localFailures);
    return;
  }

  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      validateData(subSchema, data, context, rootSchema, localFailures);
    }
  }

  if (schema.anyOf) {
    const anyMatched = schema.anyOf.some((subSchema) => {
      const trialFailures = [];
      validateData(subSchema, data, context, rootSchema, trialFailures);
      return trialFailures.length === 0;
    });

    if (!anyMatched) {
      localFailures.push(`${context.path}: expected to match at least one anyOf branch`);
    }
  }

  if ("const" in schema && !deepEqual(data, schema.const)) {
    localFailures.push(`${context.path}: expected const ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.some((candidate) => deepEqual(data, candidate))) {
    localFailures.push(`${context.path}: expected one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((type) => isJsonType(data, type))) {
      localFailures.push(`${context.path}: expected type ${allowedTypes.join("|")}, got ${typeName(data)}`);
      return;
    }
  }

  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      localFailures.push(`${context.path}: expected minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      localFailures.push(`${context.path}: expected maxLength ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      localFailures.push(`${context.path}: expected pattern ${schema.pattern}`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(data))) {
      localFailures.push(`${context.path}: expected date-time format`);
    }
  }

  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) {
      localFailures.push(`${context.path}: expected minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      localFailures.push(`${context.path}: expected maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      localFailures.push(`${context.path}: expected minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      localFailures.push(`${context.path}: expected maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      data.forEach((item, index) => {
        validateData(
          schema.items,
          item,
          { ...context, path: `${context.path}[${index}]` },
          rootSchema,
          localFailures,
        );
      });
    }
  }

  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const properties = schema.properties ?? {};
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in data)) {
        localFailures.push(`${context.path}: missing required property ${requiredKey}`);
      }
    }

    for (const [key, value] of Object.entries(data)) {
      const propertySchema = properties[key];
      if (propertySchema) {
        validateData(
          propertySchema,
          value,
          { ...context, path: `${context.path}.${key}` },
          rootSchema,
          localFailures,
        );
      } else if (schema.additionalProperties === false) {
        localFailures.push(`${context.path}: unexpected property ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateData(
          schema.additionalProperties,
          value,
          { ...context, path: `${context.path}.${key}` },
          rootSchema,
          localFailures,
        );
      }
    }
  }
}

function assertSchemaShape(schema, relativePath) {
  for (const field of requiredTopLevelSchemaFields) {
    if (!(field in schema)) {
      fail(`${relativePath}: missing top-level schema field ${field}`);
    }
  }

  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    fail(`${relativePath}: expected JSON Schema Draft 2020-12`);
  }

  if (schema.type !== "object") {
    fail(`${relativePath}: top-level type must be object`);
  }

  if (schema.additionalProperties !== false) {
    fail(`${relativePath}: top-level additionalProperties must be false`);
  }

  if (!Array.isArray(schema.required)) {
    fail(`${relativePath}: required must be an array`);
  }

  for (const requiredKey of schema.required ?? []) {
    if (!schema.properties || !(requiredKey in schema.properties)) {
      fail(`${relativePath}: required key ${requiredKey} is not declared in properties`);
    }
  }
}

function walkSchemaForProviderModelEnums(node, relativePath, currentKey = "") {
  if (!node || typeof node !== "object") {
    return;
  }

  if (providerModelFieldPattern.test(currentKey) && (node.enum || node.const)) {
    fail(`${relativePath}: provider/model field "${currentKey}" must not be enum or const locked`);
  }

  for (const [key, value] of Object.entries(node)) {
    walkSchemaForProviderModelEnums(value, relativePath, key);
  }
}

function scanFixtureForSensitiveValues(value, relativePath, jsonPath = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanFixtureForSensitiveValues(item, relativePath, `${jsonPath}[${index}]`));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(key)) {
        fail(`${relativePath}: forbidden sensitive key at ${jsonPath}.${key}`);
      }
      scanFixtureForSensitiveValues(child, relativePath, `${jsonPath}.${key}`);
    }
    return;
  }

  if (typeof value === "string" && sensitiveStringPattern.test(value)) {
    fail(`${relativePath}: forbidden secret-shaped string at ${jsonPath}`);
  }
}

function assertSchemaFixturePairs() {
  const schemaFiles = listJsonFiles("specs/gateway/v2.0.0/schemas", ".schema.json");
  const fixtureFiles = listJsonFiles("specs/gateway/v2.0.0/fixtures", ".fixture.json");
  const schemaBases = new Set(schemaFiles.map((file) => baseName(file, ".schema.json")));
  const fixtureBases = new Set(fixtureFiles.map((file) => baseName(file, ".fixture.json")));

  for (const schemaBase of schemaBases) {
    if (!fixtureBases.has(schemaBase)) {
      fail(`specs/gateway/v2.0.0/fixtures/${schemaBase}.fixture.json: missing fixture for schema`);
    }
  }

  for (const fixtureBase of fixtureBases) {
    if (!schemaBases.has(fixtureBase)) {
      fail(`specs/gateway/v2.0.0/schemas/${fixtureBase}.schema.json: missing schema for fixture`);
    }
  }

  for (const schemaFile of schemaFiles) {
    const schema = readJson(schemaFile);
    if (!schema) continue;

    assertSchemaShape(schema, schemaFile);
    walkSchemaForProviderModelEnums(schema, schemaFile);

    const fixtureFile = `specs/gateway/v2.0.0/fixtures/${baseName(schemaFile, ".schema.json")}.fixture.json`;
    if (!existsSync(toAbsolute(fixtureFile))) continue;

    const fixture = readJson(fixtureFile);
    if (!fixture) continue;

    scanFixtureForSensitiveValues(fixture, fixtureFile);

    const validationFailures = [];
    validateData(schema, fixture, { filePath: schemaFile, path: "$" }, schema, validationFailures);
    for (const validationFailure of validationFailures) {
      fail(`${fixtureFile}: ${validationFailure}`);
    }
  }
}

function assertRuntimeSnapshotGuardrails() {
  const runtimeSnapshot = readJson("specs/gateway/v2.0.0/fixtures/runtime-snapshot.fixture.json");
  if (!runtimeSnapshot) return;

  if ("budgetScopeType" in runtimeSnapshot.lookupKey || "budgetScopeId" in runtimeSnapshot.lookupKey) {
    fail("runtime-snapshot.fixture.json: lookupKey must not contain budget scope fields");
  }

  const allowedBudgetScopeTypes = new Set(["application", "project", "team"]);
  const budgetScopeType = runtimeSnapshot.budgetResolution?.budgetScopeType;
  if (!allowedBudgetScopeTypes.has(budgetScopeType)) {
    fail("runtime-snapshot.fixture.json: budgetScopeType must be application, project, or team");
  }
}

function main() {
  for (const doc of sourceOfTruthDocs) {
    if (!doc.includes("*")) assertExists(doc);
  }

  for (const doc of [...requiredPublicDocs, ...archiveDocs, ...draftDocs]) {
    assertExists(doc);
  }

  assertRuntimeBaseline();
  assertEntryDocs();
  assertCiGate();
  assertNoStaleVersionedDocsPaths();
  assertSchemaFixturePairs();
  assertRuntimeSnapshotGuardrails();
  for (const failure of verifyCategoryEvaluationDataset({ rootDir })) {
    fail(failure);
  }

  if (failures.length > 0) {
    console.error("v2 document verification failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("v2 document verification passed.");
}

main();
