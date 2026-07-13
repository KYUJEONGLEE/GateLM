import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyRoutingContract } from "./verify-routing-contract.mjs";

const categories = ["general", "code", "translation", "summarization", "reasoning"];

test("active routing contract accepts one complete 5 x 2 v2 policy", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-contract-"));
  try {
    writeContractFiles(rootDir, validSchema(), validPolicy());

    assert.deepEqual(verifyRoutingContract({ rootDir, verifyDocumentation: false }), []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("active routing contract rejects more than one fallback", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-fallback-count-"));
  try {
    const policy = validPolicy();
    policy.routes.general.simple.modelRefs = ["mock-balanced", "provider:fallback-a", "provider:fallback-b"];
    writeContractFiles(rootDir, validSchema(), policy);

    const failures = verifyRoutingContract({ rootDir, verifyDocumentation: false });
    assert.ok(failures.some((failure) => failure.includes("at most one fallback")));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("active routing contract rejects category-specific primary models", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-primary-profile-"));
  try {
    const policy = validPolicy();
    policy.routes.code.simple.modelRefs = ["provider:code-simple"];
    writeContractFiles(rootDir, validSchema(), policy);

    const failures = verifyRoutingContract({ rootDir, verifyDocumentation: false });
    assert.ok(failures.some((failure) => failure.includes("all simple cells must share")));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("active routing contract rejects a fallback that is not global", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-global-fallback-"));
  try {
    const policy = validPolicy();
    policy.routes.general.simple.modelRefs = ["mock-balanced", "provider:fallback"];
    writeContractFiles(rootDir, validSchema(), policy);

    const failures = verifyRoutingContract({ rootDir, verifyDocumentation: false });
    assert.ok(failures.some((failure) => failure.includes("fallback must be present in all cells")));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("active routing documentation declares the feature-based classification pipeline", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-docs-"));
  try {
    writeContractFiles(rootDir, validSchema(), validPolicy());
    writeRoutingDocumentation(rootDir);

    assert.deepEqual(verifyRoutingContract({ rootDir }), []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("active routing documentation rejects a missing classification pipeline document", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-docs-missing-"));
  try {
    writeContractFiles(rootDir, validSchema(), validPolicy());
    writeRoutingDocumentation(rootDir);
    rmSync(path.join(rootDir, "docs", "routing", "classification-pipeline.md"));

    const failures = verifyRoutingContract({ rootDir });
    assert.ok(
      failures.some((failure) => failure.includes("classification-pipeline.md: file is missing")),
      `missing classification pipeline document was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("active routing documentation rejects an incomplete difficulty feature vector contract", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-feature-vector-incomplete-"));
  try {
    writeContractFiles(rootDir, validSchema(), validPolicy());
    writeRoutingDocumentation(rootDir, {
      featureVector: "difficulty-feature-vector.v1\nDimension\n`42`\nDifficultyFeatureNamesV1\nVectorizeDifficultyFeaturesV1",
    });

    const failures = verifyRoutingContract({ rootDir });
    assert.ok(
      failures.some((failure) => failure.includes("required v1 feature contract marker is missing")),
      `incomplete difficulty feature vector contract was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("active routing documentation rejects a stale 0.5 difficulty threshold", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-threshold-stale-"));
  try {
    writeContractFiles(rootDir, validSchema(), validPolicy());
    writeRoutingDocumentation(rootDir);
    const pipelinePath = path.join(rootDir, "docs", "routing", "classification-pipeline.md");
    const stalePipeline = readFileSync(pipelinePath, "utf8").replaceAll("0.45", "0.5");
    writeFileSync(pipelinePath, stalePipeline, "utf8");

    const failures = verifyRoutingContract({ rootDir });
    assert.ok(
      failures.some((failure) => failure.includes("decision boundary must be 0.45")),
      `stale 0.5 difficulty threshold was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("active routing documentation rejects the retired direct-prompt classifier form", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-docs-legacy-"));
  try {
    writeContractFiles(rootDir, validSchema(), validPolicy());
    writeRoutingDocumentation(rootDir, {
      contracts: `classification-pipeline.md
category = CategoryClassifier(prompt)
difficulty = ComplexityClassifier(prompt, category)`,
    });

    const failures = verifyRoutingContract({ rootDir });
    assert.ok(
      failures.some((failure) => failure.includes("retired direct-prompt classifier form")),
      `retired direct-prompt classifier form was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("RuntimeSnapshot routing v2 rejects selected provider/model fields", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-runtime-routing-contract-"));
  try {
    const snapshot = validRuntimeSnapshotRouting();
    snapshot.selectedModel = "legacy-model";
    writeContractFiles(rootDir, validSchema(), validPolicy(), snapshot);

    const failures = verifyRoutingContract({ rootDir, verifyDocumentation: false });

    assert.ok(
      failures.some(
        (failure) => failure.includes("runtime-snapshot-routing.fixture.json") && failure.includes("selectedModel"),
      ),
      `legacy runtime routing field was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("routing policy schema cannot re-declare a retired legacy field", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-routing-schema-legacy-"));
  try {
    const schema = validSchema();
    schema.properties.defaultModel = { type: "string" };
    writeContractFiles(rootDir, schema, validPolicy());

    const failures = verifyRoutingContract({ rootDir, verifyDocumentation: false });

    assert.ok(
      failures.some(
        (failure) => failure.includes("routing-policy.schema.json") && failure.includes("top-level properties"),
      ),
      `legacy routing schema field was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("RuntimeSnapshot routing schema cannot re-declare a retired legacy field", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-runtime-schema-legacy-"));
  try {
    const runtimeSchema = validRuntimeSnapshotRoutingSchema();
    runtimeSchema.properties.selectedProvider = { type: "string" };
    writeContractFiles(rootDir, validSchema(), validPolicy(), validRuntimeSnapshotRouting(), runtimeSchema);

    const failures = verifyRoutingContract({ rootDir, verifyDocumentation: false });

    assert.ok(
      failures.some(
        (failure) => failure.includes("runtime-snapshot-routing.schema.json") && failure.includes("properties"),
      ),
      `legacy RuntimeSnapshot schema field was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("configured state rejects any remaining mock-balanced route cell", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-configured-mock-contract-"));
  try {
    const policy = validPolicy();
    policy.bootstrapState = "configured";
    writeContractFiles(rootDir, validSchema(), policy);

    const failures = verifyRoutingContract({ rootDir, verifyDocumentation: false });

    assert.ok(
      failures.some((failure) => failure.includes("configured policy must not retain mock-balanced")),
      `configured policy retained Mock silently: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("mock_bootstrap state requires at least one reserved mock-balanced cell", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-bootstrap-without-mock-contract-"));
  try {
    const policy = validPolicy();
    for (const category of categories) {
      policy.routes[category].simple.modelRefs = ["provider:model-simple"];
      policy.routes[category].complex.modelRefs = ["provider:model-complex"];
    }
    writeContractFiles(rootDir, validSchema(), policy);

    const failures = verifyRoutingContract({ rootDir, verifyDocumentation: false });

    assert.ok(
      failures.some((failure) => failure.includes("mock_bootstrap requires at least one mock-balanced")),
      `mock_bootstrap without Mock was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("OpenAI streaming evidence selects an explicit catalog modelRef without legacy tier envs", () => {
  const source = readFileSync(
    new URL("./dev/gateway-openai-stream-20-evidence.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /GATEWAY_(?:DEFAULT_PROVIDER|DEFAULT_MODEL|LOW_COST_MODEL|HIGH_QUALITY_MODEL)/,
  );
  assert.match(source, /model:\s*openAIModelRef/);
  assert.match(source, /GATEWAY_OPENAI_EXTRA_MODELS:\s*openAIModelName/);
});

test("active demo routing evidence relies on the v2 bootstrap policy, not legacy tier envs", () => {
  for (const relativePath of [
    "./dev/gateway-routing-long-100-evidence.mjs",
    "./dev/gateway-stage-timing-1k-evidence.mjs",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /GATEWAY_(?:DEFAULT_PROVIDER|DEFAULT_MODEL|LOW_COST_MODEL|HIGH_QUALITY_MODEL)/,
      relativePath,
    );
  }
});

function writeContractFiles(
  rootDir,
  schema,
  fixture,
  runtimeFixture = validRuntimeSnapshotRouting(),
  runtimeSchema = validRuntimeSnapshotRoutingSchema(),
) {
  const schemaDir = path.join(rootDir, "docs", "routing", "schemas");
  const fixtureDir = path.join(rootDir, "docs", "routing", "fixtures");
  mkdirSync(schemaDir, { recursive: true });
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(schemaDir, "routing-policy.schema.json"), JSON.stringify(schema), "utf8");
  writeFileSync(
    path.join(schemaDir, "runtime-snapshot-routing.schema.json"),
    JSON.stringify(runtimeSchema),
    "utf8",
  );
  writeFileSync(path.join(fixtureDir, "routing-policy.fixture.json"), JSON.stringify(fixture), "utf8");
  writeFileSync(
    path.join(fixtureDir, "runtime-snapshot-routing.fixture.json"),
    JSON.stringify(runtimeFixture),
    "utf8",
  );
}

function writeRoutingDocumentation(rootDir, overrides = {}) {
  const featureVectorNames = [
    "payloadEmpty", "payloadSmall", "payloadMedium", "payloadLarge",
    "taskCount", "constraintCount", "scopeCount", "dependencyDepth",
    "categoryGeneral", "categoryCode", "categoryTranslation", "categorySummarization", "categoryReasoning",
    "generalWorkflowDepth", "generalBranchOrExceptionCount", "generalExtractionBreadth", "generalHasCrossSourceSynthesis",
    "codeOperationUnknown", "codeOperationSyntax", "codeOperationExample", "codeOperationSmallEdit", "codeOperationDebug",
    "codeOperationRefactor", "codeOperationDesign", "codeOperationMigration", "codeOperationConcurrency", "codeOperationPerformance",
    "codeScopeBreadth", "codeCausalComplexity", "codeEngineeringConstraintCount",
    "translationScopeCount", "translationPreservationConstraintCount", "translationDomainTerminologyLevel", "translationLocalizationDegree",
    "summarizationSourceBreadth", "summarizationSynthesisLevel", "summarizationFacetCount", "summarizationHasTraceabilityConstraints",
    "reasoningAlternativeCount", "reasoningCriteriaAndConstraintCount", "reasoningDepth", "reasoningUncertaintyScenarioCount",
  ];
  const documents = {
    "docs/routing/README.md": "classification-pipeline.md\ndifficulty-feature-vector-v1.md\ndifficulty-logistic-training.md",
    "docs/routing/contracts.md": [
      "classification-pipeline.md",
      "difficulty-feature-vector-v1.md",
      "difficulty-threshold-v1 = 0.45",
      "ComplexityScore >= 0.45",
      "Simple model",
      "Complex model",
      "Fallback model",
      "default/balanced",
      "read/execution compatibility",
    ].join("\n"),
    "docs/routing/classification-pipeline.md": [
      "Active routing target contract",
      "ExtractPromptFeatures",
      "PromptFeatures",
      "CategoryResult",
      "ExtractDifficultyFeatures",
      "DifficultyFeatures",
      "DifficultyResult",
      "Go struct",
      "compatibility wrapper",
      "difficulty-feature-vector-v1.md",
      "hard-complex",
      "1.0 + complex",
      "Bounded-simple",
      "-difficulty-shadow-model-artifact",
      "model path",
      "difficulty-threshold-v1 = 0.45",
      "ComplexityScore >= 0.45",
    ].join("\n"),
    "docs/routing/difficulty-feature-vector-v1.md": [
      "difficulty-feature-vector.v1",
      "Dimension",
      "`42`",
      "DifficultyFeatureNamesV1",
      "VectorizeDifficultyFeaturesV1",
      "float64(clamp(value, 0, max)) / float64(max)",
      "canonicalCategory",
      "zero-fill",
      "intercept",
      ...featureVectorNames.map((name) => `\`${name}\``),
    ].join("\n"),
    "docs/routing/difficulty-logistic-training.md": "Offline tooling prepared\ndifficulty-threshold-v1 = 0.45",
    "docs/current/README.md": "../routing/README.md",
    "docs/current/source-of-truth.md": "../routing/README.md\n../routing/classification-pipeline.md",
    "docs/v2.0.0/README.md": "Superseded by active routing contract",
    "docs/v2.0.0/contracts.md": "Superseded by active routing contract",
  };

  if (overrides.contracts !== undefined) {
    documents["docs/routing/contracts.md"] = overrides.contracts;
  }
  if (overrides.pipeline !== undefined) {
    documents["docs/routing/classification-pipeline.md"] = overrides.pipeline;
  }
  if (overrides.featureVector !== undefined) {
    documents["docs/routing/difficulty-feature-vector-v1.md"] = overrides.featureVector;
  }

  for (const [relativePath, content] of Object.entries(documents)) {
    const absolutePath = path.join(rootDir, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
}

function validPolicy() {
  return {
    schemaVersion: "gatelm.routing-policy.v2",
    mode: "auto",
    bootstrapState: "mock_bootstrap",
    routingPolicyHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    routes: Object.fromEntries(
      categories.map((category) => [
        category,
        {
          simple: { modelRefs: ["mock-balanced"] },
          complex: { modelRefs: ["mock-balanced"] },
        },
      ]),
    ),
  };
}

function validRuntimeSnapshotRouting() {
  const policy = validPolicy();
  return {
    mode: policy.mode,
    bootstrapState: policy.bootstrapState,
    routingPolicyHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    routes: policy.routes,
  };
}

function validRuntimeSnapshotRoutingSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://gatelm.local/docs/routing/schemas/runtime-snapshot-routing.schema.json",
    title: "GateLM RuntimeSnapshot Routing v2",
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["auto", "manual"] },
      bootstrapState: { type: "string", enum: ["mock_bootstrap", "configured"] },
      routingPolicyHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      routes: { $ref: "routing-policy.schema.json#/properties/routes" },
    },
    required: ["mode", "bootstrapState", "routingPolicyHash", "routes"],
  };
}

function validSchema() {
  const routeCell = {
    type: "object",
    additionalProperties: false,
    properties: {
      modelRefs: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: { type: "string", minLength: 1 },
      },
    },
    required: ["modelRefs"],
  };
  const categoryRoute = {
    type: "object",
    additionalProperties: false,
    properties: { simple: routeCell, complex: routeCell },
    required: ["simple", "complex"],
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://gatelm.local/docs/routing/schemas/routing-policy.schema.json",
    title: "GateLM Routing Policy v2",
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: "gatelm.routing-policy.v2" },
      mode: { type: "string", enum: ["auto", "manual"] },
      bootstrapState: { type: "string", enum: ["mock_bootstrap", "configured"] },
      routingPolicyHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      routes: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(categories.map((category) => [category, categoryRoute])),
        required: categories,
      },
    },
    required: ["schemaVersion", "mode", "bootstrapState", "routingPolicyHash", "routes"],
  };
}
