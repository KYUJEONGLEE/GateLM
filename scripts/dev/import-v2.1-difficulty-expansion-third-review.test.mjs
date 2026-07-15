import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildThirdReviewArtifacts } from "./import-v2.1-difficulty-expansion-third-review.mjs";

function inputText() {
  const rows = [];
  for (let index = 1; index <= 5; index += 1) {
    const suffix = String(index).padStart(2, "0");
    rows.push(
      ...readFileSync(
        `docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/third-review-gpt/review-${suffix}.input.jsonl`,
        "utf8",
      )
        .split(/\r?\n/u)
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line)),
    );
  }
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

test("merges unanimous third-review confirmations and leaves no row-level review queue", () => {
  const result = buildThirdReviewArtifacts({
    rawText: readFileSync(
      "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/third-review-gpt/review-merged.raw.jsonl",
      "utf8",
    ),
    inputText: inputText(),
    secondCandidateText: readFileSync(
      "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.second-review-merged-candidate.jsonl",
      "utf8",
    ),
    sourceZipSha256: "05f049c6b2a3d6e6ed3b3442ca0a07222f759ffa54c67d5723463d06b37dc492",
  });

  assert.equal(result.report.integrity.records, 250);
  assert.equal(result.report.integrity.uniqueSampleIds, 250);
  assert.deepEqual(result.report.recommendations, { approve_second_candidate: 250 });
  assert.equal(result.report.confidence.minimum, 0.99);
  assert.equal(result.report.confidence.maximum, 0.99);
  assert.equal(result.report.checks.true, 1250);
  assert.equal(result.report.checks.falseOrMissing, 0);
  assert.equal(result.report.validation.canonicalRecordFailures, 0);
  assert.equal(result.report.validation.familyConflicts, 0);
  assert.equal(result.confirmations.length, 250);
  assert.equal(result.remainingQueue.length, 0);
  assert.equal(result.thirdCandidate.length, 2000);
});

