import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = "docs/routing/schemas/difficulty-lightgbm-shadow-profile.schema.json";
const fixturePath = "docs/routing/fixtures/difficulty-lightgbm-shadow-profile.fixture.json";
const expectedCandidates = [
  "tabular_only",
  "embedding_only_768",
  "raw_768",
  "pca_128",
  "pca_256",
];
const expectedFourWayCandidates = [
  "rule_42_plus_e5_small_pca_64",
  "rule_42_plus_semantic_heads_12",
  "e5_base_raw_768",
  "rule_42_plus_e5_base_raw_768",
];
const expectedFeatureNames = [
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
].map((name) => `ruleVectorV1.${name}`);

function readJson(relativePath, failures) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON (${error.message})`);
    return {};
  }
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const failures = [];
const schema = readJson(schemaPath, failures);
const fixture = readJson(fixturePath, failures);
const defs = schema.$defs ?? {};

if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
  failures.push(`${schemaPath}: expected JSON Schema Draft 2020-12`);
}
if (schema.properties?.schemaVersion?.const !== "gatelm.routing-difficulty-lightgbm-shadow-profile.v1") {
  failures.push(`${schemaPath}: profile schema identity drifted`);
}
if (
  defs.encoder?.properties?.modelId?.const !== "intfloat/multilingual-e5-base" ||
  defs.encoder?.properties?.sourceRevision?.const !== "d13f1b27baf31030b7fd040960d60d909913633f" ||
  defs.encoder?.properties?.outputDimension?.const !== 768
) {
  failures.push(`${schemaPath}: pinned 768D encoder identity drifted`);
}
const tabularFeatureShapes =
  defs.featureShape?.properties?.tabularFeatureNames?.oneOf?.map((entry) => entry.const) ?? [];
if (
  !tabularFeatureShapes.some((value) => same(value, [])) ||
  !tabularFeatureShapes.some((value) => same(value, expectedFeatureNames))
) {
  failures.push(`${schemaPath}: exact ruleVectorV1 feature order drifted`);
}
if (
  !same(defs.featureShape?.properties?.ruleDimension?.enum, [0, 42]) ||
  !defs.featureShape?.properties?.totalDimension?.enum?.includes(768) ||
  !defs.model?.properties?.numFeatures?.enum?.includes(768)
) {
  failures.push(`${schemaPath}: embedding-only 768D runtime shape is missing`);
}
const allowedCandidateSets =
  defs.trainingProvenance?.properties?.selectedFrom?.oneOf?.map((entry) => entry.const) ?? [];
if (
  !allowedCandidateSets.some((value) => same(value, expectedCandidates)) ||
  !allowedCandidateSets.some((value) => same(value, expectedFourWayCandidates))
) {
  failures.push(`${schemaPath}: allowed offline candidate sets drifted`);
}

if (
  fixture.schemaVersion !== "gatelm.routing-difficulty-lightgbm-shadow-profile.v1" ||
  fixture.profileVersion !== "difficulty-lightgbm-shadow.e5-base-768.v1" ||
  fixture.contractVersion !== "gatelm.internal.routing-difficulty-lightgbm-shadow.v1" ||
  fixture.promotionState !== "offline_shadow_only"
) {
  failures.push(`${fixturePath}: fixed profile identity is invalid`);
}
if (
  fixture.encoder?.modelId !== "intfloat/multilingual-e5-base" ||
  fixture.encoder?.sourceRevision !== "d13f1b27baf31030b7fd040960d60d909913633f" ||
  fixture.encoder?.outputDimension !== 768 ||
  fixture.encoder?.runtimeArtifacts?.length !== 8
) {
  failures.push(`${fixturePath}: pinned encoder fixture is invalid`);
}
if (!same(fixture.featureShape?.tabularFeatureNames, expectedFeatureNames)) {
  failures.push(`${fixturePath}: exact ruleVectorV1 feature order is invalid`);
}
if (
  fixture.featureShape?.semanticMode !== "raw" ||
  fixture.featureShape?.semanticDimension !== 768 ||
  fixture.featureShape?.totalDimension !== 810 ||
  fixture.featureShape?.projection !== null ||
  fixture.model?.numFeatures !== 810
) {
  failures.push(`${fixturePath}: raw 42D+768D fixture shape is invalid`);
}
if (
  fixture.model?.contentHash !== `sha256:${fixture.model?.sha256 ?? ""}` ||
  !/^sha256:[a-f0-9]{64}$/.test(fixture.model?.contentHash ?? "")
) {
  failures.push(`${fixturePath}: model content identity is invalid`);
}
if (
  fixture.trainingProvenance?.familyDisjoint !== true ||
  fixture.trainingProvenance?.selectionSplit !== "validation" ||
  fixture.trainingProvenance?.testAccess !== "after_selection_freeze" ||
  !same(fixture.trainingProvenance?.selectedFrom, expectedCandidates)
) {
  failures.push(`${fixturePath}: offline-only training provenance is invalid`);
}

if (failures.length > 0) {
  console.error("LightGBM shadow profile verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("LightGBM shadow profile verification passed.");
