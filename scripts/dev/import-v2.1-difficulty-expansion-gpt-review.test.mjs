import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildReviewArtifacts } from "./import-v2.1-difficulty-expansion-gpt-review.mjs";

const rawText = readFileSync(
  "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.gpt-adjudication.raw.jsonl",
  "utf8",
);
const sourceText = readFileSync(
  "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.fixture.jsonl",
  "utf8",
);
const sourceManifestText = readFileSync(
  "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.manifest.json",
  "utf8",
);

test("merges all GPT batches and extracts exactly the configured direct-review queue", () => {
  const result = buildReviewArtifacts({ rawText, sourceText, sourceManifestText });

  assert.equal(result.report.integrity.parsedRecords, 2000);
  assert.equal(result.report.integrity.uniqueSampleIds, 2000);
  assert.equal(result.report.integrity.missingSampleIds, 0);
  assert.equal(result.report.integrity.duplicateSampleIds, 0);
  assert.equal(result.report.integrity.unexpectedSampleIds, 0);
  assert.deepEqual(result.report.gpt.decisions, { accept: 1200, correct: 800 });
  assert.equal(result.report.normalization.applied, 0);
  assert.equal(result.report.changes.redactedPrompt, 800);
  assert.equal(result.report.changes.nonPromptLabelChanges, 0);
  assert.equal(result.report.validation.postRewriteLengthSliceMismatches, 0);
  assert.equal(result.report.validation.simpleComplexPairInversions, 0);
  assert.equal(result.report.family.families, 200);
  assert.equal(result.report.family.issues, 0);
  assert.equal(result.report.humanReviewQueue.records, 1067);
  assert.equal(result.report.humanReviewQueue.excludedRecords, 933);
  assert.equal(result.report.humanReviewQueue.withPromptChanges, 800);
  assert.equal(result.report.humanReviewQueue.withoutPromptChanges, 267);
  assert.equal(result.report.humanReviewQueue.families, 200);
  assert.equal(
    result.report.humanReviewQueue.batches.reduce((sum, batch) => sum + batch.records, 0),
    1067,
  );
  assert.ok(result.report.humanReviewQueue.batches.every((batch) => batch.records <= 80));
  assert.ok(result.report.humanReviewQueue.batches.every((batch) => !batch.category.includes("+")));
  const batchByFamily = new Map();
  result.queueBatches.forEach((batch, batchIndex) => {
    for (const row of batch) {
      const prior = batchByFamily.get(row.promptFamily);
      assert.ok(prior === undefined || prior === batchIndex);
      batchByFamily.set(row.promptFamily, batchIndex);
    }
  });
  assert.deepEqual(result.report.humanReviewQueue.byReason, {
    ambiguous_instruction_payload_boundary: 180,
    gpt_decision_correct: 800,
    payload_only_empty_instruction: 100,
    prompt_action_replace: 800,
  });
});
