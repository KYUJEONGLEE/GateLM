import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFrozenHoldout,
  deterministicFamilyRank,
  renderFrozenHoldout,
  selectionPolicyVersion,
} from "./freeze-v2.1-difficulty-promotion-holdout.mjs";

test("freezes a score-independent balanced 100-record promotion holdout", () => {
  const frozen = buildFrozenHoldout();

  assert.equal(frozen.status, "frozen_before_first_score_access");
  assert.equal(frozen.selection.policyVersion, selectionPolicyVersion);
  assert.equal(frozen.selection.scoreIndependent, true);
  assert.equal(frozen.selection.selectedFamilies, 10);
  assert.equal(frozen.samples.length, 100);
  assert.equal(frozen.source.overlapWithPreviouslyObservedDatasetFamilies, 0);
  assert.equal(frozen.gatesFrozenBeforeEvaluation.minimumAccuracy, 0.91);
  assert.equal(frozen.gatesFrozenBeforeEvaluation.maximumComplexToSimpleCount, 1);

  const byCategory = new Map();
  for (const sample of frozen.samples) {
    const values = byCategory.get(sample.expectedCategory) ?? [];
    values.push(sample);
    byCategory.set(sample.expectedCategory, values);
  }
  assert.deepEqual([...byCategory.keys()].sort(), [
    "code",
    "general",
    "reasoning",
    "summarization",
    "translation",
  ]);
  for (const samples of byCategory.values()) {
    assert.equal(samples.length, 20);
    assert.equal(samples.filter((sample) => sample.expectedDifficulty === "simple").length, 10);
    assert.equal(samples.filter((sample) => sample.expectedDifficulty === "complex").length, 10);
  }

  for (const family of frozen.selectedFamilies) {
    assert.equal(family.selectionRank, deterministicFamilyRank(family.promptFamily));
  }
});

test("rendering the freeze is byte deterministic", () => {
  assert.equal(renderFrozenHoldout(buildFrozenHoldout()), renderFrozenHoldout(buildFrozenHoldout()));
});
