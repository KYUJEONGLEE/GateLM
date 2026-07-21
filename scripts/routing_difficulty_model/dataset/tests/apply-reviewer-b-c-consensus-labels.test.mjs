import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArtifacts,
  verifyArtifacts,
} from "../apply-reviewer-b-c-consensus-labels.mjs";

let cached;
const artifacts = () => (cached ??= buildArtifacts());

test("applies exactly the 3215 B/C same-family agreements that differ from the candidate", () => {
  const result = artifacts();
  assert.deepEqual(verifyArtifacts(result), []);
  assert.equal(result.overrides.length, 3215);
  assert.equal(result.overrides.filter((row) => row.prior_candidate_label === "complex" && row.revised_label === "simple").length, 2722);
  assert.equal(result.overrides.filter((row) => row.prior_candidate_label === "simple" && row.revised_label === "complex").length, 493);
});

test("keeps provenance and review restrictions", () => {
  const result = artifacts();
  assert.equal(result.bundleRevisedRecords.filter((row) => row.label_source === "llm_same_family_consensus_candidate").length, 3215);
  assert.equal(result.bundleRevisedRecords.filter((row) => row.review_status === "needs_adjudication").length, 2249);
  assert.equal(result.enterpriseRevisedRecords.filter((row) => row.review_status === "needs_adjudication").length, 19);
  assert.equal(result.bundleRevisedRecords.filter((row) => row.human_reviewed).length, 0);
  assert.equal(result.overrides.some((row) => Object.hasOwn(row, "prompt") || Object.hasOwn(row, "redacted_prompt")), false);
});

test("produces the expected revised class distribution", () => {
  const labels = resultCounts(artifacts().bundleRevisedRecords, "label");
  assert.deepEqual(labels, { complex: 5271, simple: 9729 });
});

function resultCounts(records, field) {
  return Object.fromEntries(Object.entries(records.reduce((counts, record) => {
    counts[record[field]] = (counts[record[field]] ?? 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right)));
}
