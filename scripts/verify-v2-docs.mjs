import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCategoryEvaluationDataset } from "./verify-v2.1-category-eval.mjs";
import {
  verifyDifficultyEvaluationDataset,
  verifyDifficultyLabelContract,
  verifyDifficultyTrainingPilot,
} from "./verify-v2.1-difficulty-eval.mjs";

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

const activeEntryDocs = [
  "docs/current/README.md",
  "docs/current/source-of-truth.md",
];

const currentSnapshotDocs = [
  "docs/current/implementation-status.md",
  "docs/current/documentation-gaps.md",
];

const tenantChatDocs = [
  "docs/tenant-chat/README.md",
  "docs/tenant-chat/contracts.md",
  "docs/tenant-chat/execution-contract.md",
  "docs/tenant-chat/openapi/chat-auth.openapi.json",
  "docs/tenant-chat/openapi/admin-runtime.openapi.json",
  "docs/tenant-chat/openapi/private-control-plane.openapi.json",
  "docs/tenant-chat/openapi/chat-conversation.openapi.json",
  "docs/tenant-chat/openapi/private-gateway.openapi.json",
  "docs/tenant-chat/db/tenant-chat-content.sql",
  "docs/tenant-chat/db/tenant-chat-usage.sql",
  "docs/tenant-chat/schemas/*.schema.json",
  "docs/tenant-chat/fixtures/*.fixture.json",
  "docs/tenant-chat/vectors/binding-digest-vectors.json",
  "docs/tenant-chat/vectors/usage-event-vectors.json",
  "docs/tenant-chat/vectors/workload-jwt-phase-vectors.json",
  "docs/tenant-chat/implementation-plan.md",
  "docs/tenant-chat/handoffs/employee-usage-integration.md",
];

const versionStatusDocs = [
  "docs/v2.0.0/README.md",
  "docs/v2.1.0/README.md",
];

const baselineContractDocs = [
  "docs/v2.0.0/contracts.md",
  "docs/v2.0.0/schemas/*.schema.json",
  "docs/v2.0.0/fixtures/*.fixture.json",
];

const historicalV2Docs = [
  "docs/v2.0.0/implementation-plan.md",
  "docs/v2.0.0/implementation-tasks.md",
  "docs/v2.0.0/implementation-pr-packets.md",
  "docs/v2.0.0/acceptance-test-matrix.md",
  "docs/v2.0.0/db-migration-plan.md",
];

const versionedV21Docs = [
  "docs/v2.1.0/contracts.md",
  "docs/v2.1.0/implementation-plan.md",
  "docs/v2.1.0/implementation-tasks.md",
  "docs/v2.1.0/acceptance-test-matrix.md",
  "docs/v2.1.0/production-images.md",
  "docs/v2.1.0/category-evaluation-dataset-contract.md",
  "docs/v2.1.0/schemas/category-evaluation-record.schema.json",
  "docs/v2.1.0/difficulty-evaluation-dataset-contract.md",
  "docs/v2.1.0/difficulty-label-guide.md",
  "docs/v2.1.0/schemas/difficulty-evaluation-record.schema.json",
  "docs/v2.1.0/schemas/difficulty-label-record.schema.json",
  "docs/v2.1.0/schemas/difficulty-label-dataset-manifest.schema.json",
  "docs/v2.1.0/schemas/difficulty-label-record.v1.schema.json",
  "docs/v2.1.0/schemas/difficulty-label-dataset-manifest.v1.schema.json",
  "docs/v2.1.0/schemas/difficulty-training-split-manifest.schema.json",
  "docs/v2.1.0/schemas/difficulty-model-artifact.schema.json",
  "docs/v2.1.0/schemas/difficulty-offline-model-artifact.schema.json",
  "docs/v2.1.0/fixtures/difficulty-label-contract-smoke.fixture.jsonl",
  "docs/v2.1.0/fixtures/difficulty-label-contract-smoke.manifest.json",
  "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl",
  "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json",
  "docs/v2.1.0/fixtures/difficulty-training-split-manifest.v1.json",
  "docs/v2.1.0/routing-advanced-plan.md",
  "docs/v2.1.0/routing-performance-test-scenario.md",
  "docs/v2.1.0/routing-random-probe.md",
];

const entryDocs = ["AGENTS.md", "README.md", "docs/README.md"];

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

function assertDocumentationRouting() {
  for (const doc of entryDocs) {
    assertExists(doc);
    for (const activeEntryDoc of activeEntryDocs) {
      assertIncludes(doc, activeEntryDoc);
    }
  }

  for (const currentDoc of currentSnapshotDocs) {
    assertIncludes("docs/current/README.md", path.basename(currentDoc));
  }

  assertIncludes("docs/current/README.md", "../tenant-chat/README.md");
  assertIncludes("docs/current/source-of-truth.md", "../tenant-chat/contracts.md");
  assertIncludes("AGENTS.md", "docs/tenant-chat/README.md");
  assertIncludes("README.md", "docs/tenant-chat/README.md");
  assertIncludes("docs/README.md", "tenant-chat/README.md");

  for (const versionStatusDoc of versionStatusDocs) {
    const versionDir = path.basename(path.dirname(versionStatusDoc));
    assertIncludes("docs/current/README.md", `${versionDir}/README.md`);
    assertIncludes(versionStatusDoc, "../current/README.md");
  }

  for (const expectedText of [
    "Historical baseline",
    "contracts.md",
    "schemas/*.schema.json",
    "fixtures/*.fixture.json",
    "implementation-plan.md",
    "implementation-tasks.md",
    "implementation-pr-packets.md",
    "acceptance-test-matrix.md",
    "db-migration-plan.md",
  ]) {
    assertIncludes("docs/v2.0.0/README.md", expectedText);
  }

  for (const expectedText of [
    "Latest versioned scope reference",
    "contracts.md",
    "implementation-plan.md",
    "implementation-tasks.md",
    "acceptance-test-matrix.md",
    "production-images.md",
    "category-evaluation-dataset-contract.md",
    "schemas/category-evaluation-record.schema.json",
    "difficulty-evaluation-dataset-contract.md",
    "schemas/difficulty-evaluation-record.schema.json",
    "routing-advanced-plan.md",
    "routing-performance-test-scenario.md",
    "routing-random-probe.md",
  ]) {
    assertIncludes("docs/v2.1.0/README.md", expectedText);
  }
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
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]),
    )
  );
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

  if (schema.if) {
    const conditionFailures = [];
    validateData(schema.if, data, context, rootSchema, conditionFailures);
    if (conditionFailures.length === 0 && schema.then) {
      validateData(schema.then, data, context, rootSchema, localFailures);
    } else if (conditionFailures.length > 0 && schema.else) {
      validateData(schema.else, data, context, rootSchema, localFailures);
    }
  }

  if (schema.not) {
    const notFailures = [];
    validateData(schema.not, data, context, rootSchema, notFailures);
    if (notFailures.length === 0) {
      localFailures.push(`${context.path}: matched a forbidden not schema`);
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

  if (schema.oneOf) {
    const matchCount = schema.oneOf.reduce((count, subSchema) => {
      const trialFailures = [];
      validateData(subSchema, data, context, rootSchema, trialFailures);
      return count + (trialFailures.length === 0 ? 1 : 0);
    }, 0);

    if (matchCount !== 1) {
      localFailures.push(
        `${context.path}: expected to match exactly one oneOf branch, matched ${matchCount}`,
      );
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
    if (schema.uniqueItems) {
      for (let left = 0; left < data.length; left += 1) {
        for (let right = left + 1; right < data.length; right += 1) {
          if (deepEqual(data[left], data[right])) {
            localFailures.push(
              `${context.path}: items at indexes ${left} and ${right} must be unique`,
            );
          }
        }
      }
    }
    if (schema.contains) {
      const containsMatches = data.filter((item, index) => {
        const trialFailures = [];
        validateData(
          schema.contains,
          item,
          { ...context, path: `${context.path}[${index}]` },
          rootSchema,
          trialFailures,
        );
        return trialFailures.length === 0;
      }).length;
      const minContains = schema.minContains ?? 1;
      if (containsMatches < minContains) {
        localFailures.push(
          `${context.path}: expected at least ${minContains} item(s) to match contains`,
        );
      }
      if (schema.maxContains !== undefined && containsMatches > schema.maxContains) {
        localFailures.push(
          `${context.path}: expected at most ${schema.maxContains} item(s) to match contains`,
        );
      }
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
  const schemaFiles = listJsonFiles("docs/v2.0.0/schemas", ".schema.json");
  const fixtureFiles = listJsonFiles("docs/v2.0.0/fixtures", ".fixture.json");
  const schemaBases = new Set(schemaFiles.map((file) => baseName(file, ".schema.json")));
  const fixtureBases = new Set(fixtureFiles.map((file) => baseName(file, ".fixture.json")));

  for (const schemaBase of schemaBases) {
    if (!fixtureBases.has(schemaBase)) {
      fail(`docs/v2.0.0/fixtures/${schemaBase}.fixture.json: missing fixture for schema`);
    }
  }

  for (const fixtureBase of fixtureBases) {
    if (!schemaBases.has(fixtureBase)) {
      fail(`docs/v2.0.0/schemas/${fixtureBase}.schema.json: missing schema for fixture`);
    }
  }

  for (const schemaFile of schemaFiles) {
    const schema = readJson(schemaFile);
    if (!schema) continue;

    assertSchemaShape(schema, schemaFile);
    walkSchemaForProviderModelEnums(schema, schemaFile);

    const fixtureFile = `docs/v2.0.0/fixtures/${baseName(schemaFile, ".schema.json")}.fixture.json`;
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

function assertTenantChatSchemaFixturePairs() {
  const schemaDir = "docs/tenant-chat/schemas";
  const fixtureDir = "docs/tenant-chat/fixtures";
  const schemaFiles = listJsonFiles(schemaDir, ".schema.json");
  const fixtureFiles = listJsonFiles(fixtureDir, ".fixture.json");
  const schemaBases = new Set(schemaFiles.map((file) => baseName(file, ".schema.json")));
  const fixtureBases = new Set(fixtureFiles.map((file) => baseName(file, ".fixture.json")));

  for (const schemaBase of schemaBases) {
    if (!fixtureBases.has(schemaBase)) {
      fail(`${fixtureDir}/${schemaBase}.fixture.json: missing fixture for schema`);
    }
  }

  for (const fixtureBase of fixtureBases) {
    if (!schemaBases.has(fixtureBase)) {
      fail(`${schemaDir}/${fixtureBase}.schema.json: missing schema for fixture`);
    }
  }

  for (const schemaFile of schemaFiles) {
    const schema = readJson(schemaFile);
    if (!schema) continue;

    assertSchemaShape(schema, schemaFile);
    walkSchemaForProviderModelEnums(schema, schemaFile);

    const fixtureFile = `${fixtureDir}/${baseName(schemaFile, ".schema.json")}.fixture.json`;
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
  const runtimeSnapshot = readJson("docs/v2.0.0/fixtures/runtime-snapshot.fixture.json");
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

function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
    .join(",")}}`;
}

function sha256Base64Url(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("base64url")}`;
}

function assertTenantChatExecutableContract() {
  const authOpenApiPath = "docs/tenant-chat/openapi/chat-auth.openapi.json";
  const adminOpenApiPath = "docs/tenant-chat/openapi/admin-runtime.openapi.json";
  const controlPlaneOpenApiPath = "docs/tenant-chat/openapi/private-control-plane.openapi.json";
  const conversationOpenApiPath = "docs/tenant-chat/openapi/chat-conversation.openapi.json";
  const openApiPath = "docs/tenant-chat/openapi/private-gateway.openapi.json";
  const ddlPath = "docs/tenant-chat/db/tenant-chat-usage.sql";
  const bindingVectorPath = "docs/tenant-chat/vectors/binding-digest-vectors.json";
  const usageVectorPath = "docs/tenant-chat/vectors/usage-event-vectors.json";
  const usageV3VectorPath = "docs/tenant-chat/vectors/usage-event-v3-vectors.json";
  const jwtVectorPath = "docs/tenant-chat/vectors/workload-jwt-phase-vectors.json";
  const runtimeFixturePath = "docs/tenant-chat/fixtures/tenant-runtime-snapshot.fixture.json";

  const authOpenApi = readJson(authOpenApiPath);
  if (authOpenApi) {
    if (authOpenApi.openapi !== "3.1.0") {
      fail(`${authOpenApiPath}: expected OpenAPI 3.1.0`);
    }
    for (const [method, apiPath] of [
      ["post", "/api/tenant-chat/auth/login"],
      ["post", "/api/tenant-chat/auth/refresh"],
      ["post", "/api/tenant-chat/auth/logout"],
      ["get", "/api/tenant-chat/auth/session"],
      ["post", "/api/tenant-chat/auth/tenant"],
      ["post", "/api/tenant-chat/invitations/accept-password"],
      ["post", "/api/tenant-chat/invitations/bind-existing"],
      ["post", "/internal/v1/tenant-chat/auth/password"],
      ["get", "/internal/v1/tenant-chat/identity/entitlements/{userId}/{tenantId}"],
    ]) {
      if (!authOpenApi.paths?.[apiPath]?.[method]) {
        fail(`${authOpenApiPath}: missing ${method.toUpperCase()} ${apiPath}`);
      }
    }
  }

  const adminOpenApi = readJson(adminOpenApiPath);
  if (adminOpenApi) {
    if (adminOpenApi.openapi !== "3.1.0") {
      fail(`${adminOpenApiPath}: expected OpenAPI 3.1.0`);
    }

    const runtimePath = adminOpenApi.paths?.["/admin/v1/tenants/{tenantId}/tenant-chat/runtime"];
    for (const [method, statuses] of [
      ["get", ["200", "400", "401", "403"]],
      ["put", ["200", "400", "401", "403", "404", "409"]],
    ]) {
      const operation = runtimePath?.[method];
      if (!operation) {
        fail(`${adminOpenApiPath}: missing ${method.toUpperCase()} admin runtime operation`);
        continue;
      }
      for (const status of statuses) {
        if (!operation.responses?.[status]) {
          fail(`${adminOpenApiPath}: ${method.toUpperCase()} must declare ${status}`);
        }
      }
    }

    const activationComponent = adminOpenApi.components?.schemas?.ActivateRuntimeRequest;
    const activationSchema = runtimePath?.put?.requestBody?.content?.["application/json"]?.schema;
    if (!runtimePath?.put?.requestBody?.required) {
      fail(`${adminOpenApiPath}: PUT admin runtime requestBody must be required`);
    }
    if (activationSchema?.$ref !== "#/components/schemas/ActivateRuntimeRequest") {
      fail(`${adminOpenApiPath}: PUT admin runtime request must reference ActivateRuntimeRequest`);
    }
    if (!activationComponent) {
      fail(`${adminOpenApiPath}: missing ActivateRuntimeRequest schema`);
    } else if (activationSchema) {
      const modelRef = "openai:gpt-4o-mini";
      const routingCell = { modelRefs: [modelRef] };
      const routingDifficulty = { simple: routingCell, complex: routingCell };
      const routes = {
        general: routingDifficulty,
        code: routingDifficulty,
        translation: routingDifficulty,
        summarization: routingDifficulty,
        reasoning: routingDifficulty,
      };
      const mandatoryDetectors = [
        { detectorType: "resident_registration_number", action: "redact" },
        { detectorType: "api_key", action: "block" },
        { detectorType: "authorization_header", action: "block" },
        { detectorType: "jwt", action: "block" },
        { detectorType: "private_key", action: "block" },
      ];
      const currentPayload = {
        routingMode: "manual",
        manualModelRef: modelRef,
        routes,
        cachePolicy: { enabled: true, ttlSeconds: 300, maxEntriesPerUser: 100 },
        safetyPolicy: { detectorSet: mandatoryDetectors },
      };
      const compatibilityPayload = {
        routingMode: "manual",
        manualModelRef: modelRef,
        routes,
        cacheEnabled: true,
      };
      const validateActivation = (payload, label) => {
        const validationFailures = [];
        validateData(
          activationSchema,
          payload,
          { filePath: adminOpenApiPath, path: label },
          adminOpenApi,
          validationFailures,
        );
        return validationFailures;
      };

      for (const [label, payload] of [
        ["current activation payload", currentPayload],
        ["compatibility activation payload", compatibilityPayload],
      ]) {
        for (const validationFailure of validateActivation(payload, label)) {
          fail(`${adminOpenApiPath}: ${validationFailure}`);
        }
      }

      const missingMandatoryPayload = {
        ...currentPayload,
        safetyPolicy: {
          detectorSet: [
            ...mandatoryDetectors.slice(0, 4),
            { detectorType: "email", action: "redact" },
          ],
        },
      };
      const mandatoryAllowPayload = {
        ...currentPayload,
        safetyPolicy: {
          detectorSet: mandatoryDetectors.map((detector) =>
            detector.detectorType === "api_key" ? { ...detector, action: "allow" } : detector,
          ),
        },
      };
      const duplicateDetectorPayload = {
        ...currentPayload,
        safetyPolicy: {
          detectorSet: [...mandatoryDetectors, mandatoryDetectors[0]],
        },
      };
      const duplicateDetectorTypePayload = {
        ...currentPayload,
        safetyPolicy: {
          detectorSet: [
            ...mandatoryDetectors,
            { detectorType: "resident_registration_number", action: "block" },
          ],
        },
      };
      for (const [label, payload] of [
        ["mixed current and compatibility payload", { ...currentPayload, cacheEnabled: true }],
        [
          "current payload missing safetyPolicy",
          {
            routingMode: currentPayload.routingMode,
            manualModelRef: currentPayload.manualModelRef,
            routes: currentPayload.routes,
            cachePolicy: currentPayload.cachePolicy,
          },
        ],
        ["payload missing a mandatory detector", missingMandatoryPayload],
        ["payload allowing a mandatory detector", mandatoryAllowPayload],
        ["payload with a duplicate detector", duplicateDetectorPayload],
        ["payload with a duplicate detector type", duplicateDetectorTypePayload],
      ]) {
        if (validateActivation(payload, label).length === 0) {
          fail(`${adminOpenApiPath}: unexpectedly accepted ${label}`);
        }
      }
    }

    const setupEnvelopePayload = {
      data: {
        readiness: "needs_provider",
        providers: [],
        activeSnapshot: null,
      },
    };
    for (const method of ["get", "put"]) {
      const responseSchema =
        runtimePath?.[method]?.responses?.["200"]?.content?.["application/json"]?.schema;
      if (responseSchema?.$ref !== "#/components/schemas/SetupEnvelope") {
        fail(
          `${adminOpenApiPath}: ${method.toUpperCase()} 200 response must reference SetupEnvelope`,
        );
        continue;
      }
      const responseFailures = [];
      validateData(
        responseSchema,
        setupEnvelopePayload,
        { filePath: adminOpenApiPath, path: `$.${method}.response.200` },
        adminOpenApi,
        responseFailures,
      );
      for (const validationFailure of responseFailures) {
        fail(`${adminOpenApiPath}: ${validationFailure}`);
      }
    }

    const invalidSetupEnvelopePayload = structuredClone(setupEnvelopePayload);
    invalidSetupEnvelopePayload.data.activeSnapshot = {};
    const invalidResponseFailures = [];
    validateData(
      adminOpenApi.components?.schemas?.SetupEnvelope,
      invalidSetupEnvelopePayload,
      { filePath: adminOpenApiPath, path: "$.negative.invalidActiveSnapshot" },
      adminOpenApi,
      invalidResponseFailures,
    );
    if (invalidResponseFailures.length === 0) {
      fail(`${adminOpenApiPath}: unexpectedly accepted an invalid activeSnapshot response`);
    }
  }

  const controlPlaneOpenApi = readJson(controlPlaneOpenApiPath);
  if (controlPlaneOpenApi) {
    if (controlPlaneOpenApi.openapi !== "3.1.0") {
      fail(`${controlPlaneOpenApiPath}: expected OpenAPI 3.1.0`);
    }
    const operation = controlPlaneOpenApi.paths?.[
      "/internal/v1/tenant-chat/runtime/snapshots/{tenantId}/active"
    ]?.get;
    if (!operation?.responses?.["200"] || !operation?.responses?.["401"] || !operation?.responses?.["503"]) {
      fail(`${controlPlaneOpenApiPath}: active snapshot metadata reader responses are incomplete`);
    }
    const metadata = controlPlaneOpenApi.components?.schemas?.ActiveRuntimeSnapshotMetadata;
    const required = new Set(metadata?.required ?? []);
    for (const field of [
      "tenantId",
      "version",
      "digest",
      "policyVersion",
      "employeeNoticeVersion",
      "pricingVersion",
    ]) {
      if (!required.has(field)) {
        fail(`${controlPlaneOpenApiPath}: metadata must require ${field}`);
      }
    }
  }

  const conversationOpenApi = readJson(conversationOpenApiPath);
  if (conversationOpenApi) {
    if (conversationOpenApi.openapi !== "3.1.0") {
      fail(`${conversationOpenApiPath}: expected OpenAPI 3.1.0`);
    }
    for (const [method, apiPath] of [
      ["post", "/internal/v1/tenant-chat/conversations"],
      ["get", "/internal/v1/tenant-chat/conversations"],
      ["get", "/internal/v1/tenant-chat/conversations/{conversationId}"],
      ["patch", "/internal/v1/tenant-chat/conversations/{conversationId}"],
      ["delete", "/internal/v1/tenant-chat/conversations/{conversationId}"],
      ["get", "/internal/v1/tenant-chat/conversations/{conversationId}/messages"],
      ["post", "/internal/v1/tenant-chat/conversations/{conversationId}/turns"],
      ["post", "/internal/v1/tenant-chat/conversations/{conversationId}/turns/{turnId}/cancel"],
    ]) {
      if (!conversationOpenApi.paths?.[apiPath]?.[method]) {
        fail(`${conversationOpenApiPath}: missing ${method.toUpperCase()} ${apiPath}`);
      }
    }
    const turnResponse = conversationOpenApi.paths?.[
      "/internal/v1/tenant-chat/conversations/{conversationId}/turns"
    ]?.post?.responses?.["200"];
    if (!turnResponse?.content?.["text/event-stream"] || turnResponse?.content?.["application/json"]) {
      fail(`${conversationOpenApiPath}: turn success must be text/event-stream only`);
    }
  }

  const openApi = readJson(openApiPath);
  if (openApi) {
    if (openApi.openapi !== "3.1.0") {
      fail(`${openApiPath}: expected OpenAPI 3.1.0`);
    }

    const expectedPaths = {
      "/internal/v1/tenant-chat/admissions": ["200", "201", "400", "401", "409", "429", "503"],
      "/internal/v1/tenant-chat/admissions/{admissionId}/cancel": ["200", "400", "401", "409", "503"],
      "/internal/v1/tenant-chat/completions": ["200", "400", "401", "403", "409", "429", "502", "503", "504"],
      "/internal/v1/tenant-chat/usage-receipts": ["200", "400", "401", "409", "503"],
    };
    const errorStatus = new Map([
      ["CHAT_INVALID_REQUEST", "400"],
      ["CHAT_SCOPE_FIELD_FORBIDDEN", "400"],
      ["CHAT_TOKEN_INVALID", "401"],
      ["CHAT_USER_DISABLED", "403"],
      ["CHAT_TENANT_DISABLED", "403"],
      ["CHAT_MEMBERSHIP_DISABLED", "403"],
      ["CHAT_EMPLOYEE_DISABLED", "403"],
      ["CHAT_SAFETY_BLOCKED", "403"],
      ["CHAT_QUOTA_HARD_LIMIT", "403"],
      ["CHAT_BUDGET_HARD_LIMIT", "403"],
      ["CHAT_POLICY_ACK_REQUIRED", "409"],
      ["CHAT_IDEMPOTENCY_CONFLICT", "409"],
      ["CHAT_ADMISSION_EXPIRED", "409"],
      ["CHAT_RATE_LIMITED", "429"],
      ["CHAT_CONCURRENCY_LIMITED", "429"],
      ["CHAT_PROVIDER_FAILED", "502"],
      ["CHAT_RUNTIME_UNAVAILABLE", "503"],
      ["CHAT_USAGE_GUARD_UNAVAILABLE", "503"],
      ["CHAT_NO_ELIGIBLE_ROUTE", "503"],
      ["CHAT_PROVIDER_TIMEOUT", "504"],
    ]);

    for (const [apiPath, statuses] of Object.entries(expectedPaths)) {
      const operation = openApi.paths?.[apiPath]?.post;
      if (!operation) {
        fail(`${openApiPath}: missing POST ${apiPath}`);
        continue;
      }
      if (!operation.requestBody?.required) {
        fail(`${openApiPath}: POST ${apiPath} requestBody must be required`);
      }
      for (const status of statuses) {
        if (!operation.responses?.[status]) {
          fail(`${openApiPath}: POST ${apiPath} missing response ${status}`);
          continue;
        }
        if (status.startsWith("2")) {
          continue;
        }
        const responseRef = operation.responses[status].$ref;
        const responseName = responseRef?.split("/").at(-1);
        const response = responseName ? openApi.components?.responses?.[responseName] : operation.responses[status];
        if (!Array.isArray(response?.["x-error-codes"]) || response["x-error-codes"].length === 0) {
          fail(`${openApiPath}: POST ${apiPath} response ${status} must declare x-error-codes`);
          continue;
        }
        for (const errorCode of response["x-error-codes"]) {
          if (errorStatus.get(errorCode) !== status) {
            fail(`${openApiPath}: ${errorCode} is not a valid ${status} error`);
          }
        }
      }
    }

    const completionExample = openApi.components?.examples?.CompletionRequestExample?.value;
    const openApiBindingVectors = readJson(bindingVectorPath)?.vectors ?? [];
    const completionVector = openApiBindingVectors.find(
      (vector) => vector.vectorId === "completion_employee_v1",
    );
    if (completionExample && completionVector) {
      const payloadDigest = sha256Base64Url(canonicalizeJson(completionExample.input));
      if (payloadDigest !== completionVector.bindingObject?.payloadDigest) {
        fail(`${openApiPath}: completion example payload digest does not match completion binding vector`);
      }
      if (completionExample.context?.bindingDigest !== completionVector.expectedBindingDigest) {
        fail(`${openApiPath}: completion example bindingDigest does not match completion binding vector`);
      }
    }
    for (const [exampleName, vectorId] of [
      ["AdmissionRequestExample", "admission_employee_v1"],
      ["CancelRequestExample", "cancel_employee_v1"],
    ]) {
      const example = openApi.components?.examples?.[exampleName]?.value;
      const vector = openApiBindingVectors.find((candidate) => candidate.vectorId === vectorId);
      if (example?.context?.bindingDigest !== vector?.expectedBindingDigest) {
        fail(`${openApiPath}: ${exampleName} bindingDigest does not match ${vectorId}`);
      }
    }
  }

  const ddl = readText(ddlPath);
  const expectedTables = [
    "tenant_chat_request_admissions",
    "tenant_chat_user_token_periods",
    "tenant_chat_tenant_cost_periods",
    "tenant_chat_usage_reservations",
    "tenant_chat_provider_attempts",
    "tenant_chat_usage_ledger_entries",
    "tenant_chat_invocation_outbox",
    "tenant_chat_invocation_logs",
  ];
  for (const table of expectedTables) {
    if (!ddl.includes(`CREATE TABLE ${table}`)) {
      fail(`${ddlPath}: missing table ${table}`);
    }
  }

  const normalizedDdl = ddl.replace(/\s+/g, " ").trim().toLowerCase();
  const expectedDdlFragments = [
    "create index tenant_chat_admission_user_idx on tenant_chat_request_admissions (user_id)",
    "create index tenant_chat_admission_employee_idx on tenant_chat_request_admissions (employee_id) where employee_id is not null",
    "create index tenant_chat_user_period_user_idx on tenant_chat_user_token_periods (user_id, period_start desc)",
    "create index tenant_chat_reservation_cost_period_idx on tenant_chat_usage_reservations (tenant_id, tenant_period_start, currency)",
    "constraint tenant_chat_reservation_identity_key unique (reservation_id, request_id, tenant_id)",
    "constraint tenant_chat_attempt_reservation_request_fkey foreign key (reservation_id, request_id, tenant_id) references tenant_chat_usage_reservations (reservation_id, request_id, tenant_id) on delete restrict",
    "create index tenant_chat_attempt_reservation_idx on tenant_chat_provider_attempts (reservation_id, request_id, tenant_id, attempt_no)",
    "constraint tenant_chat_ledger_reservation_request_fkey foreign key (reservation_id, request_id, tenant_id) references tenant_chat_usage_reservations (reservation_id, request_id, tenant_id) on delete restrict",
    "create index tenant_chat_ledger_reservation_idx on tenant_chat_usage_ledger_entries (reservation_id, request_id, tenant_id, ledger_version)",
    "create index tenant_chat_log_user_idx on tenant_chat_invocation_logs (user_id, completed_at desc)",
    "create index tenant_chat_log_employee_idx on tenant_chat_invocation_logs (employee_id) where employee_id is not null",
    "limit_tokens = 0 and warning_threshold_tokens = 0 and economy_threshold_tokens = 0 and hard_stop_tokens = 0 and state = 'blocked'",
    "limit_micro_usd = 0 and warning_threshold_micro_usd = 0 and economy_threshold_micro_usd = 0 and hard_stop_micro_usd = 0 and state = 'blocked'",
    "cache_read_input_micro_usd_per_million_tokens >= 0",
    "constraint tenant_chat_attempt_cache_read_price_check check ( cache_read_input_micro_usd_per_million_tokens is null or cache_read_input_micro_usd_per_million_tokens <= input_micro_usd_per_million_tokens )",
    "confirmed_cache_read_input_tokens <= confirmed_input_tokens",
  ];
  for (const fragment of expectedDdlFragments) {
    if (!normalizedDdl.includes(fragment)) {
      fail(`${ddlPath}: missing executable DDL fragment "${fragment}"`);
    }
  }

  if (/reservation_id\s+uuid\s+not\s+null\s+references\s+tenant_chat_usage_reservations/i.test(ddl)) {
    fail(`${ddlPath}: attempt/ledger reservation identity must use the composite reservation_id/request_id FK`);
  }
  if (/cached_input|confirmed_cached_input/i.test(ddl)) {
    fail(`${ddlPath}: ambiguous cached_input naming is forbidden; use provider cache_read fields`);
  }
  if (/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i.test(ddl) || /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i.test(ddl)) {
    fail(`${ddlPath}: destructive DROP statement is forbidden`);
  }

  const bindingVectors = readJson(bindingVectorPath);
  if (bindingVectors) {
    if (bindingVectors.algorithm !== "HMAC-SHA-256" || bindingVectors.canonicalization !== "RFC8785-JCS") {
      fail(`${bindingVectorPath}: unexpected algorithm or canonicalization`);
    }
    for (const vector of bindingVectors.vectors ?? []) {
      const canonical = canonicalizeJson(vector.bindingObject);
      if (canonical !== vector.canonicalBinding) {
        fail(`${bindingVectorPath}: ${vector.vectorId} canonical binding mismatch`);
      }
      const digest = `hmac-sha256:${createHmac("sha256", Buffer.from(vector.keyHex, "hex"))
        .update(canonical, "utf8")
        .digest("base64url")}`;
      if (digest !== vector.expectedBindingDigest) {
        fail(`${bindingVectorPath}: ${vector.vectorId} HMAC mismatch`);
      }
    }
  }

  const runtimeSnapshot = readJson(runtimeFixturePath);
  if (runtimeSnapshot) {
    const { digest: pricingDigest, ...pricingPayload } = runtimeSnapshot.pricing ?? {};
    const computedPricingDigest = sha256Base64Url(canonicalizeJson(pricingPayload));
    if (pricingDigest !== computedPricingDigest) {
      fail(`${runtimeFixturePath}: pricing digest mismatch`);
    }

    const { digest, publishedAt, publishedBy, ...snapshotPayload } = runtimeSnapshot;
    const computedSnapshotDigest = sha256Base64Url(canonicalizeJson(snapshotPayload));
    if (digest !== computedSnapshotDigest) {
      fail(`${runtimeFixturePath}: snapshot digest mismatch`);
    }

    for (const policyName of ["quota", "budget"]) {
      const policy = runtimeSnapshot.policies?.[policyName];
      if (!(policy?.warningPercent < policy?.economyPercent && policy?.economyPercent < policy?.hardStopPercent)) {
        fail(`${runtimeFixturePath}: ${policyName} thresholds must be strict increasing`);
      }
    }

    for (const [index, route] of (runtimeSnapshot.pricing?.routes ?? []).entries()) {
      const cacheReadPrice = route.cacheReadInputMicroUsdPerMillionTokens;
      if (cacheReadPrice !== undefined && cacheReadPrice > route.inputMicroUsdPerMillionTokens) {
        fail(`${runtimeFixturePath}: pricing.routes[${index}] cache-read price exceeds regular input price`);
      }
      if ("cachedInputMicroUsdPerMillionTokens" in route) {
        fail(`${runtimeFixturePath}: pricing.routes[${index}] uses ambiguous cachedInput pricing`);
      }
    }

    const runtimeSchema = readJson("docs/tenant-chat/schemas/tenant-runtime-snapshot.schema.json");
    const priceRouteProperties = runtimeSchema?.$defs?.priceRoute?.properties ?? {};
    if (!("cacheReadInputMicroUsdPerMillionTokens" in priceRouteProperties)) {
      fail("docs/tenant-chat/schemas/tenant-runtime-snapshot.schema.json: provider cache-read price field is required");
    }
    if ("cachedInputMicroUsdPerMillionTokens" in priceRouteProperties) {
      fail("docs/tenant-chat/schemas/tenant-runtime-snapshot.schema.json: ambiguous cachedInput pricing is forbidden");
    }
    const budgetWarningMaximum = runtimeSchema?.$defs?.budget?.properties?.warningPercent?.maximum;
    if (budgetWarningMaximum !== 98) {
      fail("docs/tenant-chat/schemas/tenant-runtime-snapshot.schema.json: budget warningPercent maximum must be 98");
    }
  }

  const usageSchemaPath = "docs/tenant-chat/schemas/usage-settlement-event.schema.json";
  const usageSchema = readJson(usageSchemaPath);
  const usageVectors = readJson(usageVectorPath);
  if (usageSchema && usageVectors) {
    const eventTypes = new Set();
    for (const [index, event] of (usageVectors.events ?? []).entries()) {
      eventTypes.add(event.eventType);
      if (event.aggregateId !== event.requestId) {
        fail(`${usageVectorPath}: events[${index}] aggregateId must equal requestId`);
      }
      const validationFailures = [];
      validateData(
        usageSchema,
        event,
        { filePath: usageSchemaPath, path: `$.events[${index}]` },
        usageSchema,
        validationFailures,
      );
      for (const validationFailure of validationFailures) {
        fail(`${usageVectorPath}: ${validationFailure}`);
      }
    }
    for (const eventType of [
      "usage_reserved",
      "usage_topped_up",
      "usage_settled",
      "usage_released",
      "usage_unconfirmed",
    ]) {
      if (!eventTypes.has(eventType)) {
        fail(`${usageVectorPath}: missing ${eventType} vector`);
      }
    }

    const employeeEvent = (usageVectors.events ?? []).find(
      (event) => event.executionScope?.actorKind === "employee",
    );
    if (employeeEvent) {
      const invalidEmployeeEvent = structuredClone(employeeEvent);
      delete invalidEmployeeEvent.executionScope.employeeId;
      const negativeFailures = [];
      validateData(
        usageSchema,
        invalidEmployeeEvent,
        { filePath: usageSchemaPath, path: "$.negative.employeeWithoutId" },
        usageSchema,
        negativeFailures,
      );
      if (negativeFailures.length === 0) {
        fail(`${usageSchemaPath}: employee actor must require employeeId`);
      }
    }
  }

  const usageV3SchemaPath = "docs/tenant-chat/schemas/usage-settlement-event-v3.schema.json";
  const usageV3Schema = readJson(usageV3SchemaPath);
  const usageV3Vectors = readJson(usageV3VectorPath);
  if (usageV3Schema && usageV3Vectors) {
    for (const [index, event] of (usageV3Vectors.events ?? []).entries()) {
      const validationFailures = [];
      validateData(
        usageV3Schema,
        event,
        { filePath: usageV3SchemaPath, path: `$.events[${index}]` },
        usageV3Schema,
        validationFailures,
      );
      for (const validationFailure of validationFailures) {
        fail(`${usageV3VectorPath}: ${validationFailure}`);
      }
    }
    const missingCacheOutcome = structuredClone(usageV3Vectors.events?.[0]);
    if (missingCacheOutcome) {
      delete missingCacheOutcome.cacheOutcome;
      const negativeFailures = [];
      validateData(
        usageV3Schema,
        missingCacheOutcome,
        { filePath: usageV3SchemaPath, path: "$.negative.missingCacheOutcome" },
        usageV3Schema,
        negativeFailures,
      );
      if (negativeFailures.length === 0) {
        fail(`${usageV3SchemaPath}: cacheOutcome must be required`);
      }
    }
  }

  const jwtSchemaPath = "docs/tenant-chat/schemas/workload-jwt-claims.schema.json";
  const jwtSchema = readJson(jwtSchemaPath);
  const jwtVectors = readJson(jwtVectorPath);
  if (jwtSchema && jwtVectors) {
    const phases = new Set();
    const bindingByPhase = new Map(
      (bindingVectors?.vectors ?? []).map((vector) => [vector.bindingObject?.phase, vector.expectedBindingDigest]),
    );
    for (const [index, payload] of (jwtVectors.payloads ?? []).entries()) {
      phases.add(payload.phase);
      if (payload.bindingDigest !== bindingByPhase.get(payload.phase)) {
        fail(`${jwtVectorPath}: ${payload.phase} bindingDigest does not match binding vector`);
      }
      const validationFailures = [];
      validateData(
        jwtSchema,
        payload,
        { filePath: jwtSchemaPath, path: `$.payloads[${index}]` },
        jwtSchema,
        validationFailures,
      );
      for (const validationFailure of validationFailures) {
        fail(`${jwtVectorPath}: ${validationFailure}`);
      }
    }
    for (const phase of ["admission", "completion", "cancel"]) {
      if (!phases.has(phase)) {
        fail(`${jwtVectorPath}: missing ${phase} payload`);
      }
    }
  }

  for (const expectedText of [
    "openapi/chat-auth.openapi.json",
    "openapi/admin-runtime.openapi.json",
    "openapi/private-control-plane.openapi.json",
    "openapi/chat-conversation.openapi.json",
    "openapi/private-gateway.openapi.json",
    "db/tenant-chat-content.sql",
    "db/tenant-chat-usage.sql",
    "vectors/binding-digest-vectors.json",
    "schemas/tenant-runtime-snapshot.schema.json",
    "schemas/completion-sse-event.schema.json",
    "schemas/chat-turn-sse-event.schema.json",
    "schemas/chat-conversation.schema.json",
  ]) {
    assertIncludes("docs/tenant-chat/README.md", expectedText);
    assertIncludes("docs/tenant-chat/execution-contract.md", expectedText);
  }
}

function main() {
  for (const doc of [
    ...activeEntryDocs,
    ...currentSnapshotDocs,
    ...tenantChatDocs,
    ...versionStatusDocs,
    ...baselineContractDocs,
    ...historicalV2Docs,
    ...versionedV21Docs,
  ]) {
    if (!doc.includes("*")) {
      assertExists(doc);
    }
  }

  assertRuntimeBaseline();
  assertDocumentationRouting();
  assertCiGate();
  assertSchemaFixturePairs();
  assertTenantChatSchemaFixturePairs();
  assertRuntimeSnapshotGuardrails();
  assertTenantChatExecutableContract();
  for (const failure of verifyCategoryEvaluationDataset({ rootDir })) {
    fail(failure);
  }
  for (const failure of verifyDifficultyEvaluationDataset({ rootDir })) {
    fail(failure);
  }
  for (const failure of verifyDifficultyLabelContract({ rootDir })) {
    fail(failure);
  }
  for (const failure of verifyDifficultyTrainingPilot({ rootDir })) {
    fail(failure);
  }

  if (failures.length > 0) {
    console.error("GateLM documentation verification failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("GateLM documentation verification passed.");
}

main();
