import assert from "node:assert/strict";
import test from "node:test";

import { buildOutputSchema } from "../generate-gpt-risk-sensitive-slice-review-packet.mjs";
import { validateResultRow } from "../import-gpt-risk-sensitive-review-results.mjs";

function row(overrides = {}) {
  return {
    schema_version: "gatelm.routing-difficulty-risk-sensitive-review-result.v1",
    reviewer_id: "E",
    batch_id: "E-0001",
    item_id: "re_0123456789abcdef01234567",
    axis_decisions: {
      reasoning_level: "direct_or_mechanical",
      task_dependency: "single_or_independent",
      constraint_tradeoff: "none_or_mechanical",
      expert_judgment: "none_or_standard",
      context_integration: "single_or_local",
      tool_external_evidence: "none",
      verification: "none",
    },
    difficulty: "simple",
    confidence: "high",
    false_simple_risk: "low",
    decision_basis: "clearly_bounded_simple",
    reason_codes: ["clearly_bounded_direct_task"],
    needs_human_adjudication: false,
    ...overrides,
  };
}

test("accepts a schema-complete clearly bounded Simple result", () => {
  assert.deepEqual(validateResultRow(row(), { batchId: "E-0001", itemId: "re_0123456789abcdef01234567", schema: buildOutputSchema() }), []);
});

test("rejects uncertain Simple and human-request Simple results", () => {
  const medium = validateResultRow(row({ confidence: "medium" }), { batchId: "E-0001", itemId: "re_0123456789abcdef01234567" });
  assert.ok(medium.includes("simple_contract"));
  assert.ok(medium.includes("uncertain_defaults_complex"));
  const human = validateResultRow(row({ needs_human_adjudication: true }), { batchId: "E-0001", itemId: "re_0123456789abcdef01234567" });
  assert.ok(human.includes("simple_contract"));
  assert.ok(human.includes("human_request_defaults_complex"));
});

test("rejects prompt text or extra fields in result rows", () => {
  const failures = validateResultRow(row({ rationale: "extra prose" }), { batchId: "E-0001", itemId: "re_0123456789abcdef01234567" });
  assert.ok(failures.includes("fields"));
});
