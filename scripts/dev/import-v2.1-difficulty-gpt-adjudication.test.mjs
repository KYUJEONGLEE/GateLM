import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildAdjudicatedArtifacts } from "./import-v2.1-difficulty-gpt-adjudication.mjs";
import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

function buildFromCheckedArtifacts() {
  return buildAdjudicatedArtifacts({
    rawText: readFileSync(
      "docs/v2.1.0/reviews/difficulty-evaluation-training-pilot-500.gpt-adjudication.raw.jsonl",
      "utf8",
    ),
    proposedLabelsText: readFileSync(
      "docs/v2.1.0/reviews/difficulty-evaluation-training-pilot-500.ai-proposed-labels.jsonl",
      "utf8",
    ),
    humanQueueText: readFileSync(
      "docs/v2.1.0/reviews/difficulty-evaluation-training-pilot-500.human-judgment.jsonl",
      "utf8",
    ),
    sourcePilotText: readFileSync(
      "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl",
      "utf8",
    ),
  });
}

test("imports all 120 GPT decisions and merges exactly 500 records", () => {
  const result = buildFromCheckedArtifacts();
  assert.equal(result.rawRows.length, 120);
  assert.equal(new Set(result.rawRows.map((row) => row.sampleId)).size, 120);
  assert.equal(result.mergedRecords.length, 500);
  assert.equal(new Set(result.mergedRecords.map((row) => row.sampleId)).size, 500);
  assert.deepEqual(result.manifest.counts.decisions, { accept: 26, correct: 94 });
  assert.deepEqual(result.manifest.counts.promptActions, {
    accept_proposed_rewrite: 3,
    keep_source: 76,
    replace: 41,
  });
});

test("normalizes non-contract GPT boundary vocabulary without dropping provenance", () => {
  const result = buildFromCheckedArtifacts();
  assert.equal(result.manifest.counts.boundaryTypeNormalizations, 56);
  assert.equal(result.manifest.counts.boundaryConfidenceNormalizations, 7);
  assert.ok(
    result.normalizedRows.every((row) =>
      [
        "none",
        "code_fence",
        "role_tag",
        "role_heading",
        "begin_end",
        "blockquote",
        "inline_cue",
        "multiple",
        "unsupported",
      ].includes(row.expectedInstructionPayloadBoundary.boundaryType),
    ),
  );
  assert.ok(result.normalizedRows.some((row) => row.normalizations.length === 2));
});

test("the merged 500-record dataset passes the canonical v2 label validator", () => {
  const result = buildFromCheckedArtifacts();
  assert.deepEqual(verifyDifficultyLabelRecords(result.mergedRecords), []);
  assert.equal(result.manifest.trainingEligible, false);
  assert.equal(result.manifest.humanReviewClaimed, false);
  assert.equal(result.manifest.counts.humanReviewedRecords, 0);
  assert.equal(result.manifest.counts.approvedRecords, 0);
});

test("replaces 12 non-adjudicated variants with balanced coverage for all four missing slices", () => {
  const result = buildFromCheckedArtifacts();
  const slices = ["indirect_expression", "synonym", "payload_contamination", "ood_terminology"];
  const mergedIds = new Set(result.mergedRecords.map((record) => record.sampleId));
  assert.equal(result.manifest.counts.removedRedundantRecords, 12);
  assert.equal(result.manifest.counts.addedCoverageRecords, 12);
  assert.deepEqual(result.manifest.coverage.missingRequiredSlices, []);
  assert.equal(result.manifest.coverageReplacements.records.length, 12);

  for (const slice of slices) {
    const records = result.mergedRecords.filter((record) => record.evaluationSlices.includes(slice));
    assert.equal(records.length, 3, `${slice} should have three records`);
    assert.deepEqual(
      records.map((record) => record.language).sort(),
      ["en", "ko", "mixed"],
    );
    assert.equal(new Set(records.map((record) => record.promptFamily)).size, 1);
    assert.ok(records.every((record) => record.reviewStatus === "pending" && record.reviewerCount === 0));
  }

  for (const replacement of result.manifest.coverageReplacements.records) {
    assert.equal(mergedIds.has(replacement.removedSampleId), false);
    assert.equal(mergedIds.has(replacement.addedSampleId), true);
  }

  for (const category of ["general", "code", "translation", "summarization", "reasoning"]) {
    for (const difficulty of ["simple", "complex"]) {
      assert.equal(
        result.mergedRecords.filter(
          (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
        ).length,
        50,
      );
    }
  }
  assert.deepEqual(
    Object.fromEntries(
      ["ko", "en", "mixed"].map((language) => [
        language,
        result.mergedRecords.filter((record) => record.language === language).length,
      ]),
    ),
    { ko: 300, en: 150, mixed: 50 },
  );
});

test("applies each GPT prompt action exactly", () => {
  const result = buildFromCheckedArtifacts();
  const byId = new Map(result.mergedRecords.map((record) => [record.sampleId, record]));
  assert.equal(
    byId.get("difficulty_general_simple_boundary_threshold_f05_v01").redactedPrompt,
    "전문 용어가 포함되어 있어도 추가 분석은 하지 말고 서비스 점검 시간을 확인할 수 있는 위치만 알려줘.",
  );
  assert.equal(
    byId.get("difficulty_general_simple_boundary_threshold_f05_v08").redactedPrompt,
    "Even if the wording sounds technical, state where the billing history page is without further analysis.",
  );
});
