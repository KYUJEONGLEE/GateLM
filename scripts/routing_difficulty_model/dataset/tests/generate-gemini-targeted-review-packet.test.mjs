import assert from "node:assert/strict";
import { test } from "node:test";

import { selectTargetRows } from "../generate-gemini-targeted-review-packet.mjs";

const dataset = new Map([
  ["s1", { sample_id: "s1", label: "simple" }],
  ["s2", { sample_id: "s2", label: "complex" }],
  ["s3", { sample_id: "s3", label: "simple" }],
  ["s4", { sample_id: "s4", label: "complex" }],
]);

test("selects the union without double-counting overlapping reasons", () => {
  const rows = [
    {
      item_id: "i1",
      sample_id: "s1",
      difficulty: "complex",
      confidence: "low",
      needs_human_adjudication: true,
    },
    {
      item_id: "i2",
      sample_id: "s2",
      difficulty: "complex",
      confidence: "low",
      needs_human_adjudication: true,
    },
    {
      item_id: "i3",
      sample_id: "s3",
      difficulty: "simple",
      confidence: "high",
      needs_human_adjudication: false,
    },
    {
      item_id: "i4",
      sample_id: "s4",
      difficulty: "complex",
      confidence: "medium",
      needs_human_adjudication: true,
    },
  ];
  assert.deepEqual(
    selectTargetRows(rows, dataset).map((row) => row.item_id),
    ["i1", "i2", "i4"],
  );
});

