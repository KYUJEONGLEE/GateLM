import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPath = "docs/routing/schemas/routing-policy.schema.json";
const fixturePath = "docs/routing/fixtures/routing-policy.fixture.json";
const runtimeSchemaPath = "docs/routing/schemas/runtime-snapshot-routing.schema.json";
const runtimeFixturePath = "docs/routing/fixtures/runtime-snapshot-routing.fixture.json";

export const routingCategories = [
  "general",
  "code",
  "translation",
  "summarization",
  "reasoning",
];

export const routingDifficulties = ["simple", "complex"];

const difficultyFeatureVectorV1Names = [
  "payloadEmpty",
  "payloadSmall",
  "payloadMedium",
  "payloadLarge",
  "taskCount",
  "constraintCount",
  "scopeCount",
  "dependencyDepth",
  "categoryGeneral",
  "categoryCode",
  "categoryTranslation",
  "categorySummarization",
  "categoryReasoning",
  "generalWorkflowDepth",
  "generalBranchOrExceptionCount",
  "generalExtractionBreadth",
  "generalHasCrossSourceSynthesis",
  "codeOperationUnknown",
  "codeOperationSyntax",
  "codeOperationExample",
  "codeOperationSmallEdit",
  "codeOperationDebug",
  "codeOperationRefactor",
  "codeOperationDesign",
  "codeOperationMigration",
  "codeOperationConcurrency",
  "codeOperationPerformance",
  "codeScopeBreadth",
  "codeCausalComplexity",
  "codeEngineeringConstraintCount",
  "translationScopeCount",
  "translationPreservationConstraintCount",
  "translationDomainTerminologyLevel",
  "translationLocalizationDegree",
  "summarizationSourceBreadth",
  "summarizationSynthesisLevel",
  "summarizationFacetCount",
  "summarizationHasTraceabilityConstraints",
  "reasoningAlternativeCount",
  "reasoningCriteriaAndConstraintCount",
  "reasoningDepth",
  "reasoningUncertaintyScenarioCount",
];

const retiredKeys = new Set([
  "tier",
  "expectedTier",
  "selectedProvider",
  "selectedModel",
  "highQualityProvider",
  "highQualityModel",
  "defaultProvider",
  "defaultModel",
  "lowCostProvider",
  "lowCostModel",
  "fallbackProvider",
  "fallbackModel",
]);

function readJson(rootDir, relativePath, failures) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`);
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((item) => actual.includes(item))
  );
}

function validateSchema(schema, failures) {
  if (!isObject(schema)) return;

  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    failures.push(`${schemaPath}: expected JSON Schema Draft 2020-12`);
  }
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    failures.push(`${schemaPath}: top-level policy must be a closed object`);
  }
  if (
    !sameMembers(Object.keys(schema.properties ?? {}), [
      "schemaVersion",
      "mode",
      "bootstrapState",
      "routingPolicyHash",
      "routes",
    ])
  ) {
    failures.push(`${schemaPath}: top-level properties must be exactly the v2 hard-cutover shape`);
  }
  if (schema.properties?.schemaVersion?.const !== "gatelm.routing-policy.v2") {
    failures.push(`${schemaPath}: schemaVersion must be gatelm.routing-policy.v2`);
  }
  if (!sameMembers(schema.properties?.mode?.enum, ["auto", "manual"])) {
    failures.push(`${schemaPath}: mode must be exactly auto|manual`);
  }
  if (
    !sameMembers(schema.properties?.bootstrapState?.enum, ["mock_bootstrap", "configured"])
  ) {
    failures.push(`${schemaPath}: bootstrapState must be exactly mock_bootstrap|configured`);
  }
  if (schema.properties?.routingPolicyHash?.pattern !== "^sha256:[a-f0-9]{64}$") {
    failures.push(`${schemaPath}: routingPolicyHash must be a canonical sha256 value`);
  }
  if (
    !sameMembers(schema.required, [
      "schemaVersion",
      "mode",
      "bootstrapState",
      "routingPolicyHash",
      "routes",
    ])
  ) {
    failures.push(`${schemaPath}: required top-level fields are not the v2 hard-cutover shape`);
  }

  const routes = schema.properties?.routes;
  if (!isObject(routes) || routes.type !== "object" || routes.additionalProperties !== false) {
    failures.push(`${schemaPath}: routes must be a closed object`);
    return;
  }
  if (!sameMembers(Object.keys(routes.properties ?? {}), routingCategories)) {
    failures.push(`${schemaPath}: routes properties must be exactly ${routingCategories.join(",")}`);
  }
  if (!sameMembers(routes.required, routingCategories)) {
    failures.push(`${schemaPath}: all five categories must be required`);
  }

  for (const category of routingCategories) {
    const categorySchema = routes.properties?.[category];
    if (
      !isObject(categorySchema) ||
      categorySchema.type !== "object" ||
      categorySchema.additionalProperties !== false
    ) {
      failures.push(`${schemaPath}: routes.${category} must be a closed object`);
      continue;
    }
    if (!sameMembers(Object.keys(categorySchema.properties ?? {}), routingDifficulties)) {
      failures.push(`${schemaPath}: routes.${category} must contain exactly simple and complex`);
    }
    if (!sameMembers(categorySchema.required, routingDifficulties)) {
      failures.push(`${schemaPath}: routes.${category} must require simple and complex`);
    }

    for (const difficulty of routingDifficulties) {
      const cell = categorySchema.properties?.[difficulty];
      const modelRefs = cell?.properties?.modelRefs;
      if (!isObject(cell) || cell.type !== "object" || cell.additionalProperties !== false) {
        failures.push(`${schemaPath}: routes.${category}.${difficulty} must be a closed object`);
        continue;
      }
      if (!sameMembers(cell.required, ["modelRefs"])) {
        failures.push(`${schemaPath}: routes.${category}.${difficulty} must require modelRefs`);
      }
      if (
        modelRefs?.type !== "array" ||
        modelRefs.minItems !== 1 ||
        modelRefs.maxItems !== 2 ||
        modelRefs.uniqueItems !== true ||
        modelRefs.items?.type !== "string" ||
        modelRefs.items?.minLength !== 1
      ) {
        failures.push(
          `${schemaPath}: routes.${category}.${difficulty}.modelRefs must contain one primary and at most one fallback`,
        );
      }
    }
  }
}

function findRetiredKeys(value, jsonPath, failures, sourcePath = fixturePath) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findRetiredKeys(item, `${jsonPath}[${index}]`, failures, sourcePath),
    );
    return;
  }
  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (retiredKeys.has(key)) {
      failures.push(`${sourcePath}: ${jsonPath}.${key} is retired from routing contract v2`);
    }
    findRetiredKeys(child, `${jsonPath}.${key}`, failures, sourcePath);
  }
}

function validateRuntimeSnapshotSchema(schema, failures) {
  if (!isObject(schema)) return;

  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    failures.push(`${runtimeSchemaPath}: expected JSON Schema Draft 2020-12`);
  }
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    failures.push(`${runtimeSchemaPath}: RuntimeSnapshot routing must be a closed object`);
  }
  if (
    !sameMembers(Object.keys(schema.properties ?? {}), [
      "mode",
      "bootstrapState",
      "routingPolicyHash",
      "routes",
    ])
  ) {
    failures.push(`${runtimeSchemaPath}: properties must be exactly the v2 runtime routing shape`);
  }
  if (!sameMembers(schema.required, ["mode", "bootstrapState", "routingPolicyHash", "routes"])) {
    failures.push(`${runtimeSchemaPath}: required fields must be exactly the v2 runtime routing shape`);
  }
  if (!sameMembers(schema.properties?.mode?.enum, ["auto", "manual"])) {
    failures.push(`${runtimeSchemaPath}: mode must be exactly auto|manual`);
  }
  if (
    !sameMembers(schema.properties?.bootstrapState?.enum, ["mock_bootstrap", "configured"])
  ) {
    failures.push(`${runtimeSchemaPath}: bootstrapState must be exactly mock_bootstrap|configured`);
  }
  if (schema.properties?.routingPolicyHash?.pattern !== "^sha256:[a-f0-9]{64}$") {
    failures.push(`${runtimeSchemaPath}: routingPolicyHash must be a canonical sha256 value`);
  }
  if (schema.properties?.routes?.$ref !== "routing-policy.schema.json#/properties/routes") {
    failures.push(`${runtimeSchemaPath}: routes must reuse the canonical routing policy matrix schema`);
  }
}

function validateRuntimeSnapshotFixture(runtimeRouting, failures) {
  if (!isObject(runtimeRouting)) {
    failures.push(`${runtimeFixturePath}: expected JSON object`);
    return;
  }

  findRetiredKeys(runtimeRouting, "$", failures, runtimeFixturePath);
  if (
    !sameMembers(Object.keys(runtimeRouting), [
      "mode",
      "bootstrapState",
      "routingPolicyHash",
      "routes",
    ])
  ) {
    failures.push(`${runtimeFixturePath}: fields must be exactly the v2 runtime routing shape`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(runtimeRouting.routingPolicyHash ?? "")) {
    failures.push(`${runtimeFixturePath}: routingPolicyHash must be a canonical sha256 value`);
  }

  const routeFailures = [];
  validateFixture(
    {
      schemaVersion: "gatelm.routing-policy.v2",
      mode: runtimeRouting.mode,
      bootstrapState: runtimeRouting.bootstrapState,
      routingPolicyHash: runtimeRouting.routingPolicyHash,
      routes: runtimeRouting.routes,
    },
    routeFailures,
  );
  failures.push(...routeFailures.map((failure) => failure.replace(fixturePath, runtimeFixturePath)));
}

function validateFixture(policy, failures) {
  if (!isObject(policy)) {
    failures.push(`${fixturePath}: expected JSON object`);
    return;
  }

  findRetiredKeys(policy, "$", failures);

  const expectedTopLevelKeys = [
    "schemaVersion",
    "mode",
    "bootstrapState",
    "routingPolicyHash",
    "routes",
  ];
  if (!sameMembers(Object.keys(policy), expectedTopLevelKeys)) {
    failures.push(`${fixturePath}: top-level fields must be exactly the v2 hard-cutover shape`);
  }
  if (policy.schemaVersion !== "gatelm.routing-policy.v2") {
    failures.push(`${fixturePath}: schemaVersion must be gatelm.routing-policy.v2`);
  }
  if (!["auto", "manual"].includes(policy.mode)) {
    failures.push(`${fixturePath}: mode must be auto or manual`);
  }
  if (!["mock_bootstrap", "configured"].includes(policy.bootstrapState)) {
    failures.push(`${fixturePath}: bootstrapState must be mock_bootstrap or configured`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(policy.routingPolicyHash ?? "")) {
    failures.push(`${fixturePath}: routingPolicyHash must be a canonical sha256 value`);
  }
  if (!isObject(policy.routes)) {
    failures.push(`${fixturePath}: routes must be an object`);
    return;
  }
  if (!sameMembers(Object.keys(policy.routes), routingCategories)) {
    failures.push(`${fixturePath}: routes must contain exactly five active categories`);
  }

  let containsMockBalanced = false;
  let simplePrimary;
  let complexPrimary;
  let fallbackModelRef;
  for (const category of routingCategories) {
    const categoryRoute = policy.routes[category];
    if (!isObject(categoryRoute)) {
      failures.push(`${fixturePath}: routes.${category} is required`);
      continue;
    }
    if (!sameMembers(Object.keys(categoryRoute), routingDifficulties)) {
      failures.push(`${fixturePath}: routes.${category} must contain exactly simple and complex`);
    }

    for (const difficulty of routingDifficulties) {
      const cell = categoryRoute[difficulty];
      const modelRefs = cell?.modelRefs;
      if (!isObject(cell) || !sameMembers(Object.keys(cell), ["modelRefs"])) {
        failures.push(`${fixturePath}: routes.${category}.${difficulty} must contain only modelRefs`);
        continue;
      }
      if (
        !Array.isArray(modelRefs) ||
        modelRefs.length === 0 ||
        modelRefs.length > 2 ||
        modelRefs.some((modelRef) => typeof modelRef !== "string" || modelRef.length === 0)
      ) {
        failures.push(`${fixturePath}: routes.${category}.${difficulty}.modelRefs must contain one primary and at most one fallback`);
        continue;
      }
      if (new Set(modelRefs).size !== modelRefs.length) {
        failures.push(`${fixturePath}: routes.${category}.${difficulty}.modelRefs must not repeat`);
      }
      if (modelRefs.includes("mock-balanced")) containsMockBalanced = true;

      const expectedPrimary = difficulty === "simple" ? simplePrimary : complexPrimary;
      if (expectedPrimary === undefined) {
        if (difficulty === "simple") simplePrimary = modelRefs[0];
        else complexPrimary = modelRefs[0];
      } else if (modelRefs[0] !== expectedPrimary) {
        failures.push(`${fixturePath}: all ${difficulty} cells must share one primary modelRef`);
      }

      const cellFallback = modelRefs[1];
      if (fallbackModelRef === undefined && cellFallback !== undefined) {
        fallbackModelRef = cellFallback;
      }
      if (
        fallbackModelRef !== undefined &&
        cellFallback !== undefined &&
        cellFallback !== fallbackModelRef
      ) {
        failures.push(`${fixturePath}: every cell must share the same optional fallback modelRef`);
      }
    }
  }

  if (fallbackModelRef !== undefined) {
    const hasMissingGlobalFallback = routingCategories.some((category) =>
      routingDifficulties.some(
        (difficulty) => policy.routes[category]?.[difficulty]?.modelRefs?.[1] === undefined,
      ),
    );
    if (hasMissingGlobalFallback) {
      failures.push(`${fixturePath}: fallback must be present in all cells or omitted from all cells`);
    }
    if (fallbackModelRef === simplePrimary || fallbackModelRef === complexPrimary) {
      failures.push(`${fixturePath}: fallback must differ from both primary modelRefs`);
    }
  }

  if (policy.bootstrapState === "mock_bootstrap" && !containsMockBalanced) {
    failures.push(`${fixturePath}: mock_bootstrap requires at least one mock-balanced route cell`);
  }
  if (policy.bootstrapState === "configured" && containsMockBalanced) {
    failures.push(`${fixturePath}: configured policy must not retain mock-balanced route cells`);
  }
}

function validateDocumentation(rootDir, failures) {
  const requiredPaths = [
    "docs/routing/README.md",
    "docs/routing/contracts.md",
    "docs/routing/classification-pipeline.md",
    "docs/routing/difficulty-feature-vector-v1.md",
    "docs/routing/difficulty-logistic-training.md",
    "docs/current/README.md",
    "docs/current/source-of-truth.md",
    "docs/v2.0.0/README.md",
    "docs/v2.0.0/contracts.md",
  ];

  const texts = new Map();
  for (const relativePath of requiredPaths) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!existsSync(absolutePath)) {
      failures.push(`${relativePath}: file is missing`);
      continue;
    }
    texts.set(relativePath, readFileSync(absolutePath, "utf8"));
  }

  if (!texts.get("docs/current/README.md")?.includes("../routing/README.md")) {
    failures.push("docs/current/README.md: active routing contract link is missing");
  }
  if (!texts.get("docs/current/source-of-truth.md")?.includes("../routing/README.md")) {
    failures.push("docs/current/source-of-truth.md: active routing authority link is missing");
  }
  if (!texts.get("docs/routing/README.md")?.includes("classification-pipeline.md")) {
    failures.push("docs/routing/README.md: classification pipeline link is missing");
  }
  if (!texts.get("docs/routing/README.md")?.includes("difficulty-feature-vector-v1.md")) {
    failures.push("docs/routing/README.md: difficulty feature vector v1 link is missing");
  }
  if (!texts.get("docs/routing/README.md")?.includes("difficulty-logistic-training.md")) {
    failures.push("docs/routing/README.md: difficulty Logistic training boundary link is missing");
  }
  if (!texts.get("docs/routing/contracts.md")?.includes("classification-pipeline.md")) {
    failures.push("docs/routing/contracts.md: classification pipeline contract link is missing");
  }
  if (!texts.get("docs/routing/contracts.md")?.includes("difficulty-feature-vector-v1.md")) {
    failures.push("docs/routing/contracts.md: difficulty feature vector v1 contract link is missing");
  }
  for (const marker of [
    "Simple model",
    "Complex model",
    "Fallback model",
    "default/balanced",
    "read/execution compatibility",
  ]) {
    if (!texts.get("docs/routing/contracts.md")?.includes(marker)) {
      failures.push(`docs/routing/contracts.md: transitional authoring marker is missing: ${marker}`);
    }
  }
  if (!texts.get("docs/routing/classification-pipeline.md")?.includes("difficulty-feature-vector-v1.md")) {
    failures.push("docs/routing/classification-pipeline.md: difficulty feature vector v1 contract link is missing");
  }
  if (!texts.get("docs/current/source-of-truth.md")?.includes("../routing/classification-pipeline.md")) {
    failures.push("docs/current/source-of-truth.md: classification pipeline authority link is missing");
  }

  const historicalThresholdPolicyMarker = "difficulty-threshold-v1 = 0.45";
  for (const relativePath of ["docs/routing/contracts.md", "docs/routing/classification-pipeline.md"]) {
    if (!texts.get(relativePath)?.includes(historicalThresholdPolicyMarker)) {
      failures.push(`${relativePath}: historical bootstrap difficulty threshold policy is missing`);
    }
  }
  if (!texts.get("docs/routing/difficulty-logistic-training.md")?.includes(historicalThresholdPolicyMarker)) {
    failures.push("docs/routing/difficulty-logistic-training.md: historical training threshold policy is missing");
  }

  const runtimeThresholdPolicyMarker =
    "difficulty-threshold.model-path-5000.2026-07-16.v1 = 0.096";
  const runtimeThresholdDecisionMarker = "ComplexityScore >= 0.096";
  for (const relativePath of ["docs/routing/contracts.md", "docs/routing/classification-pipeline.md"]) {
    if (!texts.get(relativePath)?.includes(runtimeThresholdPolicyMarker)) {
      failures.push(`${relativePath}: authoritative runtime threshold policy must be 0.096`);
    }
    if (!texts.get(relativePath)?.includes(runtimeThresholdDecisionMarker)) {
      failures.push(`${relativePath}: authoritative ComplexityScore decision boundary must be 0.096`);
    }
  }

  const pipelinePath = "docs/routing/classification-pipeline.md";
  const pipeline = texts.get(pipelinePath) ?? "";
  for (const marker of [
    "Active routing target contract",
    "ExtractPromptFeatures",
    "PromptFeatures",
    "CategoryResult",
    "ExtractDifficultyFeatures",
    "DifficultyFeatures",
    "DifficultyResult",
    "Go struct",
    "compatibility wrapper",
    "hard-complex",
    "1.0 + complex",
    "Bounded-simple",
    "-difficulty-shadow-model-artifact",
    "model path",
  ]) {
    if (!pipeline.includes(marker)) {
      failures.push(`${pipelinePath}: required canonical pipeline marker is missing: ${marker}`);
    }
  }

  const featureVectorPath = "docs/routing/difficulty-feature-vector-v1.md";
  const featureVector = texts.get(featureVectorPath) ?? "";
  for (const marker of [
    "difficulty-feature-vector.v1",
    "Dimension",
    "`42`",
    "DifficultyFeatureNamesV1",
    "VectorizeDifficultyFeaturesV1",
    "float64(clamp(value, 0, max)) / float64(max)",
    "canonicalCategory",
    "zero-fill",
    "intercept",
  ]) {
    if (!featureVector.includes(marker)) {
      failures.push(`${featureVectorPath}: required v1 feature contract marker is missing: ${marker}`);
    }
  }

  let previousFeatureIndex = -1;
  for (const featureName of difficultyFeatureVectorV1Names) {
    const featureIndex = featureVector.indexOf(`\`${featureName}\``, previousFeatureIndex + 1);
    if (featureIndex < 0) {
      failures.push(`${featureVectorPath}: v1 feature is missing or out of order: ${featureName}`);
      break;
    }
    previousFeatureIndex = featureIndex;
  }

  const retiredDirectPromptForms = [
    "category = CategoryClassifier(prompt)",
    "difficulty = ComplexityClassifier(prompt, category)",
  ];
  for (const relativePath of ["docs/routing/contracts.md", pipelinePath]) {
    for (const retiredForm of retiredDirectPromptForms) {
      if (texts.get(relativePath)?.includes(retiredForm)) {
        failures.push(`${relativePath}: retired direct-prompt classifier form is still canonical: ${retiredForm}`);
      }
    }
  }

  for (const relativePath of ["docs/v2.0.0/README.md", "docs/v2.0.0/contracts.md"]) {
    if (!texts.get(relativePath)?.includes("Superseded by active routing contract")) {
      failures.push(`${relativePath}: Superseded by active routing contract annotation is missing`);
    }
  }
}

export function verifyRoutingContract(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const failures = [];
  const schema = readJson(rootDir, schemaPath, failures);
  const fixture = readJson(rootDir, fixturePath, failures);
  const runtimeSchema = readJson(rootDir, runtimeSchemaPath, failures);
  const runtimeFixture = readJson(rootDir, runtimeFixturePath, failures);

  validateSchema(schema, failures);
  validateFixture(fixture, failures);
  validateRuntimeSnapshotSchema(runtimeSchema, failures);
  validateRuntimeSnapshotFixture(runtimeFixture, failures);
  if (options.verifyDocumentation !== false) validateDocumentation(rootDir, failures);

  return failures;
}

function main() {
  const failures = verifyRoutingContract();
  if (failures.length > 0) {
    console.error("active routing contract verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("active routing contract verification passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
