import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  adjudicateRow,
  buildAdjudicationArtifacts,
} from "./adjudicate-v2.1-difficulty-independent-ood-5000-core-conflicts.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const queuePath = path.join(
  rootDir,
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/reviewer-a/priority/02-core-label-conflicts.jsonl",
);
const candidatePath = path.join(
  rootDir,
  "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl",
);
const parseJsonl = (text) => text.trim().split(/\r?\n/).map((line) => JSON.parse(line));

test("adjudicates all 1,353 core conflicts without changing approval state", () => {
  const result = buildAdjudicationArtifacts(
    readFileSync(queuePath, "utf8"),
    readFileSync(candidatePath, "utf8"),
  );
  assert.equal(result.rows.length, 1353);
  assert.equal(new Set(result.rows.map((row) => row.sampleId)).size, 1353);
  assert.equal(result.manifest.counts.humanApprovedRecords, 0);
  assert.equal(result.manifest.counts.trainingEligibleRecords, 0);
  assert.ok(result.residualRows.length > 0);
  assert.ok(result.residualRows.length < 250);
  assert.ok(result.rows.every((row) => row.approvalState === "codex_proposed_not_human_approved"));
});

test("keeps source-bound structured summaries in summarization", () => {
  const queue = parseJsonl(readFileSync(queuePath, "utf8"));
  const row = queue.find(
    (candidate) =>
      candidate.provisionalLabels.expectedSemanticLabel === "summarization_structured" &&
      candidate.reviewerALabels.expectedSemanticLabel === "reasoning_planning",
  );
  assert.ok(row);
  const result = adjudicateRow(row);
  assert.equal(result.codexLabels.expectedCategory, "summarization");
  assert.equal(result.codexLabels.expectedSemanticLabel, "summarization_structured");
  assert.equal(result.codexLabels.expectedDifficulty, "complex");
});

test("counts explicit result-consuming chains but not mere ordering language", () => {
  const queue = parseJsonl(readFileSync(queuePath, "utf8"));
  const twoTurn = queue.map(adjudicateRow).find((row) => row.surfaceFacts.rendererId === "two_turn");
  const boundedCondition = queue
    .map(adjudicateRow)
    .find(
      (row) => row.surfaceFacts.rendererId === "condition_first" && row.surfaceFacts.structuralMode === "bounded",
    );
  assert.ok(twoTurn);
  assert.ok(boundedCondition);
  assert.equal(twoTurn.codexLabels.dependencyBucket, "depth_2");
  assert.equal(boundedCondition.codexLabels.dependencyBucket, "depth_0_to_1");
});

test("treats long bounded prompts by surfaced structure, not length", () => {
  const queue = parseJsonl(readFileSync(queuePath, "utf8"));
  const longContext = queue.map(adjudicateRow).find((row) => row.surfaceFacts.rendererId === "long_context");
  assert.ok(longContext);
  assert.equal(longContext.surfaceFacts.constraintCount >= 2, true);
  assert.equal(longContext.codexLabels.expectedDifficulty, "complex");
  assert.doesNotMatch(longContext.rationale.join(" "), /length/i);
});

test("labels compact localization and style preservation by their explicit primary intent", () => {
  const queue = parseJsonl(readFileSync(queuePath, "utf8"));
  const localization = queue.find((row) => row.sampleId === "ood2_7faabd3356f42a3a3f");
  const style = queue.find((row) => row.sampleId === "ood2_98a06a68d77be8df14");
  assert.ok(localization);
  assert.ok(style);
  assert.equal(adjudicateRow(localization).codexLabels.expectedSemanticLabel, "translation_localization");
  assert.equal(adjudicateRow(style).codexLabels.expectedSemanticLabel, "translation_style_preserving");
});

test("distinguishes a short unsupported decision from a multi-factor decision", () => {
  const queue = parseJsonl(readFileSync(queuePath, "utf8"));
  const shortDecision = queue.find((row) => row.sampleId === "ood2_72db8a9512b7dd0bc2");
  const multiFactorDecision = queue.find((row) => row.sampleId === "ood2_c95fe796c950aceec7");
  assert.ok(shortDecision);
  assert.ok(multiFactorDecision);
  assert.equal(adjudicateRow(shortDecision).codexLabels.expectedDifficulty, "simple");
  assert.equal(adjudicateRow(multiFactorDecision).codexLabels.expectedDifficulty, "complex");
});
