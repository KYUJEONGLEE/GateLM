import assert from "node:assert/strict";
import { test } from "node:test";

import { buildArtifacts } from "../generate-independent-review-packets.mjs";

function record({ sampleId, groupId, prompt, label }) {
  return {
    schema_version: "gatelm.routing-difficulty-dataset-record.v1",
    sample_id: sampleId,
    group_id: groupId,
    redacted_prompt: prompt,
    automatic_label: label,
    label,
  };
}

test("buildArtifacts rejects a partial dataset", () => {
  const source = `${JSON.stringify(
    record({
      sampleId: "syn_0001_simple_01",
      groupId: "group.simple",
      prompt: "Translate this sentence.",
      label: "simple",
    }),
  )}\n`;
  assert.throws(() => buildArtifacts(source), /expected 15000 dataset records/u);
});

