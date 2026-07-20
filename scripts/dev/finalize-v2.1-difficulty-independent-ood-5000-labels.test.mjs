import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPolicyFinalizationArtifacts } from "./finalize-v2.1-difficulty-independent-ood-5000-labels.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFileSync(path.join(rootDir, relativePath), "utf8");

function build() {
  return buildPolicyFinalizationArtifacts({
    candidateText: read("docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl"),
    reviewerText: read(
      "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/reviewer-a/difficulty-independent-ood-5000.gpt-review.reviewer-a.combined.validated.jsonl",
    ),
    queueText: read(
      "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/reviewer-a/difficulty-independent-ood-5000.gpt-review.reviewer-a.record-adjudication-queue.jsonl",
    ),
    coreQueueText: read(
      "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/reviewer-a/priority/02-core-label-conflicts.jsonl",
    ),
    resolvedCoreText: read(
      "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/codex-adjudication/owner-policy-resolution/difficulty-independent-ood-5000.resolved-core-decisions-1353.jsonl",
    ),
    splitManifestText: read("docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.splits.json"),
    diversityReportText: read("docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.diversity-report.json"),
  });
}

test("confirms 3,861 difficulty agreements and adjudicates all remaining difficulty conflicts", () => {
  const result = build();
  assert.equal(result.difficultyConsensus.length, 3861);
  assert.equal(result.summary.difficultyConflict, 1139);
  assert.equal(result.summary.fieldChanges.expectedDifficulty, 761);
  assert.equal(result.summary.fieldChanges.expectedCategory, 0);
  assert.equal(result.summary.fieldChanges.expectedSemanticLabel, 0);
  assert.equal(result.summary.fieldChanges.expectedInstructionPayloadBoundary, 0);
  assert.equal(result.finalRecords.length, 5000);
  assert.ok(result.finalRecords.every((record) => ["simple", "complex"].includes(record.expectedDifficulty)));
});

test("latest consensus rule supersedes the earlier 113 structured-summary complex decisions", () => {
  const result = build();
  const affected = result.finalRecords.filter(
    (record) =>
      record.expectedSemanticLabel === "summarization_structured" &&
      record.expectedDifficulty === "simple",
  );
  assert.equal(affected.length >= 113, true);
  assert.equal(result.auditManifest.supersedesForDifficultyAgreement.affectedRecords, 113);
});

test("resolves all 3,314 non-core queue records and audits all 367 exact agreements", () => {
  const result = build();
  assert.equal(result.nonCore.length, 3314);
  assert.equal(result.exactAudit.length, 367);
  assert.equal(
    result.exactAudit.filter((row) => ["confirmed", "corrected_after_third_pass"].includes(row.auditStatus)).length,
    367,
  );
});

test("preserves prompts and family assignments while recording owner approval", () => {
  const result = build();
  const source = read("docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const sourceById = new Map(source.map((record) => [record.sampleId, record]));
  for (const record of result.finalRecords) {
    const original = sourceById.get(record.sampleId);
    assert.equal(record.redactedPrompt, original.redactedPrompt);
    assert.equal(record.promptFamily, original.promptFamily);
    assert.equal(record.source, "synthetic_fixture");
    assert.equal(record.consentType, "synthetic");
    assert.equal(record.labelSource, "human_review");
    assert.equal(record.reviewStatus, "approved");
    assert.equal(record.reviewerCount, 1);
  }
  assert.equal(result.finalManifest.trainingEligible, true);
  assert.equal(result.finalManifest.recordLevelHumanReview, true);
  assert.equal(result.finalManifest.labelState, "owner_approved_training_candidate");
  assert.deepEqual(result.finalManifest.trainingUsePolicy.modelFit, ["train"]);
  assert.deepEqual(result.finalManifest.trainingUsePolicy.modelSelectionAndCalibration, ["validation"]);
  assert.deepEqual(result.finalManifest.trainingUsePolicy.evaluationOnly, ["test"]);
  assert.equal(result.finalManifest.trainingUsePolicy.testExcludedFromTraining, true);
  assert.equal(result.auditManifest.trainingEligible, true);
});

test("keeps train, validation, and test family-disjoint with exact 3,000/1,000/1,000 counts", () => {
  const result = build();
  assert.equal(result.finalManifest.splits.train.records, 3000);
  assert.equal(result.finalManifest.splits.validation.records, 1000);
  assert.equal(result.finalManifest.splits.test.records, 1000);
  assert.equal(result.finalManifest.integrity.crossSplitFamilyOverlap, 0);
  assert.equal(result.finalManifest.integrity.exactDuplicatePrompts, 0);
  assert.equal(result.finalManifest.integrity.normalizedDuplicatePrompts, 0);
});
