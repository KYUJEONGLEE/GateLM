import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildReviewerAImportArtifacts } from "./import-v2.1-difficulty-independent-ood-5000-gpt-review.mjs";

const root = path.resolve(".");
const built = buildReviewerAImportArtifacts();

test("validates all 5,000 Reviewer A records against the blind packets", () => {
  assert.equal(built.reviews.length, 5000);
  assert.equal(new Set(built.reviews.map((row) => row.sampleId)).size, 5000);
  assert.equal(built.summary.records, 5000);
  assert.equal(built.summary.sourceValidationSummary.valid, true);
  assert.equal(built.summary.sourceValidationSummary.batchCount, 50);
  assert.equal(built.summary.sourceValidationSummary.allBatchesHave100Rows, true);
});

test("queues only disagreements, low confidence, non-complete decisions, or issue codes", () => {
  const allowedReasons = new Set([
    "provisional_label_mismatch",
    "low_confidence",
    "gpt_needs_human_adjudication",
    "gpt_reject_input",
    "gpt_issue_code",
  ]);
  assert.equal(built.queueRows.length, built.summary.adjudicationQueueRecords);
  assert.equal(built.familyQueueRows.length, built.summary.adjudicationQueueFamilies);
  for (const row of built.queueRows) {
    assert.ok(row.queueReasons.length > 0);
    assert.ok(row.queueReasons.every((reason) => allowedReasons.has(reason)));
    assert.equal(Object.hasOwn(row, "rationale"), false);
    assert.equal(Object.hasOwn(row, "split"), false);
    assert.equal(row.ownerDecision, "pending");
    assert.match(row.priority, /^priority_[0-4]_/u);
  }
  const prioritized = Object.values(built.priorityQueueRows).flat();
  assert.equal(prioritized.length, built.queueRows.length);
  assert.equal(new Set(prioritized.map((row) => row.sampleId)).size, built.queueRows.length);
  assert.equal(built.coreFamilyQueueRows.length, built.summary.coreConflictFamilies);
});

test("keeps GPT evidence non-human, pending, and training-ineligible", () => {
  assert.equal(built.summary.agreementIsAccuracy, false);
  assert.equal(built.summary.humanApprovalStatus, "pending");
  assert.equal(built.summary.trainingEligible, false);
  assert.equal(built.importManifest.automatedReviewOnly, true);
  assert.equal(built.importManifest.confersHumanReviewStatus, false);
  assert.equal(built.importManifest.trainingEligible, false);
});

test("matches every checked-in Reviewer A import artifact", () => {
  for (const [relativePath, contents] of Object.entries(built.artifacts)) {
    const actual = readFileSync(path.join(root, relativePath));
    const expected = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
    assert.equal(actual.equals(expected), true, relativePath);
  }
});

test("the Reviewer A importer is reproducible in check mode", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/dev/import-v2.1-difficulty-independent-ood-5000-gpt-review.mjs", "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified Reviewer A: 5000 records/);
});
