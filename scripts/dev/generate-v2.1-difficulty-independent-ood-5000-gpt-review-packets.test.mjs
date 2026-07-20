import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildGptReviewKitArtifacts } from "./generate-v2.1-difficulty-independent-ood-5000-gpt-review-packets.mjs";

const root = path.resolve(".");
const built = buildGptReviewKitArtifacts();

test("builds 50 blind ChatGPT batches of 100 records", () => {
  assert.equal(built.manifest.batchCount, 50);
  assert.equal(built.manifest.batchSize, 100);
  assert.equal(built.manifest.records, 5000);
  const sampleIds = new Set();
  const forbiddenKeys = new Set([
    "expectedCategory",
    "expectedDifficulty",
    "semanticInputStatus",
    "taskBucket",
    "constraintBucket",
    "scopeBucket",
    "dependencyBucket",
    "expectedSemanticLabel",
    "promptFamily",
    "evaluationSlices",
    "split",
    "partition",
  ]);
  for (const packet of built.manifest.packets) {
    const rows = built.artifacts[packet.inputPath].trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, 100);
    assert.deepEqual(rows.map((row) => row.position), Array.from({ length: 100 }, (_, index) => index + 1));
    for (const row of rows) {
      assert.equal(row.batchId, packet.batchId);
      assert.equal(row.promptRuneLength, [...row.sourcePrompt].length);
      assert.equal(row.sourcePolicy.provisionalLabelsHidden, true);
      assert.equal(row.sourcePolicy.promptFamilyHidden, true);
      assert.equal(row.sourcePolicy.datasetSplitHidden, true);
      for (const key of forbiddenKeys) assert.equal(Object.hasOwn(row, key), false, `${row.sampleId}: leaked ${key}`);
      assert.equal(sampleIds.has(row.sampleId), false);
      sampleIds.add(row.sampleId);
    }
  }
  assert.equal(sampleIds.size, 5000);
  assert.deepEqual(
    [...sampleIds].sort(),
    built.records.map((record) => record.sampleId).sort(),
  );
});

test("keeps GPT evidence non-human and non-training-eligible", () => {
  assert.equal(built.manifest.reviewMode, "blind_independent_automated_annotation");
  assert.equal(built.manifest.provisionalLabelsIncluded, false);
  assert.equal(built.manifest.promptFamilyIncluded, false);
  assert.equal(built.manifest.datasetSplitIncluded, false);
  assert.equal(built.manifest.classifierOutputsIncluded, false);
  assert.equal(built.manifest.automatedReviewOnly, true);
  assert.equal(built.manifest.confersHumanReviewStatus, false);
  assert.equal(built.manifest.trainingEligible, false);
});

test("matches every checked-in generated packet", () => {
  for (const [relativePath, contents] of Object.entries(built.artifacts)) {
    assert.equal(readFileSync(path.join(root, relativePath), "utf8"), contents, relativePath);
  }
});

test("the packet generator is reproducible in check mode", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/dev/generate-v2.1-difficulty-independent-ood-5000-gpt-review-packets.mjs", "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified 50 blind ChatGPT packets with 5000 records/);
});
