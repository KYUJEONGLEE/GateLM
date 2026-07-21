import assert from "node:assert/strict";
import { test } from "node:test";

import {
  rocAuc,
  validateReviewRow,
} from "../import-independent-review-results.mjs";

const validRow = {
  schema_version: "gatelm.routing-difficulty-independent-review-result.v1",
  reviewer_id: "B",
  batch_id: "B-0001",
  item_id: "ri_0123456789abcdef01234567",
  difficulty: "complex",
  confidence: "medium",
  reason_codes: ["dependent_multistep_workflow"],
  needs_human_adjudication: false,
};

test("validates one strict independent review result", () => {
  assert.deepEqual(
    validateReviewRow(validRow, {
      reviewerId: "B",
      batchId: "B-0001",
      expectedItemId: validRow.item_id,
    }),
    [],
  );
});

test("rejects extra prose fields and invalid reason codes", () => {
  const failures = validateReviewRow(
    {
      ...validRow,
      rationale: "copied prompt fragment",
      reason_codes: ["unsupported_reason"],
    },
    {
      reviewerId: "B",
      batchId: "B-0001",
      expectedItemId: validRow.item_id,
    },
  );
  assert.ok(failures.includes("fields do not match the result contract"));
  assert.ok(failures.includes("reason_codes"));
});

test("computes length-only ROC-AUC with tied ranks", () => {
  assert.equal(rocAuc([1, 2, 3, 4], [0, 0, 1, 1]), 1);
  assert.equal(rocAuc([1, 1, 1, 1], [0, 1, 0, 1]), 0.5);
});

