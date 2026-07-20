import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildOwnerPolicyResolutionArtifacts } from "./finalize-v2.1-difficulty-independent-ood-5000-core-policy-resolution.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = path.join(
  rootDir,
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/codex-adjudication",
);

function build() {
  return buildOwnerPolicyResolutionArtifacts(
    readFileSync(path.join(base, "difficulty-independent-ood-5000.codex-core-adjudication.jsonl"), "utf8"),
    readFileSync(path.join(base, "difficulty-independent-ood-5000.codex-residual-human-review-queue.jsonl"), "utf8"),
    readFileSync(path.join(rootDir, "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl"), "utf8"),
  );
}

test("resolves all 191 residual records through exactly four approved group policies", () => {
  const result = build();
  assert.equal(result.resolved191.length, 191);
  assert.equal(result.resolved1353.length, 1353);
  assert.equal(result.approval.policies.length, 4);
  assert.equal(result.manifest.counts.unresolvedCoreResidualRecords, 0);
  assert.deepEqual(result.manifest.counts.policyResolution, {
    structured_summary_multifacet_complex: 113,
    single_localization_or_style_constraint_simple: 42,
    single_scope_bounded_two_action_code_simple: 27,
    single_choice_without_multi_factor_evidence_simple: 9,
  });
});

test("does not claim row-level human review, human-approved labels, or training eligibility", () => {
  const result = build();
  assert.equal(result.approval.claims.recordLevelHumanReview, false);
  assert.equal(result.approval.claims.humanApprovedLabelClaimed, false);
  assert.equal(result.approval.claims.trainingEligibilityChanged, false);
  assert.ok(result.resolved191.every((row) => row.recordLevelHumanReview === false));
  assert.ok(result.resolved1353.every((row) => row.trainingEligibilityChanged === false));
});

test("preserves every Codex final core label while changing only residual resolution metadata", () => {
  const result = build();
  const sourceRows = readFileSync(
    path.join(base, "difficulty-independent-ood-5000.codex-core-adjudication.jsonl"),
    "utf8",
  )
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const sourceById = new Map(sourceRows.map((row) => [row.sampleId, row.codexLabels]));
  for (const row of result.resolved1353) {
    assert.deepEqual(row.finalCoreLabels, sourceById.get(row.sampleId));
  }
});

