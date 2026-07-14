import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildTrainingCandidateArtifacts,
  verifyTrainingCandidate,
} from "./promote-v2.1-difficulty-training-candidate.mjs";

const SOURCE_PATH =
  "docs/v2.1.0/reviews/difficulty-evaluation-training-pilot-500.gpt-adjudicated-labels.jsonl";

function buildCandidate() {
  return buildTrainingCandidateArtifacts(readFileSync(SOURCE_PATH, "utf8"));
}

test("promotes exactly 500 records with explicit human approval while preserving synthetic provenance", () => {
  const result = buildCandidate();
  assert.equal(result.records.length, 500);
  assert.equal(new Set(result.records.map((record) => record.sampleId)).size, 500);
  assert.ok(
    result.records.every(
      (record) =>
        record.labelSource === "human_review" &&
        record.reviewStatus === "approved" &&
        record.reviewerCount === 1 &&
        record.source === "synthetic_fixture" &&
        record.consentType === "synthetic",
    ),
  );
  assert.equal(result.evidence.approval.humanReviewerCount, 1);
  assert.equal(result.evidence.approval.reviewerIdentityStored, false);
  assert.equal(result.evidence.source.promptsRemainSynthetic, true);
});

test("builds a training-eligible canonical manifest with all 89 families approved", () => {
  const result = buildCandidate();
  assert.equal(result.manifest.schemaVersion, "gatelm.difficulty-label-dataset-manifest.v2");
  assert.equal(result.manifest.datasetPurpose, "training_candidate");
  assert.equal(result.manifest.trainingEligible, true);
  assert.equal(result.manifest.counts.families, 89);
  assert.equal(result.manifest.counts.humanReviewedFamilies, 89);
  assert.equal(result.manifest.counts.approvedHumanReviewedFamilies, 89);
  assert.equal(result.manifest.trainingGate.minimumFamilyPolicyStatus, "versioned");
  assert.equal(result.manifest.trainingGate.minApprovedFamilies, 89);
  assert.equal(result.manifest.trainingGate.minFamiliesPerCategory, 15);
  assert.equal(result.manifest.trainingGate.minFamiliesPerCategoryDifficulty, 9);
  assert.equal(result.manifest.trainingGate.minFamiliesPerLanguage, 50);
  assert.equal(result.manifest.trainingGate.minFamiliesPerSlice, 1);
  assert.equal(
    result.manifest.splitPolicyVersion,
    "difficulty-family-constrained-split.2026-07-15.v1",
  );
  assert.equal(result.manifest.splitSeed, 20260715);
});

test("uses family-disjoint train, calibration, and holdout partitions with every cell represented", () => {
  const result = buildCandidate();
  const rows = result.manifest.families;
  assert.equal(new Set(rows.map((row) => row.promptFamily)).size, 89);
  for (const partition of ["train", "calibration", "holdout"]) {
    assert.ok(rows.some((row) => row.partition === partition));
    assert.ok(result.evidence.partitions[partition].families > 0);
    assert.ok(result.evidence.partitions[partition].records > 0);
  }
  assert.equal(result.evidence.partitions.train.records, 300);
  assert.equal(result.evidence.partitions.calibration.records, 100);
  assert.equal(result.evidence.partitions.holdout.records, 100);
  assert.deepEqual(result.manifest.splitCounts, result.evidence.partitions);
  for (const slice of [
    "indirect_expression",
    "synonym",
    "payload_contamination",
    "ood_terminology",
  ]) {
    const families = new Set(
      result.records
        .filter((record) => record.evaluationSlices.includes(slice))
        .map((record) => record.promptFamily),
    );
    assert.ok(
      rows.filter((row) => families.has(row.promptFamily)).every((row) => row.partition === "holdout"),
    );
  }
});

test("passes the record, manifest, coverage, approval, and minimum-family gates", () => {
  const result = buildCandidate();
  const datasetText = result.files[
    "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl"
  ];
  assert.deepEqual(
    verifyTrainingCandidate({ records: result.records, datasetText, manifest: result.manifest }),
    [],
  );
  assert.deepEqual(result.evidence.gates, {
    allRecordsHumanApproved: true,
    sourceProvenancePreserved: true,
    requiredSliceCoverageComplete: true,
    familyDisjointPartitions: true,
    minimumFamilyPolicySatisfied: true,
    trainingEligible: true,
  });
});
