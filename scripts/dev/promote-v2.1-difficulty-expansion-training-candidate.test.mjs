import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildExpansionTrainingCandidateArtifacts,
  verifyExpansionTrainingCandidate,
} from "./promote-v2.1-difficulty-expansion-training-candidate.mjs";

const PATHS = {
  source:
    "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.third-review-confirmed-candidate.jsonl",
  sourceManifest: "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.manifest.json",
  report:
    "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.third-review-report.json",
  confirmations:
    "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.third-review-confirmations.jsonl",
  queue:
    "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt/difficulty-label-expansion-2000.remaining-review-queue.jsonl",
};

function buildCandidate() {
  return buildExpansionTrainingCandidateArtifacts({
    sourceText: readFileSync(PATHS.source, "utf8"),
    sourceManifestText: readFileSync(PATHS.sourceManifest, "utf8"),
    reportText: readFileSync(PATHS.report, "utf8"),
    confirmationsText: readFileSync(PATHS.confirmations, "utf8"),
    queueText: readFileSync(PATHS.queue, "utf8"),
  });
}

test("records explicit owner approval for all 2,000 records without changing provenance", () => {
  const result = buildCandidate();
  assert.equal(result.records.length, 2000);
  assert.equal(new Set(result.records.map((record) => record.sampleId)).size, 2000);
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
  assert.equal(result.evidence.reviewEvidence.gptReviewIsHumanApproval, false);
  assert.equal(result.evidence.reviewEvidence.datasetOwnerApprovalRecordedSeparately, true);
});

test("creates a training-eligible 200-family manifest with the approved minimum gate", () => {
  const result = buildCandidate();
  assert.equal(result.manifest.datasetPurpose, "training_candidate");
  assert.equal(result.manifest.trainingEligible, true);
  assert.equal(result.manifest.counts.families, 200);
  assert.equal(result.manifest.counts.humanReviewedFamilies, 200);
  assert.equal(result.manifest.counts.approvedHumanReviewedFamilies, 200);
  assert.deepEqual(result.manifest.trainingGate, {
    minimumFamilyPolicyStatus: "versioned",
    policyVersion: "difficulty-training-expansion-minimum-family-policy.2026-07-15.v1",
    minApprovedFamilies: 200,
    minFamiliesPerCategory: 40,
    minFamiliesPerCategoryDifficulty: 40,
    minFamiliesPerLanguage: 200,
    minFamiliesPerSlice: 200,
  });
});

test("preserves the family-disjoint 1,200/400/400 expansion partition", () => {
  const result = buildCandidate();
  assert.deepEqual(result.manifest.splitCounts, {
    train: { families: 120, records: 1200 },
    calibration: { families: 40, records: 400 },
    holdout: { families: 40, records: 400 },
  });
  assert.equal(new Set(result.manifest.families.map((row) => row.promptFamily)).size, 200);
  assert.ok(
    result.manifest.families.every(
      (row) => row.reviewStatus === "approved" && row.humanReviewed === true,
    ),
  );
});

test("passes canonical record, manifest, coverage, split, and approval gates", () => {
  const result = buildCandidate();
  const sourceManifest = JSON.parse(readFileSync(PATHS.sourceManifest, "utf8"));
  const datasetText =
    result.files[
      "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.jsonl"
    ];
  assert.deepEqual(
    verifyExpansionTrainingCandidate({
      records: result.records,
      datasetText,
      manifest: result.manifest,
      sourceManifest,
    }),
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

