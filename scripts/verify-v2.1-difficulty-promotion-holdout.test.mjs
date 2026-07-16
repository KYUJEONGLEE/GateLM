import assert from "node:assert/strict";
import test from "node:test";

import {
  evidencePaths,
  validateEvidence,
  verifyCanonicalEvidence,
} from "./verify-v2.1-difficulty-promotion-holdout.mjs";
import { readFileSync } from "node:fs";

function canonicalInputs() {
  return {
    datasetBytes: readFileSync(evidencePaths.dataset),
    manifestBytes: readFileSync(evidencePaths.manifest),
    freezeBytes: readFileSync(evidencePaths.freeze),
    artifactBytes: readFileSync(evidencePaths.artifact),
    report: JSON.parse(readFileSync(evidencePaths.report, "utf8")),
  };
}

test("accepts the immutable aggregate promotion result even when its gate honestly fails", () => {
  const report = verifyCanonicalEvidence();
  assert.equal(report.gate.passed, false);
  assert.equal(report.selectedCandidateClassification.accuracy, 0.7);
  assert.equal(report.selectedCandidateClassification.complexToSimpleCount, 0);
  assert.equal(report.gate.categoryNonRegressionVsRule.passed, true);
});

test("rejects a report whose observed outcome is rewritten", () => {
  const input = canonicalInputs();
  input.report.selectedCandidateClassification.accuracy = 0.91;
  assert.throws(() => validateEvidence(input), /accuracy is not derived/);
});

test("rejects per-sample or score material in the aggregate report", () => {
  const input = canonicalInputs();
  input.report.sampleId = "forbidden";
  assert.throws(() => validateEvidence(input), /forbidden key/);
});
