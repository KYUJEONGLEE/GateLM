import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evidencePaths,
  validateThresholdV4Evidence,
  verifyCanonicalThresholdV4Evidence,
} from "./verify-v2.1-difficulty-threshold-v4.mjs";

function canonicalInputs() {
  return {
    sourceArtifactBytes: readFileSync(evidencePaths.sourceArtifact),
    feasibilityBytes: readFileSync(evidencePaths.feasibility),
    thresholdEvidenceBytes: readFileSync(evidencePaths.thresholdEvidence),
    candidateArtifactBytes: readFileSync(evidencePaths.candidateArtifact),
    freezeBytes: readFileSync(evidencePaths.freeze),
    result: JSON.parse(readFileSync(evidencePaths.result, "utf8")),
  };
}

test("accepts the immutable failed threshold-v4 holdout outcome", () => {
  const result = verifyCanonicalThresholdV4Evidence();
  assert.equal(result.gate.passed, false);
  assert.equal(result.selectedCandidateClassification.accuracy, 0.56);
  assert.equal(result.selectedCandidateClassification.simpleToComplexCount, 44);
  assert.equal(result.selectedCandidateClassification.complexToSimpleCount, 0);
});

test("rejects a rewritten holdout accuracy", () => {
  const input = canonicalInputs();
  input.result.selectedCandidateClassification.accuracy = 0.91;
  assert.throws(() => validateThresholdV4Evidence(input), /accuracy/);
});

test("rejects per-sample score material in the aggregate result", () => {
  const input = canonicalInputs();
  input.result.individualScore = 0.9;
  assert.throws(() => validateThresholdV4Evidence(input), /forbidden key/);
});
