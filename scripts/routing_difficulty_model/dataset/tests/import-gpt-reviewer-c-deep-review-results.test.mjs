import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOutputSchema } from "../generate-gpt-reviewer-c-deep-review-packet.mjs";
import {
  classifyComparison,
  validateAxisReviewRow,
} from "../import-gpt-reviewer-c-deep-review-results.mjs";

const validRow = {
  schema_version: "gatelm.routing-difficulty-axis-review-result.v1",
  reviewer_id: "C",
  batch_id: "C-0001",
  item_id: "ri_0123456789abcdef01234567",
  axis_decisions: {
    reasoning_level: "multi_step_analysis",
    task_dependency: "dependent_multi_step",
    constraint_tradeoff: "moderate",
    expert_judgment: "specialized_judgment",
    context_integration: "single_or_local",
    tool_external_evidence: "single_simple_tool",
    verification: "iterative_or_falsification",
  },
  difficulty: "complex",
  confidence: "high",
  reason_codes: ["verification_or_falsification"],
  needs_human_adjudication: false,
};

test("validates a strict seven-axis Reviewer C row", () => {
  assert.deepEqual(
    validateAxisReviewRow(validRow, {
      batchId: "C-0001",
      itemId: validRow.item_id,
      schema: buildOutputSchema(),
    }),
    [],
  );
});

test("keeps every non-high or prior human request in the human queue", () => {
  const high = {
    difficulty: "complex",
    confidence: "high",
    needs_human_adjudication: false,
  };
  assert.equal(classifyComparison(high, high).llmConsensusCandidate, true);
  assert.equal(
    classifyComparison(
      { ...high, confidence: "medium" },
      high,
    ).humanAdjudicationRequired,
    true,
  );
  assert.equal(
    classifyComparison(
      { ...high, needs_human_adjudication: true },
      high,
    ).humanAdjudicationRequired,
    true,
  );
  assert.equal(
    classifyComparison(high, { ...high, difficulty: "simple" })
      .humanAdjudicationRequired,
    true,
  );
});

