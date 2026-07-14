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
const trainingSmokeManifestPath =
  "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json";
const splitManifestSchemaPath =
  "docs/v2.1.0/schemas/difficulty-training-split-manifest.schema.json";
const labelSchemaPath = "docs/v2.1.0/schemas/difficulty-label-record.schema.json";
const labelFixturePath = "docs/v2.1.0/fixtures/difficulty-label-contract-smoke.fixture.jsonl";
const labelManifestPath = "docs/v2.1.0/fixtures/difficulty-label-contract-smoke.manifest.json";
const labelManifestSchemaPath =
  "docs/v2.1.0/schemas/difficulty-label-dataset-manifest.schema.json";
const historicalLabelSchemaPath =
  "docs/v2.1.0/schemas/difficulty-label-record.v1.schema.json";
const historicalLabelManifestSchemaPath =
  "docs/v2.1.0/schemas/difficulty-label-dataset-manifest.v1.schema.json";
const semanticFeatureContractPath =
  "scripts/routing_difficulty_model/gatelm_difficulty_model/semantic_features.py";
const modelArtifactSchemaPath = "docs/v2.1.0/schemas/difficulty-model-artifact.schema.json";
const trainingPolicyPath = "scripts/routing_difficulty_model/training-policy.v1.json";
const activeSchemaVersion = "gatelm.difficulty-evaluation-record.v1";
const activeLabelSchemaVersion = "gatelm.difficulty-label-record.v2";
const activeLabelManifestSchemaVersion = "gatelm.difficulty-label-dataset-manifest.v2";
const activeCategories = ["general", "code", "translation", "summarization", "reasoning"];
const activeDifficulties = ["simple", "complex"];
const requiredEvaluationFields = ["redactedPrompt", "expectedCategory", "expectedDifficulty", "language"];
const requiredLabelFields = [
  "expectedDifficulty",
  "expectedCategory",
  "semanticInputStatus",
  "taskBucket",
  "constraintBucket",
  "scopeBucket",
  "dependencyBucket",
  "expectedSemanticLabel",
  "promptFamily",
  "language",
  "expectedInstructionPayloadBoundary",
  "evaluationSlices",
  "labelConfidence",
  "reviewStatus",
  "reviewerCount",
];
const requiredEvaluationSlices = [
  "negation",
  "indirect_expression",
  "synonym",
  "short_complex",
  "long_simple",
  "payload_contamination",
  "korean",
  "english",
  "mixed_language",
  "category_confusion",
  "ood_terminology",
];
const semanticLabelsByCategory = {
  general: [
    "general_qa",
    "general_explanation",
    "general_extraction",
    "general_support",
    "general_transformation",
    "general_other",
  ],
  code: [
    "code_generation",
    "code_debugging",
    "code_refactoring",
    "code_review",
    "code_explanation",
    "code_design",
  ],
  translation: ["translation_direct", "translation_localization", "translation_style_preserving"],
  summarization: [
    "summarization_direct",
    "summarization_key_points",
    "summarization_structured",
    "summarization_multi_source",
  ],
  reasoning: [
    "reasoning_comparison",
    "reasoning_planning",
    "reasoning_decision",
    "reasoning_constraint_solving",
    "reasoning_causal",
  ],
};
const semanticHeadTargets = [
  {
    name: "semanticTaskBucket",
    field: "taskBucket",
    classes: ["count_1", "count_2", "count_3_plus"],
  },
  {
    name: "semanticConstraintBucket",
    field: "constraintBucket",
    classes: ["count_0_to_1", "count_2", "count_3_plus"],
  },
  {
    name: "semanticScopeBucket",
    field: "scopeBucket",
    classes: ["count_1", "count_2_to_3", "count_4_plus"],
  },
  {
    name: "semanticDependencyBucket",
    field: "dependencyBucket",
    classes: ["depth_0_to_1", "depth_2", "depth_3_plus"],
  },
];
const semanticInputStatuses = ["eligible", "empty_instruction"];
const nonSemanticHeadTarget = "not_applicable";
const languageSliceByLanguage = { ko: "korean", en: "english", mixed: "mixed_language" };
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
  if (type === "integer") return Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") return Array.isArray(value);
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

  if (typeof value === "number") {
    if (propertySchema.minimum !== undefined && value < propertySchema.minimum) {
      failures.push(`${jsonPath}: expected minimum ${propertySchema.minimum}`);
    }
    if (propertySchema.maximum !== undefined && value > propertySchema.maximum) {
      failures.push(`${jsonPath}: expected maximum ${propertySchema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (propertySchema.minItems !== undefined && value.length < propertySchema.minItems) {
      failures.push(`${jsonPath}: expected minItems ${propertySchema.minItems}`);
    }
    if (propertySchema.maxItems !== undefined && value.length > propertySchema.maxItems) {
      failures.push(`${jsonPath}: expected maxItems ${propertySchema.maxItems}`);
    }
    if (propertySchema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      failures.push(`${jsonPath}: expected unique items`);
    }
    if (propertySchema.items?.enum) {
      value.forEach((item, index) => {
        if (!propertySchema.items.enum.includes(item)) {
          failures.push(`${jsonPath}[${index}]: expected one of ${JSON.stringify(propertySchema.items.enum)}`);
        }
      });
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

function hasExactValues(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

function hasExactOrder(actual, expected) {
  return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
}

function validateLabelSchemaShape(
  schema,
  manifestSchema,
  historicalSchema,
  historicalManifestSchema,
  semanticFeatureContract,
  failures,
) {
  if (schema?.properties?.schemaVersion?.const !== activeLabelSchemaVersion) {
    failures.push(`${labelSchemaPath}: schemaVersion const must be ${activeLabelSchemaVersion}`);
  }
  if (schema?.additionalProperties !== false) {
    failures.push(`${labelSchemaPath}: top-level additionalProperties must be false`);
  }
  for (const field of requiredLabelFields) {
    if (!schema?.required?.includes(field)) {
      failures.push(`${labelSchemaPath}: canonical label schema must require ${field}`);
    }
  }
  if (!hasExactValues(schema?.properties?.expectedCategory?.enum, activeCategories)) {
    failures.push(`${labelSchemaPath}: expectedCategory enum must contain exactly the five active categories`);
  }
  if (!hasExactValues(schema?.properties?.expectedDifficulty?.enum, activeDifficulties)) {
    failures.push(`${labelSchemaPath}: expectedDifficulty enum must contain exactly simple,complex`);
  }
  if (!hasExactValues(schema?.properties?.evaluationSlices?.items?.enum, requiredEvaluationSlices)) {
    failures.push(`${labelSchemaPath}: evaluationSlices must contain exactly the required slice taxonomy`);
  }
  const semanticLabels = Object.values(semanticLabelsByCategory).flat();
  if (!hasExactValues(schema?.properties?.expectedSemanticLabel?.enum, semanticLabels)) {
    failures.push(`${labelSchemaPath}: expectedSemanticLabel enum does not match the category taxonomy`);
  }
  if (!hasExactOrder(schema?.properties?.semanticInputStatus?.enum, semanticInputStatuses)) {
    failures.push(`${labelSchemaPath}: semanticInputStatus must be eligible,empty_instruction in that order`);
  }
  for (const head of semanticHeadTargets) {
    const expectedValues = [...head.classes, nonSemanticHeadTarget];
    if (!hasExactOrder(schema?.properties?.[head.field]?.enum, expectedValues)) {
      failures.push(
        `${labelSchemaPath}: ${head.field} must match ${head.name} class order followed by ${nonSemanticHeadTarget}`,
      );
    }
  }
  if (
    manifestSchema?.properties?.schemaVersion?.const !== activeLabelManifestSchemaVersion ||
    manifestSchema?.additionalProperties !== false
  ) {
    failures.push(`${labelManifestSchemaPath}: closed v2 label dataset manifest schema is required`);
  }
  if (
    historicalSchema?.properties?.schemaVersion?.const !== "gatelm.difficulty-label-record.v1" ||
    historicalSchema?.additionalProperties !== false ||
    historicalManifestSchema?.properties?.schemaVersion?.const !==
      "gatelm.difficulty-label-dataset-manifest.v1" ||
    historicalManifestSchema?.additionalProperties !== false
  ) {
    failures.push(
      `${historicalLabelSchemaPath} and ${historicalLabelManifestSchemaPath}: closed v1 historical snapshots are required`,
    );
  }

  const implementedHeads = [...semanticFeatureContract.matchAll(
    /SemanticHeadSpec\(\s*"([^"]+)"\s*,\s*\(([^)]*)\)\s*,?\s*\)/g,
  )].map((match) => ({
    name: match[1],
    classes: [...match[2].matchAll(/"([^"]+)"/g)].map((classMatch) => classMatch[1]),
  }));
  const expectedHeads = semanticHeadTargets.map(({ name, classes }) => ({ name, classes }));
  if (
    JSON.stringify(implementedHeads) !== JSON.stringify(expectedHeads) ||
    implementedHeads.reduce((total, head) => total + head.classes.length, 0) !== 12
  ) {
    failures.push(
      `${semanticFeatureContractPath}: SEMANTIC_HEAD_SPECS_V1 must match the canonical four-head/12D label class order`,
    );
  }
}

function validateInstructionPayloadBoundary(boundary, prefix, failures) {
  if (!boundary || typeof boundary !== "object" || Array.isArray(boundary)) {
    failures.push(`${prefix}: expected instruction/payload boundary object`);
    return;
  }
  const expectedKeys = ["kind", "boundaryType", "confidence", "payloadBlockCount"];
  const actualKeys = Object.keys(boundary);
  for (const key of expectedKeys) {
    if (!(key in boundary)) failures.push(`${prefix}: missing boundary property ${key}`);
  }
  for (const key of actualKeys) {
    if (!expectedKeys.includes(key)) failures.push(`${prefix}: unexpected boundary property ${key}`);
  }

  const supportedBoundaryTypes = [
    "code_fence",
    "role_tag",
    "role_heading",
    "begin_end",
    "blockquote",
    "inline_cue",
    "multiple",
  ];
  const has = (values, value) => values.includes(value);
  switch (boundary.kind) {
    case "instruction_only":
      if (
        boundary.boundaryType !== "none" ||
        boundary.confidence !== "none" ||
        boundary.payloadBlockCount !== "zero"
      ) {
        failures.push(`${prefix}: instruction_only must use none + none + zero`);
      }
      break;
    case "explicit_separation":
      if (
        !has(supportedBoundaryTypes, boundary.boundaryType) ||
        !has(["low", "medium", "high"], boundary.confidence) ||
        !has(["one", "multiple"], boundary.payloadBlockCount)
      ) {
        failures.push(`${prefix}: invalid explicit_separation boundary tuple`);
      }
      break;
    case "ambiguous_separation":
      if (
        !has(["multiple", "unsupported"], boundary.boundaryType) ||
        boundary.confidence !== "low" ||
        !has(["zero", "one", "multiple"], boundary.payloadBlockCount)
      ) {
        failures.push(`${prefix}: invalid ambiguous_separation boundary tuple`);
      }
      break;
    case "payload_only":
      if (
        !has([...supportedBoundaryTypes, "unsupported"], boundary.boundaryType) ||
        !has(["low", "medium", "high"], boundary.confidence) ||
        !has(["one", "multiple"], boundary.payloadBlockCount)
      ) {
        failures.push(`${prefix}: invalid payload_only boundary tuple`);
      }
      break;
    default:
      failures.push(`${prefix}: unsupported boundary kind ${JSON.stringify(boundary.kind)}`);
  }
}

function validateReviewState(record, prefix, failures) {
  if (record.reviewStatus === "pending" && record.reviewerCount !== 0) {
    failures.push(`${prefix}: pending review must use reviewerCount=0`);
  }
  if (record.labelSource === "synthetic_fixture") {
    if (record.reviewStatus !== "pending" || record.reviewerCount !== 0) {
      failures.push(`${prefix}: synthetic fixture must remain pending with reviewerCount=0`);
    }
  }
  if (["in_review", "approved", "rejected"].includes(record.reviewStatus)) {
    if (record.labelSource !== "human_review" || !Number.isInteger(record.reviewerCount) || record.reviewerCount < 1) {
      failures.push(`${prefix}: ${record.reviewStatus} requires human_review and at least one reviewer`);
    }
  }
  if (record.reviewStatus === "needs_adjudication") {
    if (record.labelSource !== "human_review" || !Number.isInteger(record.reviewerCount) || record.reviewerCount < 2) {
      failures.push(`${prefix}: needs_adjudication requires human_review and at least two reviewers`);
    }
  }
}

function validateLabelRecord(schema, record, lineNumber, failures) {
  const prefix = `${labelFixturePath}: line ${lineNumber}`;
  validateRecord(schema, record, lineNumber, failures, labelFixturePath);
  if (!record || typeof record !== "object" || Array.isArray(record)) return;

  if (!semanticInputStatuses.includes(record.semanticInputStatus)) {
    failures.push(`${prefix}.semanticInputStatus: expected one of ${JSON.stringify(semanticInputStatuses)}`);
  }
  for (const head of semanticHeadTargets) {
    const expectedValues =
      record.semanticInputStatus === "eligible" ? head.classes : [nonSemanticHeadTarget];
    if (!expectedValues.includes(record[head.field])) {
      failures.push(
        `${prefix}.${head.field}: ${record.semanticInputStatus} must use one of ${JSON.stringify(expectedValues)}`,
      );
    }
  }
  if (
    record.expectedInstructionPayloadBoundary?.kind === "payload_only" &&
    record.semanticInputStatus !== "empty_instruction"
  ) {
    failures.push(`${prefix}: payload_only must use semanticInputStatus=empty_instruction`);
  }
  const semanticLabels = semanticLabelsByCategory[record.expectedCategory] ?? [];
  if (!semanticLabels.includes(record.expectedSemanticLabel)) {
    failures.push(
      `${prefix}: semantic label ${JSON.stringify(record.expectedSemanticLabel)} is incompatible with category ${JSON.stringify(record.expectedCategory)}`,
    );
  }

  const slices = Array.isArray(record.evaluationSlices) ? record.evaluationSlices : [];
  if (new Set(slices).size !== slices.length) {
    failures.push(`${prefix}: evaluationSlices must be unique`);
  }
  for (const slice of slices) {
    if (!requiredEvaluationSlices.includes(slice)) {
      failures.push(`${prefix}: unsupported evaluation slice ${JSON.stringify(slice)}`);
    }
  }
  const expectedLanguageSlice = languageSliceByLanguage[record.language];
  const languageSlices = Object.values(languageSliceByLanguage);
  if (expectedLanguageSlice && !slices.includes(expectedLanguageSlice)) {
    failures.push(`${prefix}: language=${record.language} requires slice ${expectedLanguageSlice}`);
  }
  for (const languageSlice of languageSlices) {
    if (slices.includes(languageSlice) && languageSlice !== expectedLanguageSlice) {
      failures.push(`${prefix}: slice ${languageSlice} conflicts with language=${record.language}`);
    }
  }

  if (typeof record.redactedPrompt === "string") {
    const runeLength = [...record.redactedPrompt].length;
    const isShortComplex = record.expectedDifficulty === "complex" && runeLength <= 120;
    const isLongSimple = record.expectedDifficulty === "simple" && runeLength > 120;
    if (slices.includes("short_complex") !== isShortComplex) {
      failures.push(`${prefix}: short_complex must exactly match complex with rune length <= 120 (got ${runeLength})`);
    }
    if (slices.includes("long_simple") !== isLongSimple) {
      failures.push(`${prefix}: long_simple must exactly match simple with rune length > 120 (got ${runeLength})`);
    }
  }

  validateInstructionPayloadBoundary(
    record.expectedInstructionPayloadBoundary,
    `${prefix}.expectedInstructionPayloadBoundary`,
    failures,
  );
  if (
    slices.includes("payload_contamination") &&
    record.expectedInstructionPayloadBoundary?.kind === "instruction_only"
  ) {
    failures.push(`${prefix}: payload_contamination cannot use instruction_only boundary`);
  }
  if (typeof record.promptFamily === "string") {
    const splitNamePattern = /(^|[._:-])(train|calibration|holdout)([._:-]|$)/;
    const timestampPattern = /(^|[._:-])20\d{2}(?:[._:-]?\d{2}){1,5}([._:-]|$)/;
    if (splitNamePattern.test(record.promptFamily) || timestampPattern.test(record.promptFamily)) {
      failures.push(`${prefix}.promptFamily: family id must not encode a split name or timestamp`);
    }
  }
  validateReviewState(record, prefix, failures);
}

function groupLabelFamilies(records, failures) {
  const families = new Map();
  for (const record of records) {
    if (!families.has(record.promptFamily)) families.set(record.promptFamily, []);
    families.get(record.promptFamily).push(record);
  }
  for (const [promptFamily, familyRecords] of families) {
    const categories = new Set(familyRecords.map((record) => record.expectedCategory));
    const semanticLabels = new Set(familyRecords.map((record) => record.expectedSemanticLabel));
    if (categories.size !== 1) {
      failures.push(`${labelFixturePath}: family ${promptFamily} crosses expectedCategory values`);
    }
    if (semanticLabels.size !== 1) {
      failures.push(`${labelFixturePath}: family ${promptFamily} crosses expectedSemanticLabel values`);
    }
  }
  return families;
}

function countFamilies(families, predicate) {
  let count = 0;
  for (const records of families.values()) {
    if (records.some(predicate)) count += 1;
  }
  return count;
}

function computeLabelCoverage(families) {
  const categoryFamilies = Object.fromEntries(
    activeCategories.map((category) => [category, countFamilies(families, (record) => record.expectedCategory === category)]),
  );
  const difficultyFamilies = Object.fromEntries(
    activeDifficulties.map((difficulty) => [
      difficulty,
      countFamilies(families, (record) => record.expectedDifficulty === difficulty),
    ]),
  );
  const categoryDifficultyFamilies = Object.fromEntries(
    activeCategories.map((category) => [
      category,
      Object.fromEntries(
        activeDifficulties.map((difficulty) => [
          difficulty,
          countFamilies(
            families,
            (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
          ),
        ]),
      ),
    ]),
  );
  const languageFamilies = Object.fromEntries(
    ["ko", "en", "mixed", "unknown"].map((language) => [
      language,
      countFamilies(families, (record) => record.language === language),
    ]),
  );
  const evaluationSliceFamilies = Object.fromEntries(
    requiredEvaluationSlices.map((slice) => [
      slice,
      countFamilies(families, (record) => record.evaluationSlices?.includes(slice)),
    ]),
  );
  return {
    categoryFamilies,
    difficultyFamilies,
    categoryDifficultyFamilies,
    languageFamilies,
    evaluationSliceFamilies,
  };
}

function aggregateFamilyReviewStatus(records) {
  if (records.every((record) => record.reviewStatus === "approved")) return "approved";
  if (records.some((record) => record.reviewStatus === "needs_adjudication")) return "needs_adjudication";
  if (records.some((record) => record.reviewStatus === "rejected")) return "rejected";
  if (records.some((record) => record.reviewStatus === "in_review" || record.labelSource === "human_review")) {
    return "in_review";
  }
  return "pending";
}

export function verifyDifficultyLabelContract(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const failures = [];
  const schema = readJson(rootDir, labelSchemaPath, failures);
  const fixtureText = readText(rootDir, labelFixturePath, failures);
  const manifest = readJson(rootDir, labelManifestPath, failures);
  const manifestSchema = readJson(rootDir, labelManifestSchemaPath, failures);
  const historicalSchema = readJson(rootDir, historicalLabelSchemaPath, failures);
  const historicalManifestSchema = readJson(rootDir, historicalLabelManifestSchemaPath, failures);
  const semanticFeatureContract = readText(rootDir, semanticFeatureContractPath, failures);
  if (
    !schema ||
    fixtureText === null ||
    !manifest ||
    !manifestSchema ||
    !historicalSchema ||
    !historicalManifestSchema ||
    semanticFeatureContract === null
  ) {
    return failures;
  }

  validateLabelSchemaShape(
    schema,
    manifestSchema,
    historicalSchema,
    historicalManifestSchema,
    semanticFeatureContract,
    failures,
  );
  const lines = fixtureText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const records = [];
  lines.forEach((line, index) => {
    try {
      const record = JSON.parse(line);
      records.push(record);
      validateLabelRecord(schema, record, index + 1, failures);
    } catch (error) {
      failures.push(`${labelFixturePath}: line ${index + 1}: invalid JSON (${error.message})`);
    }
  });
  if (records.length === 0) failures.push(`${labelFixturePath}: expected at least one JSONL record`);
  if (new Set(records.map((record) => record.sampleId)).size !== records.length) {
    failures.push(`${labelFixturePath}: sampleId values must be unique`);
  }
  if (new Set(records.map((record) => record.datasetVersion)).size !== 1) {
    failures.push(`${labelFixturePath}: expected one datasetVersion`);
  }

  const families = groupLabelFamilies(records, failures);
  const coverage = computeLabelCoverage(families);
  for (const category of activeCategories) {
    if (coverage.categoryFamilies[category] === 0) {
      failures.push(`${labelFixturePath}: missing category family coverage for ${category}`);
    }
  }
  for (const difficulty of activeDifficulties) {
    if (coverage.difficultyFamilies[difficulty] === 0) {
      failures.push(`${labelFixturePath}: missing difficulty family coverage for ${difficulty}`);
    }
  }
  for (const slice of requiredEvaluationSlices) {
    if (coverage.evaluationSliceFamilies[slice] === 0) {
      failures.push(`${labelFixturePath}: missing required evaluation slice family coverage for ${slice}`);
    }
  }

  validateRecord(manifestSchema, manifest, 1, failures, labelManifestPath);
  if (manifest.datasetVersion !== records[0]?.datasetVersion) {
    failures.push(`${labelManifestPath}: datasetVersion mismatch`);
  }
  if (manifest.recordSchemaVersion !== activeLabelSchemaVersion) {
    failures.push(`${labelManifestPath}: recordSchemaVersion must be ${activeLabelSchemaVersion}`);
  }
  if (manifest.datasetPath !== labelFixturePath || manifest.datasetSha256 !== sha256(fixtureText)) {
    failures.push(`${labelManifestPath}: dataset path or SHA-256 mismatch`);
  }
  if (
    manifest.datasetPurpose !== "label_contract_smoke" ||
    manifest.trainingEligible !== false ||
    manifest.labelCoverageStatus !== "complete" ||
    manifest.familyPolicyVersion !== "difficulty-prompt-family.v1" ||
    manifest.trainingGate?.minimumFamilyPolicyStatus !== "decision_required"
  ) {
    failures.push(`${labelManifestPath}: label-contract smoke must be non-training-eligible with a decision_required family gate`);
  }

  const humanReviewedFamilies = [...families.values()].filter((familyRecords) =>
    familyRecords.every((record) => record.labelSource === "human_review" && record.reviewerCount >= 1),
  ).length;
  const approvedHumanReviewedFamilies = [...families.values()].filter((familyRecords) =>
    familyRecords.every(
      (record) => record.labelSource === "human_review" && record.reviewStatus === "approved" && record.reviewerCount >= 1,
    ),
  ).length;
  const semanticHeadEligibleRecords = records.filter(
    (record) => record.semanticInputStatus === "eligible",
  );
  const emptyInstructionRecords = records.filter(
    (record) => record.semanticInputStatus === "empty_instruction",
  );
  const expectedCounts = {
    records: records.length,
    families: families.size,
    humanReviewedFamilies,
    approvedHumanReviewedFamilies,
    semanticHeadEligibleRecords: semanticHeadEligibleRecords.length,
    semanticHeadEligibleFamilies: new Set(
      semanticHeadEligibleRecords.map((record) => record.promptFamily),
    ).size,
    emptyInstructionRecords: emptyInstructionRecords.length,
    emptyInstructionFamilies: new Set(
      emptyInstructionRecords.map((record) => record.promptFamily),
    ).size,
  };
  if (JSON.stringify(manifest.counts) !== JSON.stringify(expectedCounts)) {
    failures.push(`${labelManifestPath}: family-level counts do not match the label records`);
  }
  if (JSON.stringify(manifest.coverage) !== JSON.stringify(coverage)) {
    failures.push(`${labelManifestPath}: family-level coverage does not match the label records`);
  }

  const manifestFamilies = Array.isArray(manifest.families) ? manifest.families : [];
  const manifestFamilyIds = new Set(manifestFamilies.map((family) => family.promptFamily));
  if (manifestFamilyIds.size !== manifestFamilies.length) {
    failures.push(`${labelManifestPath}: prompt family appears in more than one partition (family leakage)`);
  }
  if (manifestFamilies.length !== families.size) {
    failures.push(`${labelManifestPath}: manifest family count does not match label records`);
  }
  for (const [promptFamily, familyRecords] of families) {
    const row = manifestFamilies.find((family) => family.promptFamily === promptFamily);
    if (!row) {
      failures.push(`${labelManifestPath}: missing family row ${promptFamily}`);
      continue;
    }
    const humanReviewed = familyRecords.every(
      (record) => record.labelSource === "human_review" && record.reviewerCount >= 1,
    );
    if (
      row.expectedCategory !== familyRecords[0].expectedCategory ||
      row.expectedSemanticLabel !== familyRecords[0].expectedSemanticLabel ||
      row.reviewStatus !== aggregateFamilyReviewStatus(familyRecords) ||
      row.humanReviewed !== humanReviewed ||
      row.records !== familyRecords.length ||
      row.partition !== "smoke"
    ) {
      failures.push(`${labelManifestPath}: family row ${promptFamily} does not match its records`);
    }
  }
  if (manifest.trainingEligible && approvedHumanReviewedFamilies !== families.size) {
    failures.push(`${labelManifestPath}: unapproved family cannot be training eligible`);
  }
  if (manifest.trainingEligible && manifest.trainingGate?.minimumFamilyPolicyStatus !== "versioned") {
    failures.push(`${labelManifestPath}: training eligibility requires a versioned minimum family policy`);
  }
  return failures;
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
  const smokeManifest = readJson(rootDir, trainingSmokeManifestPath, failures);
  const labelManifestSchema = readJson(rootDir, labelManifestSchemaPath, failures);
  const artifactSchema = readJson(rootDir, modelArtifactSchemaPath, failures);
  const trainingPolicy = readJson(rootDir, trainingPolicyPath, failures);
  if (
    !schema ||
    fixtureText === null ||
    !manifest ||
    !manifestSchema ||
    !smokeManifest ||
    !labelManifestSchema ||
    !artifactSchema ||
    !trainingPolicy
  ) {
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
  validateRecord(labelManifestSchema, smokeManifest, 1, failures, trainingSmokeManifestPath);
  if (
    smokeManifest.schemaVersion !== activeLabelManifestSchemaVersion ||
    smokeManifest.datasetVersion !== "difficulty_eval_2026_07_13_pilot_500_v1" ||
    smokeManifest.recordSchemaVersion !== activeSchemaVersion ||
    smokeManifest.datasetPath !== trainingFixturePath ||
    smokeManifest.datasetSha256 !== sha256(fixtureText) ||
    smokeManifest.datasetPurpose !== "training_tooling_smoke" ||
    smokeManifest.trainingEligible !== false ||
    smokeManifest.labelCoverageStatus !== "unlabeled" ||
    smokeManifest.familyPolicyVersion !== "difficulty-prompt-family.v1" ||
    smokeManifest.trainingGate?.minimumFamilyPolicyStatus !== "decision_required" ||
    smokeManifest.legacyPartitionManifestPath !== splitManifestPath
  ) {
    failures.push(`${trainingSmokeManifestPath}: 500-record pilot must remain an unlabeled, non-training-eligible tooling smoke dataset`);
  }
  if (
    JSON.stringify(smokeManifest.counts) !==
    JSON.stringify({
      records: 500,
      families: 25,
      humanReviewedFamilies: 0,
      approvedHumanReviewedFamilies: 0,
    })
  ) {
    failures.push(`${trainingSmokeManifestPath}: 500-record smoke family counts must remain 500/25/0/0`);
  }
  if (
    records.some(
      (record) =>
        record.labelSource !== "synthetic_fixture" ||
        !record.reviewerNote?.toLowerCase().includes("human review pending"),
    )
  ) {
    failures.push(`${trainingFixturePath}: every 500-record smoke sample must remain synthetic and human-review-pending`);
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
    ...verifyDifficultyLabelContract(),
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
