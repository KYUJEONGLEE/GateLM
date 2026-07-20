import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { adjudicateRow } from "./adjudicate-v2.1-difficulty-independent-ood-5000-core-conflicts.mjs";
import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDatasetVersion = "difficulty_independent_ood_5000_2026_07_18_candidate_v1";
const finalDatasetVersion = "difficulty_independent_ood_5000_2026_07_20_owner_approved_v1";
const policyVersion = "difficulty-independent-ood-owner-approval.2026-07-20.v1";

const candidatePath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl";
const splitManifestPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.splits.json";
const diversityReportPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.diversity-report.json";
const reviewerDir =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/reviewer-a";
const reviewerPath = `${reviewerDir}/difficulty-independent-ood-5000.gpt-review.reviewer-a.combined.validated.jsonl`;
const queuePath = `${reviewerDir}/difficulty-independent-ood-5000.gpt-review.reviewer-a.record-adjudication-queue.jsonl`;
const coreQueuePath = `${reviewerDir}/priority/02-core-label-conflicts.jsonl`;
const resolvedCorePath =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/codex-adjudication/owner-policy-resolution/difficulty-independent-ood-5000.resolved-core-decisions-1353.jsonl";

const finalPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.policy-finalized.jsonl";
const finalSplitPaths = {
  train: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.policy-finalized.train.jsonl",
  validation: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.policy-finalized.validation.jsonl",
  test: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.policy-finalized.test.jsonl",
};
const finalManifestPath =
  "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.policy-finalized.manifest.json";
const auditDir =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/policy-finalization";
const difficultyConsensusPath = `${auditDir}/difficulty-independent-ood-5000.difficulty-consensus-confirmed-3861.jsonl`;
const nonCorePath = `${auditDir}/difficulty-independent-ood-5000.non-core-adjudication-3314.jsonl`;
const exactAuditPath = `${auditDir}/difficulty-independent-ood-5000.exact-agreement-audit-367.jsonl`;
const reportPath = `${auditDir}/FINALIZATION-REPORT.md`;
const auditManifestPath = `${auditDir}/MANIFEST.json`;

const labelFields = [
  "expectedCategory",
  "expectedDifficulty",
  "semanticInputStatus",
  "taskBucket",
  "constraintBucket",
  "scopeBucket",
  "dependencyBucket",
  "expectedSemanticLabel",
  "expectedInstructionPayloadBoundary",
  "evaluationSlices",
];
const sliceOrder = [
  "negation",
  "indirect_expression",
  "synonym",
  "short_complex",
  "long_simple",
  "payload_contamination",
  "korean",
  "english",
  "mixed_language",
  "category_confusion",
  "ood_terminology",
];

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const parseJsonl = (text) => text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const jsonl = (rows) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
const normalizePrompt = (value) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function labelsFrom(record) {
  return Object.fromEntries(labelFields.map((field) => [field, record[field]]));
}

function countBy(values, selector) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const key = selector(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function compareFields(finalLabels, otherLabels) {
  return labelFields.filter((field) => !same(finalLabels[field], otherLabels[field]));
}

function explicitBoundary(boundaryType, payloadBlockCount = "one") {
  return {
    kind: "explicit_separation",
    boundaryType,
    confidence: "high",
    payloadBlockCount,
  };
}

function inferBoundary(prompt, rendererId) {
  if (/(?:^|\n)(?:자료|Source) A:\s*[\s\S]+(?:^|\n)(?:자료|Source) B:/m.test(prompt)) {
    return explicitBoundary("multiple", "multiple");
  }
  if (/<source>[\s\S]*<\/source>/.test(prompt)) return explicitBoundary("role_tag");
  if (/```(?:text)?\s*[\s\S]*```/.test(prompt)) return explicitBoundary("code_fence");
  if (/--- BEGIN (?:SOURCE|MATERIAL) ---[\s\S]*--- END (?:SOURCE|MATERIAL) ---/.test(prompt)) {
    return explicitBoundary("begin_end");
  }
  if (/## (?:합성 자료|Synthetic material|Synthetic 자료)/.test(prompt)) return explicitBoundary("role_heading");
  if (/(?:^|\n)>\s/.test(prompt)) return explicitBoundary("blockquote");
  if (
    rendererId === "ultra_compact" ||
    /(?:^|\n)(?:자료|Source):\s/.test(prompt) ||
    /(?:^|[;\s])src=/.test(prompt)
  ) {
    return explicitBoundary("inline_cue");
  }
  return {
    kind: "instruction_only",
    boundaryType: "none",
    confidence: "none",
    payloadBlockCount: "zero",
  };
}

function instructionText(prompt, boundary, rendererId) {
  if (boundary.kind === "instruction_only") return prompt;
  if (boundary.boundaryType === "multiple") {
    const match = prompt.match(/(?:두 자료로|Using both,|둘 다 보고)([\s\S]*)$/);
    return match?.[0] ?? prompt;
  }
  if (boundary.boundaryType === "role_tag") {
    const match = prompt.match(/<instruction>([\s\S]*?)<\/instruction>/);
    if (match) return match[1];
    return prompt.replace(/<source>[\s\S]*?<\/source>/g, " ");
  }
  if (boundary.boundaryType === "code_fence") return prompt.replace(/```(?:text)?\s*[\s\S]*?```/g, " ");
  if (boundary.boundaryType === "begin_end") {
    return prompt.replace(/--- BEGIN (?:SOURCE|MATERIAL) ---[\s\S]*?--- END (?:SOURCE|MATERIAL) ---/g, " ");
  }
  if (boundary.boundaryType === "role_heading") {
    return prompt.replace(/\n\n## (?:합성 자료|Synthetic material|Synthetic 자료)[\s\S]*$/g, " ");
  }
  if (boundary.boundaryType === "blockquote") {
    return prompt
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith(">"))
      .join("\n");
  }
  if (boundary.boundaryType === "inline_cue") {
    if (rendererId === "inline_cue") {
      const request = prompt.match(/(?:요청|Request):([\s\S]*)$/);
      return request?.[1] ?? prompt;
    }
    if (rendererId === "ultra_compact") return prompt;
    return prompt.replace(/\n\n(?:자료|Source):[\s\S]*$/g, " ");
  }
  return prompt;
}

function inferSlices(record, finalDifficulty, rendererId, boundary) {
  const slices = new Set();
  const instruction = instructionText(record.redactedPrompt, boundary, rendererId);
  if (["indirect_need", "synonym", "rhetorical", "polite_indirect"].includes(rendererId)) {
    slices.add("indirect_expression");
  }
  if (rendererId === "synonym") slices.add("synonym");
  if (
    [
      "code_fence_payload",
      "blockquote_payload",
      "begin_end_payload",
      "role_tags",
      "inline_cue",
      "multiple_sources",
    ].includes(rendererId)
  ) {
    slices.add("payload_contamination");
  }
  if (["negated_distractor", "category_noise", "rhetorical", "term_and_noise"].includes(rendererId)) {
    slices.add("category_confusion");
  }
  if (["ood_term", "term_and_noise"].includes(rendererId)) slices.add("ood_terminology");
  if (
    ["negated_distractor", "category_noise", "rhetorical"].includes(rendererId) ||
    /(하지\s*(?:마|말|않)|않기|금지|추측[^.!?\n]*(?:없이|하지)|단정하지|채우지|아니야|아님|\bdo not\b|\bdon't\b|\bnot asking\b|\bavoid\b|\bwithout assumptions\b|\bno-guess\b)/iu.test(
      instruction,
    )
  ) {
    slices.add("negation");
  }
  if (finalDifficulty === "complex" && [...record.redactedPrompt].length <= 120) slices.add("short_complex");
  if (finalDifficulty === "simple" && [...record.redactedPrompt].length > 120) slices.add("long_simple");
  slices.add(record.language === "ko" ? "korean" : record.language === "en" ? "english" : "mixed_language");
  return sliceOrder.filter((slice) => slices.has(slice));
}

function makeComparisonRow(candidate, reviewer) {
  return {
    datasetVersion: candidate.datasetVersion,
    sampleId: candidate.sampleId,
    promptFamily: candidate.promptFamily,
    language: candidate.language,
    redactedPrompt: candidate.redactedPrompt,
    provisionalLabels: labelsFrom(candidate),
    reviewerALabels: labelsFrom(reviewer),
    reviewerA: {
      decision: reviewer.decision,
      confidence: reviewer.confidence,
      issueCodes: reviewer.issueCodes,
    },
  };
}

function buildFinalLabels(candidate, reviewer, resolvedCoreById) {
  const comparisonRow = makeComparisonRow(candidate, reviewer);
  const codex = adjudicateRow(comparisonRow);
  const difficultyAgreement = candidate.expectedDifficulty === reviewer.expectedDifficulty;
  let expectedDifficulty;
  let difficultyResolution;
  if (difficultyAgreement) {
    expectedDifficulty = candidate.expectedDifficulty;
    difficultyResolution = "owner_confirmed_provisional_reviewer_a_agreement";
  } else {
    const resolvedCore = resolvedCoreById.get(candidate.sampleId);
    if (!resolvedCore) throw new Error(`difficulty conflict lacks resolved core decision: ${candidate.sampleId}`);
    expectedDifficulty = resolvedCore.finalCoreLabels.expectedDifficulty;
    difficultyResolution = "codex_core_adjudication";
  }
  const boundary = inferBoundary(candidate.redactedPrompt, codex.surfaceFacts.rendererId);
  const finalLabels = {
    expectedCategory: codex.codexLabels.expectedCategory,
    expectedDifficulty,
    semanticInputStatus: codex.codexLabels.semanticInputStatus,
    taskBucket: codex.codexLabels.taskBucket,
    constraintBucket: codex.codexLabels.constraintBucket,
    scopeBucket: codex.codexLabels.scopeBucket,
    dependencyBucket: codex.codexLabels.dependencyBucket,
    expectedSemanticLabel: codex.codexLabels.expectedSemanticLabel,
    expectedInstructionPayloadBoundary: boundary,
    evaluationSlices: inferSlices(candidate, expectedDifficulty, codex.surfaceFacts.rendererId, boundary),
  };
  return { finalLabels, codex, difficultyAgreement, difficultyResolution };
}

function assertSplitAndDuplicateIntegrity(finalRecords, splitManifest, diversityReport) {
  const failures = [];
  const assignment = new Map(splitManifest.assignments.map((row) => [row.promptFamily, row.split]));
  const splitRows = { train: [], validation: [], test: [] };
  for (const record of finalRecords) {
    const split = assignment.get(record.promptFamily);
    if (!split) failures.push(`missing split assignment for ${record.promptFamily}`);
    else splitRows[split].push(record);
  }
  for (const [split, expected] of [["train", 3000], ["validation", 1000], ["test", 1000]]) {
    if (splitRows[split].length !== expected) failures.push(`${split} expected ${expected}, found ${splitRows[split].length}`);
  }
  const familySets = Object.fromEntries(
    Object.entries(splitRows).map(([split, rows]) => [split, new Set(rows.map((row) => row.promptFamily))]),
  );
  for (const [left, right] of [["train", "validation"], ["train", "test"], ["validation", "test"]]) {
    const overlap = [...familySets[left]].filter((family) => familySets[right].has(family));
    if (overlap.length > 0) failures.push(`${left}/${right} family overlap: ${overlap.length}`);
  }
  const prompts = finalRecords.map((record) => record.redactedPrompt);
  if (new Set(prompts).size !== prompts.length) failures.push("exact duplicate prompts found");
  const normalized = prompts.map(normalizePrompt);
  if (new Set(normalized).size !== normalized.length) failures.push("normalized duplicate prompts found");
  if (diversityReport.dataset1Comparison.exactPromptOverlap !== 0) failures.push("Dataset 1 exact overlap is nonzero");
  if (diversityReport.dataset1Comparison.normalizedPromptOverlap !== 0) {
    failures.push("Dataset 1 normalized overlap is nonzero");
  }
  if (diversityReport.dataset1Comparison.promptFamilyOverlap !== 0) failures.push("Dataset 1 family overlap is nonzero");
  if (diversityReport.dataset1Comparison.wordFourGramAudit.maximum >= 0.8) {
    failures.push("Dataset 1 four-gram overlap gate failed");
  }
  if (diversityReport.withinDatasetOverlap.crossFamilyWordFourGramAudit.maximum >= 0.8) {
    failures.push("cross-family four-gram overlap gate failed");
  }
  return { failures, splitRows, familySets };
}

function buildReport(summary) {
  return `# Dataset 2 Policy Finalization Report

최신 owner 규칙은 provisional과 Reviewer A의 difficulty가 같으면 해당 difficulty를 field-level로 확정한다. 이 규칙은 이전 structured-summary 113건의 \`complex\` group-policy 결정을 supersede하며 두 입력의 일치값인 \`simple\`로 되돌린다.

## Coverage

- 전체 record: 5,000
- Difficulty consensus confirmation: ${summary.difficultyAgreement}
- Difficulty conflict adjudication: ${summary.difficultyConflict}
- Non-core queue adjudication: ${summary.nonCore}
- 11-field exact-agreement full audit: ${summary.exactAgreement}
- Reviewer A unnatural-language flags retained as labelable OOD surface: ${summary.awkwardButLabelable}
- Rejected records: 0

## Exact-agreement audit

- 그대로 확인: ${summary.exactAuditConfirmed}
- 제3 pass에서 non-difficulty field 수정: ${summary.exactAuditCorrected}

## Final label changes against the original candidate

- 변경된 record: ${summary.changedRecords}
- 변경된 field 수: ${summary.changedFields}
- Difficulty 변경: ${summary.fieldChanges.expectedDifficulty ?? 0}
- Task/constraint/scope/dependency 변경: ${
    (summary.fieldChanges.taskBucket ?? 0) +
    (summary.fieldChanges.constraintBucket ?? 0) +
    (summary.fieldChanges.scopeBucket ?? 0) +
    (summary.fieldChanges.dependencyBucket ?? 0)
  }
- Boundary 변경: ${summary.fieldChanges.expectedInstructionPayloadBoundary ?? 0}
- Evaluation slice 변경: ${summary.fieldChanges.evaluationSlices ?? 0}
- 최종 difficulty: simple ${summary.simple}, complex ${summary.complex}

## Integrity

- Families: 1,000; family당 5 records
- Split: train 3,000 / validation 1,000 / test 1,000
- Cross-split family overlap: 0
- Exact duplicate prompt: 0
- Normalized duplicate prompt: 0
- Dataset 1 exact/normalized/family overlap: 0
- Existing four-gram near-duplicate gates: pass
- Schema/category-semantic/boundary/slice consistency: pass
- Original candidate prompt content changed: no
- Original candidate file changed: no

## Status

별도 policy-finalized artifact에 최종 label을 반영했고, 2026-07-20 dataset owner의 명시적 전체 승인에 따라 모든 record를 \`human_review + approved + reviewerCount=1\`로 승격했다. \`trainingEligible=true\`는 training input eligibility만 승인한다. Train 3,000건만 model fit에 사용하고, validation 1,000건은 model selection/calibration, test 1,000건은 evaluation 전용으로 유지한다.
`;
}

export function buildPolicyFinalizationArtifacts(inputs) {
  const candidates = parseJsonl(inputs.candidateText);
  const reviewers = parseJsonl(inputs.reviewerText);
  const queued = parseJsonl(inputs.queueText);
  const coreQueued = parseJsonl(inputs.coreQueueText);
  const resolvedCore = parseJsonl(inputs.resolvedCoreText);
  const splitManifest = JSON.parse(inputs.splitManifestText);
  const diversityReport = JSON.parse(inputs.diversityReportText);
  if (candidates.length !== 5000 || reviewers.length !== 5000) throw new Error("expected 5,000 candidate and reviewer records");
  if (queued.length !== 4667) throw new Error(`expected 4,667 queued records, found ${queued.length}`);
  if (coreQueued.length !== 1353) throw new Error(`expected 1,353 core queued records, found ${coreQueued.length}`);
  if (resolvedCore.length !== 1353) throw new Error(`expected 1,353 resolved core records, found ${resolvedCore.length}`);

  const reviewerById = new Map(reviewers.map((row) => [row.sampleId, row]));
  const resolvedCoreById = new Map(resolvedCore.map((row) => [row.sampleId, row]));
  const coreIds = new Set(coreQueued.map((row) => row.sampleId));
  const nonCoreIds = new Set(queued.filter((row) => !coreIds.has(row.sampleId)).map((row) => row.sampleId));
  if (nonCoreIds.size !== 3314) throw new Error(`expected 3,314 non-core queue records, found ${nonCoreIds.size}`);

  const finalization = candidates.map((candidate) => {
    const reviewer = reviewerById.get(candidate.sampleId);
    if (!reviewer) throw new Error(`missing Reviewer A row: ${candidate.sampleId}`);
    const result = buildFinalLabels(candidate, reviewer, resolvedCoreById);
    return { candidate, reviewer, ...result };
  });
  const difficultyAgreementRows = finalization.filter((row) => row.difficultyAgreement);
  if (difficultyAgreementRows.length !== 3861) {
    throw new Error(`expected 3,861 difficulty agreements, found ${difficultyAgreementRows.length}`);
  }
  const exactAgreementRows = finalization.filter((row) =>
    labelFields.every((field) => same(row.candidate[field], row.reviewer[field])),
  );
  if (exactAgreementRows.length !== 367) throw new Error(`expected 367 exact agreements, found ${exactAgreementRows.length}`);

  const finalRecords = finalization.map(({ candidate, finalLabels }) => ({
    ...candidate,
    datasetVersion: finalDatasetVersion,
    ...finalLabels,
    labelSource: "human_review",
    reviewStatus: "approved",
    reviewerCount: 1,
    reviewerNote:
      "Dataset-owner approval recorded after Reviewer A comparison and policy adjudication; source remains synthetic.",
  }));
  const schemaFailures = verifyDifficultyLabelRecords(finalRecords, { rootDir });
  if (schemaFailures.length > 0) throw new Error(`final record verification failed:\n${schemaFailures.join("\n")}`);
  const integrity = assertSplitAndDuplicateIntegrity(finalRecords, splitManifest, diversityReport);
  if (integrity.failures.length > 0) throw new Error(`integrity verification failed:\n${integrity.failures.join("\n")}`);

  const difficultyConsensus = difficultyAgreementRows.map(({ candidate, reviewer }) => ({
    schemaVersion: "gatelm.difficulty-independent-ood-field-confirmation.v1",
    sourceDatasetVersion,
    finalDatasetVersion,
    policyVersion,
    sampleId: candidate.sampleId,
    confirmedField: "expectedDifficulty",
    confirmedValue: candidate.expectedDifficulty,
    provisionalValue: candidate.expectedDifficulty,
    reviewerAValue: reviewer.expectedDifficulty,
    resolution: "owner_confirmed_provisional_reviewer_a_agreement",
    recordLevelHumanReview: false,
  }));

  const nonCore = finalization
    .filter(({ candidate }) => nonCoreIds.has(candidate.sampleId))
    .map(({ candidate, reviewer, finalLabels, codex }) => ({
      schemaVersion: "gatelm.difficulty-independent-ood-non-core-adjudication.v1",
      sourceDatasetVersion,
      finalDatasetVersion,
      policyVersion,
      sampleId: candidate.sampleId,
      promptFamily: candidate.promptFamily,
      redactedPrompt: candidate.redactedPrompt,
      finalLabels,
      changedFromProvisional: compareFields(finalLabels, labelsFrom(candidate)),
      changedFromReviewerA: compareFields(finalLabels, labelsFrom(reviewer)),
      surfaceFacts: codex.surfaceFacts,
      qualityStatus: reviewer.issueCodes.includes("unnatural_language") ? "awkward_but_labelable" : "clear",
      reviewerAIssueCodes: reviewer.issueCodes,
      recordLevelHumanReview: false,
    }));
  if (nonCore.length !== 3314) throw new Error(`expected 3,314 non-core results, found ${nonCore.length}`);

  const exactAudit = exactAgreementRows.map(({ candidate, reviewer, finalLabels, codex }) => {
    const correctedFields = compareFields(finalLabels, labelsFrom(candidate));
    return {
      schemaVersion: "gatelm.difficulty-independent-ood-exact-agreement-audit.v1",
      sourceDatasetVersion,
      finalDatasetVersion,
      policyVersion,
      sampleId: candidate.sampleId,
      promptFamily: candidate.promptFamily,
      redactedPrompt: candidate.redactedPrompt,
      auditStatus: correctedFields.length === 0 ? "confirmed" : "corrected_after_third_pass",
      correctedFields,
      finalLabels,
      surfaceFacts: codex.surfaceFacts,
      qualityStatus: reviewer.issueCodes.includes("unnatural_language") ? "awkward_but_labelable" : "clear",
      reviewerAIssueCodes: reviewer.issueCodes,
      recordLevelHumanReview: false,
    };
  });

  const finalText = jsonl(finalRecords);
  const finalSplitTexts = Object.fromEntries(
    Object.entries(integrity.splitRows).map(([split, rows]) => [split, jsonl(rows)]),
  );
  const difficultyConsensusText = jsonl(difficultyConsensus);
  const nonCoreText = jsonl(nonCore);
  const exactAuditText = jsonl(exactAudit);
  const changedRows = finalization.filter(({ candidate, finalLabels }) => compareFields(finalLabels, labelsFrom(candidate)).length > 0);
  const changedFieldCount = finalization.reduce(
    (total, { candidate, finalLabels }) => total + compareFields(finalLabels, labelsFrom(candidate)).length,
    0,
  );
  const fieldChanges = Object.fromEntries(
    labelFields.map((field) => [
      field,
      finalization.filter(({ candidate, finalLabels }) => !same(candidate[field], finalLabels[field])).length,
    ]),
  );
  const summary = {
    difficultyAgreement: difficultyAgreementRows.length,
    difficultyConflict: finalization.length - difficultyAgreementRows.length,
    nonCore: nonCore.length,
    exactAgreement: exactAudit.length,
    exactAuditConfirmed: exactAudit.filter((row) => row.auditStatus === "confirmed").length,
    exactAuditCorrected: exactAudit.filter((row) => row.auditStatus === "corrected_after_third_pass").length,
    awkwardButLabelable: finalization.filter(({ reviewer }) => reviewer.issueCodes.includes("unnatural_language")).length,
    changedRecords: changedRows.length,
    changedFields: changedFieldCount,
    fieldChanges,
    simple: finalRecords.filter((record) => record.expectedDifficulty === "simple").length,
    complex: finalRecords.filter((record) => record.expectedDifficulty === "complex").length,
  };
  const reportText = buildReport(summary);
  const finalManifest = {
    schemaVersion: "gatelm.difficulty-independent-ood-policy-finalized-manifest.v1",
    sourceDatasetVersion,
    datasetVersion: finalDatasetVersion,
    policyVersion,
    labelState: "owner_approved_training_candidate",
    trainingEligible: true,
    recordLevelHumanReview: true,
    ownerApproval: {
      approvalType: "dataset_owner_full_approval",
      approvedAt: "2026-07-20",
      scope: "training_input_eligibility_only",
      basis: "explicit_owner_instruction_after_reviewer_a_comparison_and_policy_adjudication",
    },
    records: 5000,
    families: 1000,
    splits: {
      train: { path: finalSplitPaths.train, records: 3000, families: 600, sha256: sha256(finalSplitTexts.train) },
      validation: { path: finalSplitPaths.validation, records: 1000, families: 200, sha256: sha256(finalSplitTexts.validation) },
      test: { path: finalSplitPaths.test, records: 1000, families: 200, sha256: sha256(finalSplitTexts.test) },
    },
    trainingUsePolicy: {
      modelFit: ["train"],
      modelSelectionAndCalibration: ["validation"],
      evaluationOnly: ["test"],
      testExcludedFromTraining: true,
    },
    source: {
      candidate: { path: candidatePath, sha256: sha256(inputs.candidateText), unchanged: true },
      reviewerA: { path: reviewerPath, sha256: sha256(inputs.reviewerText) },
      resolvedCore: { path: resolvedCorePath, sha256: sha256(inputs.resolvedCoreText) },
      splitManifest: { path: splitManifestPath, sha256: sha256(inputs.splitManifestText) },
      diversityReport: { path: diversityReportPath, sha256: sha256(inputs.diversityReportText) },
    },
    output: { path: finalPath, sha256: sha256(finalText) },
    summary,
    integrity: {
      schemaFailures: 0,
      crossSplitFamilyOverlap: 0,
      exactDuplicatePrompts: 0,
      normalizedDuplicatePrompts: 0,
      dataset1ExactPromptOverlap: 0,
      dataset1NormalizedPromptOverlap: 0,
      dataset1PromptFamilyOverlap: 0,
      fourGramNearDuplicateGates: "pass_unchanged_prompt_content",
    },
  };
  const finalManifestText = `${JSON.stringify(finalManifest, null, 2)}\n`;
  const auditManifest = {
    schemaVersion: "gatelm.difficulty-independent-ood-policy-finalization-audit-manifest.v1",
    sourceDatasetVersion,
    finalDatasetVersion,
    policyVersion,
    counts: summary,
    outputs: {
      difficultyConsensus: { path: difficultyConsensusPath, sha256: sha256(difficultyConsensusText) },
      nonCoreAdjudication: { path: nonCorePath, sha256: sha256(nonCoreText) },
      exactAgreementAudit: { path: exactAuditPath, sha256: sha256(exactAuditText) },
      report: { path: reportPath, sha256: sha256(reportText) },
      finalDataset: { path: finalPath, sha256: sha256(finalText) },
      finalManifest: { path: finalManifestPath, sha256: sha256(finalManifestText) },
    },
    supersedesForDifficultyAgreement: {
      approvalVersion: "difficulty-independent-ood-owner-group-policy.2026-07-20.v1",
      affectedPolicyId: "structured_summary_multifacet_complex",
      affectedRecords: 113,
      reason: "latest owner rule confirms every provisional/Reviewer A difficulty agreement",
    },
    ownerApproval: {
      approvalType: "dataset_owner_full_approval",
      approvedAt: "2026-07-20",
      scope: "training_input_eligibility_only",
    },
    trainingEligible: true,
  };

  return {
    summary,
    finalRecords,
    difficultyConsensus,
    nonCore,
    exactAudit,
    finalManifest,
    auditManifest,
    artifacts: {
      [finalPath]: finalText,
      [finalSplitPaths.train]: finalSplitTexts.train,
      [finalSplitPaths.validation]: finalSplitTexts.validation,
      [finalSplitPaths.test]: finalSplitTexts.test,
      [finalManifestPath]: finalManifestText,
      [difficultyConsensusPath]: difficultyConsensusText,
      [nonCorePath]: nonCoreText,
      [exactAuditPath]: exactAuditText,
      [reportPath]: reportText,
      [auditManifestPath]: `${JSON.stringify(auditManifest, null, 2)}\n`,
    },
  };
}

function loadInputs() {
  return {
    candidateText: readFileSync(path.join(rootDir, candidatePath), "utf8"),
    reviewerText: readFileSync(path.join(rootDir, reviewerPath), "utf8"),
    queueText: readFileSync(path.join(rootDir, queuePath), "utf8"),
    coreQueueText: readFileSync(path.join(rootDir, coreQueuePath), "utf8"),
    resolvedCoreText: readFileSync(path.join(rootDir, resolvedCorePath), "utf8"),
    splitManifestText: readFileSync(path.join(rootDir, splitManifestPath), "utf8"),
    diversityReportText: readFileSync(path.join(rootDir, diversityReportPath), "utf8"),
  };
}

function writeArtifacts(artifacts, checkOnly) {
  const drift = [];
  for (const [relativePath, content] of Object.entries(artifacts)) {
    const absolutePath = path.join(rootDir, relativePath);
    if (checkOnly) {
      if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== content) drift.push(relativePath);
    } else {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, "utf8");
    }
  }
  if (drift.length > 0) throw new Error(`generated finalization artifact drift:\n${drift.join("\n")}`);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const result = buildPolicyFinalizationArtifacts(loadInputs());
  writeArtifacts(result.artifacts, checkOnly);
  console.log(
    `${checkOnly ? "verified" : "generated"} policy-finalized Dataset 2: ` +
      `5,000 records, 3,861 difficulty agreements, 3,314 non-core adjudications, ` +
      `${result.summary.exactAgreement} exact-agreement audits`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
