import assert from "node:assert/strict";
import test from "node:test";

import { buildArtifacts, verifyArtifacts } from "../apply-gpt-risk-sensitive-review-labels.mjs";

let cached;
const artifacts = () => (cached ??= buildArtifacts());

test("applies all 7974 Reviewer E risk-sensitive labels", () => {
  const result = artifacts();
  assert.deepEqual(verifyArtifacts(result), []);
  assert.equal(result.rows.filter((row) => row.label_source === "llm_gpt_risk_sensitive_candidate").length, 7974);
  assert.equal(result.rows.filter((row) => row.label === "simple").length, 6576);
  assert.equal(result.rows.filter((row) => row.label === "complex").length, 8424);
});

test("preserves prior and Reviewer E adjudication requirements", () => {
  const result = artifacts();
  assert.equal(result.rows.filter((row) => row.review_status === "needs_adjudication").length, 3565);
  assert.equal(result.rows.filter((row) => row.human_reviewed).length, 0);
});

test("preserves every Prompt while limiting group and split changes to the resolution", () => {
  const result = artifacts();
  const project = (rows) => rows.map((row) => [row.sample_id, row.redacted_prompt]);
  assert.deepEqual(project(result.rows), project(result.baseRows));
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.rows.reduce((counts, row) => {
      counts[row.split] = (counts[row.split] ?? 0) + 1;
      return counts;
    }, {})).sort()),
    { test: 2250, train: 10500, validation: 2250 },
  );
  assert.equal(new Set(result.rows.map((row) => row.group_id)).size, 8743);
});

test("keeps each resolved semantic cluster atomic and leaves no group split leaks", () => {
  const result = artifacts();
  const byId = new Map(result.rows.map((row) => [row.sample_id, row]));
  for (const cluster of result.resolution.clusters) {
    assert.equal(new Set(cluster.members.map((member) => byId.get(member.sample_id).group_id)).size, 1);
    assert.deepEqual(new Set(cluster.members.map((member) => byId.get(member.sample_id).split)), new Set([cluster.resolved_split]));
  }
  const splitsByGroup = new Map();
  for (const row of result.rows) {
    if (!splitsByGroup.has(row.group_id)) splitsByGroup.set(row.group_id, new Set());
    splitsByGroup.get(row.group_id).add(row.split);
  }
  assert.equal([...splitsByGroup.values()].filter((splits) => splits.size > 1).length, 0);
});
