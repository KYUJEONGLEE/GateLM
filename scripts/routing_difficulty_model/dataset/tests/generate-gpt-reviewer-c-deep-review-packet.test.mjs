import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOutputSchema } from "../generate-gpt-reviewer-c-deep-review-packet.mjs";

test("Reviewer C result schema requires all seven structured axes", () => {
  const schema = buildOutputSchema();
  const axes = schema.properties.axis_decisions;
  assert.equal(axes.required.length, 7);
  assert.deepEqual(new Set(axes.required), new Set(Object.keys(axes.properties)));
  assert.ok(schema.required.includes("difficulty"));
  assert.ok(schema.required.includes("confidence"));
  assert.ok(schema.required.includes("needs_human_adjudication"));
  assert.equal(schema.properties.reviewer_id.const, "C");
});

