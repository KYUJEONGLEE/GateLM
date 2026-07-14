import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateSliceResults,
  assert42DArtifactContract,
  assertLabelRecordContract,
  currentContractContext,
  legacyFamilyId,
  parseJSONL,
  projectLabelRecords,
  selectSplitRecords,
  summarizeSemanticLabelEligibility,
  toolingSmokeEligibility,
} from "./v2.1-difficulty-42d-smoke-baseline.mjs";

test("baseline report scope follows the current semantic proposal without claiming semantic evaluation", () => {
  assert.deepEqual(currentContractContext(), {
    baselineFeatureContract: "difficulty-feature-vector.v1",
    baselineDimension: 42,
    semanticFeatureContractEvaluated: false,
    semanticProposalStatus: "proposed_not_active",
    semanticHeadCount: 4,
    semanticHeadProbabilityDimension: 12,
    semanticCandidateShapes: ["42", "42 + P", "54 + P"],
    emptySemanticInputPolicy: "fail_closed_until_versioned_representation_is_approved",
    currentSemanticLabelContract: "gatelm.difficulty-label-record.v2",
    semanticInputStatuses: ["eligible", "empty_instruction"],
    emptySemanticBucketTarget: "not_applicable",
  });
  assert.deepEqual(toolingSmokeEligibility(), {
    evidenceClass: "training_tooling_smoke",
    partitionSemantics: "tooling_smoke_only",
    modelQualityComparisonEligible: false,
    semanticCandidateComparisonEligible: false,
    promotionGateApplicable: false,
    productionEvidenceEligible: false,
  });
});

test("baseline artifact stays exact 42D v1 and rejects semantic shapes", () => {
  assert.doesNotThrow(() =>
    assert42DArtifactContract({ featureVersion: "difficulty-feature-vector.v1", weights: Array(42).fill(0) }),
  );
  assert.throws(
    () => assert42DArtifactContract({ featureVersion: "difficulty-feature-vector.v2", weights: Array(42).fill(0) }),
    /requires difficulty-feature-vector\.v1/u,
  );
  assert.throws(
    () => assert42DArtifactContract({ featureVersion: "difficulty-feature-vector.v1", weights: Array(54).fill(0) }),
    /exactly 42 model weights/u,
  );
});

test("slice fixture record contract must match its manifest", () => {
  assert.equal(
    assertLabelRecordContract(
      [{ schemaVersion: "gatelm.difficulty-label-record.v2" }],
      {
        schemaVersion: "gatelm.difficulty-label-dataset-manifest.v2",
        recordSchemaVersion: "gatelm.difficulty-label-record.v2",
      },
    ),
    "gatelm.difficulty-label-record.v2",
  );
  assert.throws(
    () =>
      assertLabelRecordContract(
        [{ schemaVersion: "gatelm.difficulty-label-record.v1" }],
        {
          schemaVersion: "gatelm.difficulty-label-dataset-manifest.v1",
          recordSchemaVersion: "gatelm.difficulty-label-record.v1",
        },
      ),
    /requires the current v2 label manifest/u,
  );
});

test("v2 semantic label targets reject legacy and invalid empty buckets", () => {
  const manifest = {
    counts: {
      semanticHeadEligibleRecords: 1,
      semanticHeadEligibleFamilies: 1,
      emptyInstructionRecords: 1,
      emptyInstructionFamilies: 1,
    },
  };
  const eligible = {
    promptFamily: "fixture.general.f01",
    semanticInputStatus: "eligible",
    taskBucket: "count_1",
    constraintBucket: "count_0_to_1",
    scopeBucket: "count_1",
    dependencyBucket: "depth_0_to_1",
    expectedInstructionPayloadBoundary: { kind: "instruction_only" },
  };
  const empty = {
    promptFamily: "fixture.payload.f01",
    semanticInputStatus: "empty_instruction",
    taskBucket: "not_applicable",
    constraintBucket: "not_applicable",
    scopeBucket: "not_applicable",
    dependencyBucket: "not_applicable",
    expectedInstructionPayloadBoundary: { kind: "payload_only" },
  };
  assert.deepEqual(summarizeSemanticLabelEligibility([eligible, empty], manifest), manifest.counts);
  assert.throws(
    () => summarizeSemanticLabelEligibility([{ ...eligible, taskBucket: "one" }, empty], manifest),
    /invalid taskBucket/u,
  );
  assert.throws(
    () => summarizeSemanticLabelEligibility([eligible, { ...empty, scopeBucket: "count_1" }], manifest),
    /must use not_applicable scopeBucket/u,
  );
  assert.throws(
    () =>
      summarizeSemanticLabelEligibility(
        [eligible, { ...empty, semanticInputStatus: "eligible" }],
        manifest,
      ),
    /payload-only v2 label record must use empty_instruction|invalid taskBucket/u,
  );
});

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
      schemaVersion: "gatelm.difficulty-label-record.v2",
      datasetVersion: "label-smoke-v1",
      sampleId: "sample_1",
      redactedPrompt: "safe synthetic prompt",
      semanticInputStatus: "eligible",
      taskBucket: "count_1",
      constraintBucket: "count_0_to_1",
      scopeBucket: "count_1",
      dependencyBucket: "depth_0_to_1",
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
  assert.equal("semanticInputStatus" in projection, false);
  assert.equal("taskBucket" in projection, false);
  assert.equal("constraintBucket" in projection, false);
  assert.equal("scopeBucket" in projection, false);
  assert.equal("dependencyBucket" in projection, false);
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
