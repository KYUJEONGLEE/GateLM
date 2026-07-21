import assert from "node:assert/strict";
import test from "node:test";

import { buildArtifacts, verifyArtifacts } from "../promote-owner-approved-dataset.mjs";

let cached;
const artifacts = () => (cached ??= buildArtifacts());

test("promotes all 15000 records to explicit human approval", () => {
  const result = artifacts();
  assert.deepEqual(verifyArtifacts(result), []);
  assert.equal(result.rows.length, 15000);
  assert.equal(result.rows.filter((row) => row.human_reviewed === true).length, 15000);
  assert.equal(result.rows.filter((row) => row.review_status === "approved").length, 15000);
});

test("preserves Prompt, label, group, split, and label provenance", () => {
  const result = artifacts();
  const project = (rows) => rows.map((row) => [row.sample_id, row.redacted_prompt, row.label, row.group_id, row.split, row.label_source]);
  assert.deepEqual(project(result.rows), project(result.baseRows));
});

test("uses the exact dataset owner attestation scope", () => {
  const result = artifacts();
  assert.equal(result.approval.reviewed_records, 15000);
  assert.equal(result.approval.decision.approve_all_current_labels, true);
  assert.equal(result.approval.decision.training_eligible, true);
  if (result.audit.verified) {
    assert.equal(result.bundleManifest.scope.training_eligible, true);
    assert.deepEqual(result.bundleManifest.scope.training_blockers, []);
    assert.equal(result.bundleManifest.review.production_gold, true);
    assert.equal(result.bundleManifest.review.runtime_promotion_authorized, false);
  }
});
