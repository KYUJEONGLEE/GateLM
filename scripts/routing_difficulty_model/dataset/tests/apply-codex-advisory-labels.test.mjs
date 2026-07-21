import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArtifacts,
  codexAdvisoryDecision,
  verifyArtifacts,
} from "../apply-codex-advisory-labels.mjs";

let cached;
const artifacts = () => (cached ??= buildArtifacts());

test("applies all 2249 Codex advisory decisions", () => {
  const result = artifacts();
  assert.deepEqual(verifyArtifacts(result), []);
  assert.equal(result.decisions.length, 2249);
  assert.equal(result.decisions.filter((row) => row.label === "simple").length, 1727);
  assert.equal(result.decisions.filter((row) => row.label === "complex").length, 522);
});

test("keeps the advisory revision unreviewed and prompt-free", () => {
  const result = artifacts();
  assert.equal(result.records.filter((row) => row.label_source === "llm_codex_advisory_candidate").length, 2249);
  assert.equal(result.records.filter((row) => row.review_status === "needs_adjudication").length, 2249);
  assert.equal(result.records.filter((row) => row.human_reviewed).length, 0);
  assert.equal(result.decisions.some((row) => Object.hasOwn(row, "prompt") || Object.hasOwn(row, "redacted_prompt")), false);
});

test("uses strong and combined moderate seven-axis signals", () => {
  const base = {
    reasoning_level: "direct_or_mechanical",
    task_dependency: "single_or_independent",
    constraint_tradeoff: "none_or_mechanical",
    expert_judgment: "none_or_standard",
    context_integration: "single_or_local",
    tool_external_evidence: "none",
    verification: "none",
  };
  assert.equal(codexAdvisoryDecision(base).label, "simple");
  assert.equal(codexAdvisoryDecision({ ...base, verification: "iterative_or_falsification" }).label, "complex");
  assert.equal(codexAdvisoryDecision({
    ...base,
    reasoning_level: "limited_local",
    task_dependency: "dependent_two_step",
  }).label, "complex");
});
