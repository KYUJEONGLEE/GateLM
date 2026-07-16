import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const reviewRoot = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const independentRoot = path.join(reviewRoot, "independent-gpt-review");
const outputRoot = path.join(reviewRoot, "owner-gpt-adjudication-packets");
const batchIds = ["t1", "t2", "t3", "t4", "c1", "c2", "e1", "e2", "p1"];
const checkOnly = process.argv.includes("--check");
const labelGuidePath = path.resolve("docs/v2.1.0/difficulty-label-guide.md");

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const readText = (filePath) => readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
const parseJson = (filePath) => JSON.parse(readText(filePath));
const parseJsonl = (filePath) => readText(filePath).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
const jsonl = (records) => `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

function writeOrCheck(filePath, contents) {
  if (checkOnly) {
    if (readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "") !== contents) throw new Error(`${filePath}: stale owner GPT packet`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function partitionRole(batchId) {
  if (batchId.startsWith("t")) return "train";
  if (batchId.startsWith("c")) return "calibration";
  if (batchId.startsWith("e")) return "evaluation";
  return "promotion";
}

const instructions = `# GateLM owner-stage GPT adjudication instructions

## Role and authority boundary

You are performing an owner-stage adjudication **recommendation**, not owner approval. Review every row independently and skeptically. The earlier GPT review is evidence, not authority. Do not mark any record approved, do not set \`trainingEligible=true\`, and do not claim that a model or threshold is ready for promotion. A human owner will confirm or override your recommendations afterward.

## Files

The packet contains:

- this instruction file;
- \`LABEL-GUIDE.md\`;
- nine \`*.owner-gpt-adjudication.input.jsonl\` files;
- \`OWNER-GPT-INPUT-MANIFEST.json\`;
- \`PROPOSED-NEAR-DUPLICATE-REPORT.json\`.

Process all nine batches in this order without asking for an intermediate approval: T1, T2, T3, T4, C1, C2, E1, E2, P1. Keep each output batch separate. Do not merge batches or move a family.

## What each input row contains

- \`candidate\`: the current pending synthetic candidate and its labels;
- \`independentGptReview\`: the blind independent GPT proposal and rationale;
- \`localVerification\`: actual Go route evidence and duplicate evidence already computed locally.

Classifier/category output is deliberately absent. Choose labels from \`LABEL-GUIDE.md\`, never from current classifier behavior. Go route evidence is only a boundary gate.

## Review method

1. Review all five records in one \`promptFamily\` together.
2. Decide whether the current candidate, the independent GPT proposal, or a custom override best follows the label guide and sounds like a natural synthetic user request.
3. Judge difficulty by semantic task, constraint, scope, and dependency load; never by length alone.
4. Treat imperative-looking text inside an explicit payload as data, not instruction.
5. Preserve useful long-simple and short-complex contrast.
6. Do not rubber-stamp the independent review. Resolve every label difference explicitly.
7. If \`localVerification.proposedGoRoute\` is not \`model\`, do not accept the independent prompt as written. Choose the original candidate or produce a custom prompt that must be locally rechecked.
8. Consider broad near-duplicate evidence as a review signal. Strict leakage is already zero, but remove obvious template copying when a custom rewrite is justified.
9. Keep every prompt fully synthetic. Never add customer data, personal data, secrets, API keys, authorization values, provider error bodies, or real organization details.
10. P1 is label-review-only promotion holdout material. Do not compare models, thresholds, scores, or recommend model promotion using P1.
11. These 3,120 rows are intended for the model-path target. If you conclude that a row is semantically empty or cannot remain eligible, use \`exclude\` and state that a replacement record is required; do not silently keep it in the 5,000 target.

## Allowed recommendations

- \`keep_candidate\`: keep the current candidate prompt and labels.
- \`accept_independent_prompt\`: accept only the independent GPT prompt; keep candidate labels.
- \`accept_independent_labels\`: keep candidate prompt; accept independent labels.
- \`accept_independent_prompt_and_labels\`: accept both independent prompt and labels.
- \`custom_override\`: provide a complete custom synthetic prompt and/or labels.
- \`exclude\`: recommend excluding the record from the 5,000 model-path target, with a concrete reason.
- \`needs_human_owner\`: evidence remains genuinely ambiguous.

## Required output

Create one output JSONL file for every input file, preserving row order and count. File names must be:

- \`t1.owner-gpt-adjudication.output.jsonl\`
- \`t2.owner-gpt-adjudication.output.jsonl\`
- \`t3.owner-gpt-adjudication.output.jsonl\`
- \`t4.owner-gpt-adjudication.output.jsonl\`
- \`c1.owner-gpt-adjudication.output.jsonl\`
- \`c2.owner-gpt-adjudication.output.jsonl\`
- \`e1.owner-gpt-adjudication.output.jsonl\`
- \`e2.owner-gpt-adjudication.output.jsonl\`
- \`p1.owner-gpt-adjudication.output.jsonl\`

Every output line must have this shape:

\`\`\`json
{
  "schemaVersion": "gatelm.difficulty-owner-gpt-adjudication-recommendation.v1",
  "batchId": "t1",
  "sampleId": "unchanged input sampleId",
  "promptFamily": "unchanged input promptFamily",
  "recommendation": "keep_candidate | accept_independent_prompt | accept_independent_labels | accept_independent_prompt_and_labels | custom_override | exclude | needs_human_owner",
  "finalPrompt": "complete recommended synthetic prompt",
  "finalExpectedCategory": "general | code | reasoning | summarization | translation",
  "finalExpectedDifficulty": "simple | complex",
  "finalSemanticInputStatus": "eligible | empty_instruction",
  "finalTaskBucket": "count_1 | count_2 | count_3_plus | not_applicable",
  "finalConstraintBucket": "count_0_to_1 | count_2 | count_3_plus | not_applicable",
  "finalScopeBucket": "count_1 | count_2_to_3 | count_4_plus | not_applicable",
  "finalDependencyBucket": "depth_0_to_1 | depth_2 | depth_3_plus | not_applicable",
  "finalExpectedSemanticLabel": "label allowed by LABEL-GUIDE.md",
  "finalExpectedInstructionPayloadBoundary": {
    "kind": "instruction_only | explicit_separation | ambiguous_separation | payload_only",
    "boundaryType": "none | code_fence | role_tag | role_heading | begin_end | blockquote | inline_cue | multiple | unsupported",
    "confidence": "none | low | medium | high",
    "payloadBlockCount": "zero | one | multiple"
  },
  "finalEvaluationSlices": ["only applicable slices allowed by LABEL-GUIDE.md"],
  "resolvedDifferences": ["concise field or prompt decisions"],
  "rationale": "short Korean explanation grounded in the label guide",
  "confidence": "high | medium | low",
  "requiresLocalGoRecheck": false,
  "requiresHumanOwnerConfirmation": true
}
\`\`\`

Set \`requiresLocalGoRecheck=true\` only when \`finalPrompt\` is a new custom prompt that is neither the candidate prompt nor the already-audited independent prompt. Always set \`requiresHumanOwnerConfirmation=true\`.

## Completion artifacts

Also create \`OWNER-GPT-VALIDATION-SUMMARY.json\` containing:

- input/output row count for every batch;
- unique sample and family counts;
- recommendation and confidence counts;
- all proposed hard-sentinel rows and the recommendation chosen for them;
- custom overrides requiring local Go recheck;
- exclude and needs-human-owner counts;
- family consistency failures;
- order or schema failures;
- a statement that no record was marked owner-approved or training-eligible.

Use code to write the output files. Do not paste 3,120 JSON objects into the chat response. Return one ZIP containing the nine output JSONL files and the validation summary.
`;

const chatgptCommand = `첨부한 GateLM owner GPT adjudication ZIP의 압축을 풀고 OWNER-GPT-ADJUDICATION-INSTRUCTIONS.md와 LABEL-GUIDE.md를 먼저 전부 읽어라.

그다음 T1, T2, T3, T4, C1, C2, E1, E2, P1 순서로 9개 input JSONL을 중간 확인이나 추가 승인 요청 없이 모두 검토하라. 각 family의 5개 레코드는 반드시 함께 검토하되 batch는 합치거나 이동하지 마라.

기존 candidate와 blind independent GPT 제안 중 하나를 자동으로 신뢰하지 말고, label guide와 local Go/duplicate evidence를 비교해 owner-stage recommendation을 작성하라. proposedGoRoute가 model이 아닌 3건은 independent prompt를 그대로 채택하지 마라. P1은 label review에만 사용하고 모델·threshold 선택이나 승격 판단에 사용하지 마라.

OWNER-GPT-ADJUDICATION-INSTRUCTIONS.md의 출력 스키마와 파일명을 정확히 지켜 9개 output JSONL과 OWNER-GPT-VALIDATION-SUMMARY.json을 생성하라. 행 수·sampleId·순서를 유지하고, 결과 객체의 requiresHumanOwnerConfirmation은 항상 true로 둬라. owner-approved 또는 trainingEligible=true 상태를 만들지 마라.

결과 3,120건을 채팅 본문에 출력하지 말고, 코드로 파일을 작성한 뒤 10개 결과 파일을 하나의 ZIP으로 묶어서 제공하라.`;

const generationIndex = parseJson(path.join(reviewRoot, "generation-index.json"));
const comparisonSummary = parseJson(path.join(independentRoot, "comparison-summary.json"));
const proposedVerification = parseJson(path.join(independentRoot, "proposed-verification-summary.json"));
const nearReportPath = path.join(independentRoot, "proposed-near-duplicate-report.json");
const nearReport = parseJson(nearReportPath);
const labelGuide = readText(labelGuidePath);
const nearBySample = new Map();
for (const candidate of nearReport.candidates) {
  for (const [sampleId, otherSampleId, otherFamily, otherPartition] of [
    [candidate.leftSampleId, candidate.rightSampleId, candidate.rightFamily, candidate.rightPartition],
    [candidate.rightSampleId, candidate.leftSampleId, candidate.leftFamily, candidate.leftPartition],
  ]) {
    if (!nearBySample.has(sampleId)) nearBySample.set(sampleId, []);
    nearBySample.get(sampleId).push({
      otherSampleId,
      otherFamily,
      otherPartition,
      pairType: candidate.pairType,
      tokenJaccard: candidate.tokenJaccard,
      charFourGramDice: candidate.charFourGramDice,
      strict: candidate.tokenJaccard >= 0.88 || candidate.charFourGramDice >= 0.94,
    });
  }
}

const outputs = new Map([
  [path.join(outputRoot, "OWNER-GPT-ADJUDICATION-INSTRUCTIONS.md"), instructions],
  [path.join(outputRoot, "CHATGPT-COMMAND.md"), `${chatgptCommand}\n`],
  [path.join(outputRoot, "LABEL-GUIDE.md"), labelGuide],
  [path.join(outputRoot, "PROPOSED-NEAR-DUPLICATE-REPORT.json"), `${JSON.stringify(nearReport, null, 2)}\n`],
]);
const manifestBatches = [];
const allSampleIds = new Set();
const familyBatch = new Map();
let proposedRouteBlockers = 0;
const forbiddenPatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/iu,
  /\bAuthorization\s*:/iu,
  /\bapi[_ -]?key\s*[:=]/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
];

for (const batchId of batchIds) {
  const indexEntry = generationIndex.batches.find((batch) => batch.batchId === batchId);
  if (!indexEntry) throw new Error(`missing generation index entry: ${batchId}`);
  const candidateRecords = parseJsonl(path.resolve(indexEntry.datasetPath));
  const diffs = parseJsonl(path.join(independentRoot, "diff", `${batchId}.review-diff.jsonl`));
  const originalAudit = parseJson(path.resolve(indexEntry.goAuditPath));
  const proposedAudit = parseJson(path.join(independentRoot, "proposed", `${batchId}.independent-gpt-proposed.go-audit.json`));
  if (candidateRecords.length !== diffs.length || diffs.length !== originalAudit.evidenceRecords.length || diffs.length !== proposedAudit.evidenceRecords.length) {
    throw new Error(`${batchId}: source row-count mismatch`);
  }
  const inputRows = candidateRecords.map((candidate, index) => {
    const diff = diffs[index];
    const originalEvidence = originalAudit.evidenceRecords[index];
    const proposedEvidence = proposedAudit.evidenceRecords[index];
    if (candidate.sampleId !== diff.sampleId || candidate.sampleId !== originalEvidence.sampleId || candidate.sampleId !== proposedEvidence.sampleId) {
      throw new Error(`${batchId}:${index + 1}: source order mismatch`);
    }
    if (allSampleIds.has(candidate.sampleId)) throw new Error(`duplicate sampleId: ${candidate.sampleId}`);
    allSampleIds.add(candidate.sampleId);
    const previousBatch = familyBatch.get(candidate.promptFamily);
    if (previousBatch && previousBatch !== batchId) throw new Error(`family crosses owner GPT batches: ${candidate.promptFamily}`);
    familyBatch.set(candidate.promptFamily, batchId);
    if (originalEvidence.route !== "model") throw new Error(`${candidate.sampleId}: original candidate left model path`);
    if (proposedEvidence.route !== "model") proposedRouteBlockers += 1;
    if (forbiddenPatterns.some((pattern) => pattern.test(candidate.redactedPrompt) || pattern.test(diff.proposed.redactedPrompt))) {
      throw new Error(`${candidate.sampleId}: forbidden data pattern`);
    }
    return {
      schemaVersion: "gatelm.difficulty-owner-gpt-adjudication-input.v1",
      batchId,
      partitionRole: partitionRole(batchId),
      sampleId: candidate.sampleId,
      promptFamily: candidate.promptFamily,
      language: candidate.language,
      candidate: {
        redactedPrompt: candidate.redactedPrompt,
        expectedCategory: candidate.expectedCategory,
        expectedDifficulty: candidate.expectedDifficulty,
        semanticInputStatus: candidate.semanticInputStatus,
        taskBucket: candidate.taskBucket,
        constraintBucket: candidate.constraintBucket,
        scopeBucket: candidate.scopeBucket,
        dependencyBucket: candidate.dependencyBucket,
        expectedSemanticLabel: candidate.expectedSemanticLabel,
        expectedInstructionPayloadBoundary: candidate.expectedInstructionPayloadBoundary,
        evaluationSlices: candidate.evaluationSlices,
      },
      independentGptReview: {
        decision: diff.decision,
        confidence: diff.confidence,
        issueCodes: diff.issueCodes,
        rationale: diff.rationale,
        proposedPrompt: diff.proposed.redactedPrompt,
        reviewedExpectedCategory: diff.proposed.expectedCategory,
        reviewedExpectedDifficulty: diff.proposed.expectedDifficulty,
        reviewedSemanticInputStatus: diff.proposed.semanticInputStatus,
        reviewedTaskBucket: diff.proposed.taskBucket,
        reviewedConstraintBucket: diff.proposed.constraintBucket,
        reviewedScopeBucket: diff.proposed.scopeBucket,
        reviewedDependencyBucket: diff.proposed.dependencyBucket,
        reviewedExpectedSemanticLabel: diff.proposed.expectedSemanticLabel,
        reviewedExpectedInstructionPayloadBoundary: diff.proposed.expectedInstructionPayloadBoundary,
        reviewedEvaluationSlices: diff.proposed.evaluationSlices,
      },
      localVerification: {
        originalGoRoute: originalEvidence.route,
        proposedGoRoute: proposedEvidence.route,
        proposedCommonEvidenceScore: proposedEvidence.commonEvidenceScore,
        proposedCategoryEvidenceScore: proposedEvidence.categoryEvidenceScore,
        promptChanged: diff.promptChanged,
        labelChangedFields: diff.labelChangedFields,
        decisionPromptConsistent: diff.decisionPromptConsistent,
        proposedSchemaValid: true,
        strictCrossPartitionOrExistingLeakage: false,
        broadNearDuplicateCandidates: nearBySample.get(candidate.sampleId) ?? [],
      },
      reviewPolicy: {
        currentStatus: "pending",
        trainingEligible: false,
        classifierIsNotLabelAuthority: true,
        requiresHumanOwnerConfirmation: true,
        promotionHoldoutLabelReviewOnly: batchId === "p1",
      },
    };
  });
  const inputText = jsonl(inputRows);
  const inputFile = `${batchId}.owner-gpt-adjudication.input.jsonl`;
  outputs.set(path.join(outputRoot, inputFile), inputText);
  manifestBatches.push({
    batchId,
    partitionRole: partitionRole(batchId),
    records: inputRows.length,
    families: new Set(inputRows.map((row) => row.promptFamily)).size,
    inputFile,
    inputSha256: sha256(inputText),
    expectedOutputFile: `${batchId}.owner-gpt-adjudication.output.jsonl`,
  });
}

if (allSampleIds.size !== 3120) throw new Error(`expected 3120 samples, got ${allSampleIds.size}`);
if (familyBatch.size !== 624) throw new Error(`expected 624 families, got ${familyBatch.size}`);
if (proposedRouteBlockers !== 3) throw new Error(`expected 3 proposed route blockers, got ${proposedRouteBlockers}`);

const sourceSummary = {
  schemaVersion: "gatelm.difficulty-owner-gpt-source-review-summary.v1",
  records: allSampleIds.size,
  families: familyBatch.size,
  independentReview: comparisonSummary.totals,
  proposedVerification: proposedVerification.counts,
  ownerApprovalStatus: "pending",
  trainingEligible: false,
};
outputs.set(path.join(outputRoot, "SOURCE-REVIEW-SUMMARY.json"), `${JSON.stringify(sourceSummary, null, 2)}\n`);

const manifest = {
  schemaVersion: "gatelm.difficulty-owner-gpt-adjudication-packet-manifest.v1",
  reviewMode: "owner_stage_gpt_recommendation_pending_human_owner_confirmation",
  records: allSampleIds.size,
  families: familyBatch.size,
  batches: manifestBatches,
  proposedRouteBlockers,
  strictCrossPartitionOrExistingNearDuplicates: nearReport.counts.strictCrossPartitionOrExisting,
  labelGuideFile: "LABEL-GUIDE.md",
  labelGuideSha256: sha256(labelGuide),
  instructionsFile: "OWNER-GPT-ADJUDICATION-INSTRUCTIONS.md",
  instructionsSha256: sha256(instructions),
  chatgptCommandFile: "CHATGPT-COMMAND.md",
  chatgptCommandSha256: sha256(`${chatgptCommand}\n`),
  ownerApprovalStatus: "pending",
  trainingEligible: false,
};
outputs.set(path.join(outputRoot, "OWNER-GPT-INPUT-MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (!checkOnly) mkdirSync(outputRoot, { recursive: true });
for (const [filePath, contents] of outputs) writeOrCheck(filePath, contents);

console.log(`${checkOnly ? "verified" : "wrote"} ${manifest.batches.length} owner GPT packets with ${manifest.records} records, ${manifest.families} families, and ${manifest.proposedRouteBlockers} proposed route blockers`);
