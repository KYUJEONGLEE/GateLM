import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateSliceResults,
  legacyFamilyId,
  parseJSONL,
  projectLabelRecords,
  selectSplitRecords,
} from "./v2.1-difficulty-42d-smoke-baseline.mjs";

test("family-disjoint split selection keeps contrast variants together", () => {
  const records = [
    { sampleId: "difficulty_general_simple_core_clear_f01_v01" },
    { sampleId: "difficulty_general_complex_core_clear_f01_v02" },
    { sampleId: "difficulty_code_simple_core_clear_f02_v01" },
  ];
  const manifest = {
    families: [
      { familyId: "general/f01", split: "holdout" },
      { familyId: "code/f02", split: "train" },
    ],
  };
  assert.equal(legacyFamilyId(records[0].sampleId), "general/f01");
  assert.deepEqual(selectSplitRecords(records, manifest, "holdout"), records.slice(0, 2));
});

test("split selection rejects a family without an assignment", () => {
  assert.throws(
    () =>
      selectSplitRecords(
        [{ sampleId: "difficulty_reasoning_simple_core_clear_f03_v01" }],
        { families: [{ familyId: "reasoning/f02", split: "holdout" }] },
        "holdout",
      ),
    /missing split assignment/u,
  );
});

test("label projection excludes annotation-only slice metadata", () => {
  const [projection] = projectLabelRecords([
    {
      datasetVersion: "label-smoke-v1",
      sampleId: "sample_1",
      redactedPrompt: "safe synthetic prompt",
      expectedCategory: "general",
      expectedDifficulty: "simple",
      labelSource: "synthetic_fixture",
      consentType: "synthetic",
      source: "synthetic_fixture",
      language: "en",
      redactionVersion: "rule_based_redaction_v1",
      createdAt: "2026-07-14T00:00:00Z",
      labelConfidence: 0.8,
      reviewerNote: "pending",
      evaluationSlices: ["negation"],
    },
  ]);
  assert.equal(projection.schemaVersion, "gatelm.difficulty-evaluation-record.v1");
  assert.equal("evaluationSlices" in projection, false);
});

test("slice aggregation uses explicit membership", () => {
  const labels = [
    { sampleId: "negation_simple", evaluationSlices: ["negation"] },
    { sampleId: "payload_simple", evaluationSlices: ["payload_contamination"] },
  ];
  const evaluation = {
    samples: [
      {
        sampleId: "negation_simple",
        expectedCategory: "reasoning",
        expectedDifficulty: "simple",
        actualDifficulty: "complex",
        shadowDifficulty: "simple",
      },
      {
        sampleId: "payload_simple",
        expectedCategory: "summarization",
        expectedDifficulty: "simple",
        actualDifficulty: "simple",
        shadowDifficulty: "complex",
      },
    ],
  };
  const result = aggregateSliceResults(evaluation, labels);
  assert.equal(result.negation.rule.accuracy, 0);
  assert.equal(result.negation.candidate42d.accuracy, 1);
  assert.equal(result.payload_contamination.rule.accuracy, 1);
  assert.equal(result.payload_contamination.candidate42d.accuracy, 0);
});

test("slice aggregation fails closed when an evaluation sample is missing", () => {
  assert.throws(
    () =>
      aggregateSliceResults(
        { samples: [{ sampleId: "payload_simple", expectedDifficulty: "simple" }] },
        [
          { sampleId: "missing_negation", evaluationSlices: ["negation"] },
          { sampleId: "payload_simple", evaluationSlices: ["payload_contamination"] },
        ],
      ),
    /missing slice sample missing_negation/u,
  );
});

test("JSONL parser accepts BOM and blank lines", () => {
  assert.deepEqual(parseJSONL('\uFEFF{"sampleId":"a"}\n\n{"sampleId":"b"}\n'), [
    { sampleId: "a" },
    { sampleId: "b" },
  ]);
});
