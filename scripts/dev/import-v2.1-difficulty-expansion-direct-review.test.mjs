import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildDirectReviewArtifacts } from "./import-v2.1-difficulty-expansion-direct-review.mjs";

function inputText() {
  const rows = [];
  for (let index = 1; index <= 16; index += 1) {
    const suffix = String(index).padStart(2, "0");
    rows.push(
      ...readFileSync(
        `docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/direct-review-gpt/review-${suffix}.input.jsonl`,
        "utf8",
      )
        .split(/\r?\n/u)
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line)),
    );
  }
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

test("merges all 16 direct-review outputs into a pending second-review candidate", () => {
  const result = buildDirectReviewArtifacts({
    rawText: readFileSync(
      "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/direct-review-gpt/review-merged.raw.jsonl",
      "utf8",
    ),
    inputText: inputText(),
    sourceText: readFileSync(
      "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.fixture.jsonl",
      "utf8",
    ),
    firstCandidateText: readFileSync(
      "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.gpt-merged-candidate.jsonl",
      "utf8",
    ),
  });

  assert.equal(result.report.integrity.records, 1067);
  assert.equal(result.report.integrity.uniqueSampleIds, 1067);
  assert.deepEqual(result.report.recommendations, {
    approve_candidate: 817,
    correct_candidate: 250,
  });
  assert.equal(result.report.confidence.below090, 0);
  assert.equal(result.report.corrections.records, 250);
  assert.equal(result.report.corrections.prompt, 250);
  assert.equal(result.report.corrections.labels, 0);
  assert.deepEqual(result.report.corrections.byVariant, { "07": 50, "08": 100, "10": 100 });
  assert.equal(result.report.corrections.finalPromptChangesFromOriginalSource, 800);
  assert.equal(result.report.validation.canonicalRecordFailures, 0);
  assert.equal(result.report.validation.familyConflicts, 0);
  assert.equal(result.report.validation.families, 200);
  assert.equal(result.secondCandidateRecords.length, 2000);
  assert.equal(result.ownerQueueRows.length, 250);
  assert.deepEqual(
    result.thirdReviewBatches.map((batch) => batch.length),
    [44, 49, 57, 50, 50],
  );
  assert.deepEqual(
    result.report.thirdReviewHandoff.batches.map((batch) => batch.category),
    ["general", "code", "translation", "summarization", "reasoning"],
  );
  assert.equal(
    new Set(result.thirdReviewBatches.flat().map((row) => row.sampleId)).size,
    250,
  );
});
