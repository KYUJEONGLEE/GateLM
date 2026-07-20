import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildIndependentDatasetArtifacts } from "./generate-v2.1-difficulty-independent-ood-5000.mjs";

const root = path.resolve(".");
const datasetPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl";
const splitPaths = {
  train: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.train.jsonl",
  validation: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.validation.jsonl",
  test: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.test.jsonl",
};
const blindReviewPath =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/difficulty-independent-ood-5000.v1.blind-review.jsonl";
const built = buildIndependentDatasetArtifacts();

test("builds an isolated 5,000-record Dataset 2 with family-frozen train, validation, and test splits", () => {
  const { records, splitManifest, manifest } = built;
  assert.equal(records.length, 5000);
  assert.equal(new Set(records.map((record) => record.promptFamily)).size, 1000);
  assert.equal(new Set(records.map((record) => record.sampleId)).size, 5000);
  assert.equal(new Set(records.map((record) => record.redactedPrompt)).size, 5000);
  assert.equal(manifest.datasetPurpose, "independent_dataset_candidate");
  assert.equal(manifest.trainingEligible, false);
  assert.equal(manifest.trainingGate.minimumFamilyPolicyStatus, "decision_required");
  assert.deepEqual(manifest.splitCounts, {
    train: { families: 600, records: 3000 },
    calibration: { families: 200, records: 1000 },
    holdout: { families: 200, records: 1000 },
  });
  const partitionCounts = manifest.families.reduce((counts, family) => {
    counts[family.partition] = (counts[family.partition] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(partitionCounts, { train: 600, calibration: 200, holdout: 200 });
  assert.equal(splitManifest.splits.train.records, 3000);
  assert.equal(splitManifest.splits.train.families, 600);
  assert.equal(splitManifest.splits.validation.records, 1000);
  assert.equal(splitManifest.splits.validation.families, 200);
  assert.equal(splitManifest.splits.test.records, 1000);
  assert.equal(splitManifest.splits.test.families, 200);
  assert.deepEqual(splitManifest.standardManifestProjection, {
    train: "train",
    validation: "calibration",
    test: "holdout",
  });
  assert.equal(splitManifest.dataset1Isolation.usedAsGenerationInput, false);
  assert.deepEqual(splitManifest.dataset1Isolation.sharedGeneratorModules, []);

  const splitByFamily = new Map(splitManifest.assignments.map((assignment) => [assignment.promptFamily, assignment.split]));
  for (const record of records) {
    assert.ok(record.promptFamily.startsWith("independent2."));
    assert.ok(splitByFamily.has(record.promptFamily));
    assert.equal(record.labelSource, "synthetic_fixture");
    assert.equal(record.reviewStatus, "pending");
    assert.equal(record.reviewerCount, 0);
  }
});

test("keeps 600/200/200 families disjoint and balances every category-difficulty cell 300/100/100", () => {
  const { records, splitManifest, artifacts } = built;
  const masterIds = new Set(records.map((record) => record.sampleId));
  const seenIds = new Set();
  const expected = {
    train: { records: 3000, families: 600, cell: 300 },
    validation: { records: 1000, families: 200, cell: 100 },
    test: { records: 1000, families: 200, cell: 100 },
  };
  const familySets = {};
  for (const [split, counts] of Object.entries(expected)) {
    const splitRecords = artifacts[splitPaths[split]].trim().split("\n").map((line) => JSON.parse(line));
    familySets[split] = new Set(splitRecords.map((record) => record.promptFamily));
    assert.equal(splitRecords.length, counts.records);
    assert.equal(familySets[split].size, counts.families);
    assert.equal(splitManifest.splits[split].datasetPath, splitPaths[split]);
    for (const record of splitRecords) {
      assert.equal(masterIds.has(record.sampleId), true);
      assert.equal(seenIds.has(record.sampleId), false);
      seenIds.add(record.sampleId);
    }
    for (const category of ["general", "code", "translation", "summarization", "reasoning"]) {
      for (const difficulty of ["simple", "complex"]) {
        assert.equal(
          splitRecords.filter(
            (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
          ).length,
          counts.cell,
        );
      }
    }
  }
  assert.equal(seenIds.size, 5000);
  assert.equal([...familySets.train].some((family) => familySets.validation.has(family) || familySets.test.has(family)), false);
  assert.equal([...familySets.validation].some((family) => familySets.test.has(family)), false);
});

test("balances every category and provisional difficulty without leaking labels into the blind queue", () => {
  const { records, artifacts } = built;
  for (const category of ["general", "code", "translation", "summarization", "reasoning"]) {
    for (const difficulty of ["simple", "complex"]) {
      assert.equal(
        records.filter((record) => record.expectedCategory === category && record.expectedDifficulty === difficulty).length,
        500,
      );
    }
  }
  assert.deepEqual(
    Object.fromEntries(["ko", "en", "mixed"].map((language) => [
      language,
      records.filter((record) => record.language === language).length,
    ])),
    { ko: 2000, en: 2000, mixed: 1000 },
  );

  const blindRows = artifacts[blindReviewPath].trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(blindRows.length, 5000);
  for (const row of blindRows) {
    assert.deepEqual(Object.keys(row), ["schemaVersion", "datasetVersion", "sampleId", "redactedPrompt", "language"]);
    assert.equal("expectedDifficulty" in row, false);
    assert.equal("expectedCategory" in row, false);
    assert.equal("promptFamily" in row, false);
  }
});

test("enforces the expanded surface and counterfactual diversity gates", () => {
  const { diversityReport } = built;
  assert.equal(diversityReport.counts.exactUniquePrompts, 5000);
  assert.equal(diversityReport.counts.normalizedUniquePrompts, 5000);
  assert.ok(diversityReport.counts.distinctOpeningFiveTokenFingerprints >= 600);
  assert.ok(diversityReport.counts.distinctWordFourGrams >= 30000);
  assert.ok(Object.keys(diversityReport.coverage.rendererUsage).length >= 40);
  assert.ok(Object.keys(diversityReport.coverage.formatUsage).length >= 30);
  assert.ok(Object.keys(diversityReport.coverage.voiceUsage).length >= 15);
  assert.deepEqual(diversityReport.coverage.splitRecords, { test: 1000, train: 3000, validation: 1000 });
  assert.deepEqual(diversityReport.coverage.splitFamilies, { train: 600, validation: 200, test: 200 });
  assert.ok(diversityReport.lengthCounterfactuals.longSimpleRecords >= 300);
  assert.ok(diversityReport.lengthCounterfactuals.shortComplexRecords >= 100);
  assert.equal(diversityReport.lengthCounterfactuals.distributionsOverlap, true);
  for (const slice of [
    "negation",
    "indirect_expression",
    "synonym",
    "short_complex",
    "long_simple",
    "payload_contamination",
    "category_confusion",
    "ood_terminology",
  ]) {
    assert.ok(diversityReport.coverage.evaluationSliceRecords[slice] >= 100, slice);
  }
  assert.equal(diversityReport.withinDatasetOverlap.exactDuplicateRecords, 0);
  assert.equal(diversityReport.withinDatasetOverlap.normalizedDuplicateRecords, 0);
  assert.ok(diversityReport.withinDatasetOverlap.crossFamilyWordFourGramAudit.maximum < 0.8);
});

test("keeps Dataset 1 out of generation and uses it only for post-generation overlap audit", () => {
  const { diversityReport } = built;
  assert.equal(diversityReport.dataset1Comparison.usedAsGenerationInput, false);
  assert.equal(diversityReport.dataset1Comparison.readPhase, "post_generation_overlap_audit_only");
  assert.equal(diversityReport.dataset1Comparison.dataset1Records, 5000);
  assert.equal(diversityReport.dataset1Comparison.exactPromptOverlap, 0);
  assert.equal(diversityReport.dataset1Comparison.normalizedPromptOverlap, 0);
  assert.equal(diversityReport.dataset1Comparison.promptFamilyOverlap, 0);
  assert.ok(diversityReport.dataset1Comparison.wordFourGramAudit.maximum < 0.8);

  const source = readFileSync(
    path.join(root, "scripts/dev/generate-v2.1-difficulty-independent-ood-5000.mjs"),
    "utf8",
  );
  assert.equal(source.includes("generate-v2.1-difficulty-model-path-expansion-3120"), false);
  assert.equal(source.includes("generate-v2.1-difficulty-training-pilot"), false);
});

test("matches every committed generated artifact and the closed split schema", () => {
  for (const [relativePath, expected] of Object.entries(built.artifacts)) {
    assert.equal(readFileSync(path.join(root, relativePath), "utf8"), expected, relativePath);
  }
  const splitSchema = JSON.parse(
    readFileSync(
      path.join(root, "docs/v2.1.0/schemas/difficulty-independent-dataset-split-manifest.schema.json"),
      "utf8",
    ),
  );
  assert.equal(splitSchema.additionalProperties, false);
  assert.equal(
    splitSchema.properties.schemaVersion.const,
    "gatelm.difficulty-independent-dataset-split-manifest.v1",
  );
  assert.equal(splitSchema.properties.assignments.minItems, 1000);
  assert.equal(splitSchema.$defs.trainSplit.allOf[1].properties.records.const, 3000);
  assert.equal(splitSchema.$defs.validationSplit.allOf[1].properties.records.const, 1000);
  assert.equal(splitSchema.$defs.testSplit.allOf[1].properties.records.const, 1000);
  assert.equal(readFileSync(path.join(root, datasetPath), "utf8"), built.artifacts[datasetPath]);
});

test("the checked-in generator is reproducible in check mode", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/dev/generate-v2.1-difficulty-independent-ood-5000.mjs", "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified Dataset 2: 5,000 records, 1,000 families/);
});
