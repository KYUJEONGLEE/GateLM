import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFrozenHoldoutV2,
  deterministicFamilyRankV2,
  renderFrozenHoldoutV2,
  selectionPolicyVersionV2,
} from "./freeze-v2.1-difficulty-promotion-holdout-v2.mjs";

test("freezes a second balanced holdout without any consumed v1 family", () => {
  const frozen = buildFrozenHoldoutV2();

  assert.equal(frozen.status, "frozen_before_first_score_access");
  assert.equal(frozen.selection.policyVersion, selectionPolicyVersionV2);
  assert.equal(frozen.selection.scoreIndependent, true);
  assert.equal(frozen.selection.selectedFamilies, 10);
  assert.equal(frozen.samples.length, 100);
  assert.equal(frozen.source.excludedConsumedFamilies, 10);
  assert.equal(frozen.source.overlapWithConsumedHoldoutFamilies, 0);
  assert.equal(frozen.artifact.thresholdPolicyVersion, "difficulty-threshold-v2");
  assert.equal(frozen.artifact.threshold, 0.06);

  const consumed = new Set(frozen.consumedHoldout.selectedFamilies);
  assert.equal(consumed.size, 10);
  for (const family of frozen.selectedFamilies) {
    assert.equal(consumed.has(family.promptFamily), false);
    assert.equal(family.selectionRank, deterministicFamilyRankV2(family.promptFamily));
  }

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
});

test("renders the second freeze byte deterministically", () => {
  assert.equal(
    renderFrozenHoldoutV2(buildFrozenHoldoutV2()),
    renderFrozenHoldoutV2(buildFrozenHoldoutV2()),
  );
});
