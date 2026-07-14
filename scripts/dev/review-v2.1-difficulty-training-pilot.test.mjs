import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildReviewArtifacts } from "./review-v2.1-difficulty-training-pilot.mjs";
import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

const sourceText = readFileSync(
  "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl",
  "utf8",
);

test("reviews every source record exactly once and keeps human approval pending", () => {
  const result = buildReviewArtifacts(sourceText);

  assert.equal(result.suggestions.length, 500);
  assert.equal(result.humanQueue.length, 120);
  assert.equal(result.manifest.counts.aiReviewCompleteRecords, 380);
  assert.equal(result.manifest.counts.finalHumanApprovalPendingRecords, 500);
  assert.equal(result.manifest.counts.humanReviewedRecords, 0);
  assert.equal(result.manifest.counts.approvedRecords, 0);
  assert.equal(result.manifest.trainingEligible, false);
  assert.equal(result.manifest.humanReviewClaimed, false);

  const sourceIds = new Set(
    sourceText
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line).sampleId),
  );
  assert.deepEqual(new Set(result.suggestions.map((item) => item.sourceSampleId)), sourceIds);
  for (const suggestion of result.suggestions) {
    assert.equal(suggestion.proposedRecord.reviewStatus, "pending");
    assert.equal(suggestion.proposedRecord.reviewerCount, 0);
    assert.equal(suggestion.proposedRecord.labelSource, "synthetic_fixture");
  }
});

test("isolates the intentionally ambiguous threshold and contrast profiles", () => {
  const result = buildReviewArtifacts(sourceText);

  assert.equal(result.manifest.byReasonCode.difficulty_threshold, 100);
  assert.equal(result.manifest.byReasonCode.single_added_constraint_boundary, 10);
  assert.equal(result.manifest.byReasonCode.single_added_task_boundary, 10);
  assert.equal(result.manifest.byReasonCode.prompt_template_artifact_corrected, 3);
  assert.ok(result.humanQueue.every((item) => item.disposition === "needs_human_judgment"));
  assert.ok(
    result.humanQueue.every((item) =>
      item.reasonCodes.some((reason) =>
        [
          "difficulty_threshold",
          "single_added_task_boundary",
          "single_added_constraint_boundary",
        ].includes(reason),
      ),
    ),
  );
});

test("keeps prompt families category and semantic-label homogeneous", () => {
  const result = buildReviewArtifacts(sourceText);
  const signatures = new Map();

  for (const suggestion of result.suggestions) {
    const record = suggestion.proposedRecord;
    const signature = `${record.expectedCategory}/${record.expectedSemanticLabel}`;
    const existing = signatures.get(record.promptFamily);
    if (existing) assert.equal(existing, signature, record.promptFamily);
    signatures.set(record.promptFamily, signature);
  }

  assert.equal(signatures.size, result.manifest.counts.proposedFamilies);
  assert.ok(signatures.size > 25, "legacy 25-family smoke grouping must not be reused");
});

test("records only explicit, bounded prompt template corrections", () => {
  const result = buildReviewArtifacts(sourceText);
  const rewrites = result.suggestions.filter((item) => item.changes.promptRewritten);

  assert.equal(rewrites.length, 4);
  assert.ok(
    rewrites.every((item) => item.reasonCodes.includes("prompt_template_artifact_corrected")),
  );
  assert.ok(
    rewrites.some(
      (item) =>
        item.sourceSampleId === "difficulty_general_complex_core_clear_f01_v10" &&
        item.proposedRecord.redactedPrompt.includes("절차를"),
    ),
  );
});

test("all 500 proposed records satisfy the canonical v2 label validator", () => {
  const result = buildReviewArtifacts(sourceText);
  const failures = verifyDifficultyLabelRecords(
    result.suggestions.map((item) => item.proposedRecord),
  );

  assert.deepEqual(failures, []);
});

test("reports source coverage gaps instead of inventing missing slice labels", () => {
  const result = buildReviewArtifacts(sourceText);

  assert.deepEqual(result.manifest.coverage.missingRequiredSlices, [
    "indirect_expression",
    "synonym",
    "payload_contamination",
    "ood_terminology",
  ]);
  assert.ok(result.manifest.datasetReadinessBlockers.includes("required_slice_coverage_missing"));
});

test("builds one self-contained GPT packet with all 120 adjudication items", () => {
  const result = buildReviewArtifacts(sourceText);
  const packetEntry = Object.entries(result.files).find(([filePath]) =>
    filePath.endsWith(".gpt-adjudication-packet.md"),
  );
  assert.ok(packetEntry, "GPT packet must be generated");
  const packet = packetEntry[1];
  const inputBlock = packet
    .split("<!-- BEGIN_REVIEW_ITEMS_JSONL -->\n", 2)[1]
    .split("\n<!-- END_REVIEW_ITEMS_JSONL -->", 1)[0];
  const items = inputBlock.split("\n").map((line) => JSON.parse(line));

  assert.equal(items.length, 120);
  assert.equal(new Set(items.map((item) => item.sampleId)).size, 120);
  assert.deepEqual(
    items.map((item) => item.sampleId),
    result.humanQueue.map((item) => item.sourceSampleId),
  );
  assert.match(packet, /JSONL 120줄만/);
  assert.doesNotMatch(packet, /- \[ \] 제안 수락/);
});
