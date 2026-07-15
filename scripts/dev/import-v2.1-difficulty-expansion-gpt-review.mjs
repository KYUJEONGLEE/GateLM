import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

const REVIEW_DIRECTORY = "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt";
const SOURCE_DATASET_PATH =
  "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.fixture.jsonl";
const SOURCE_MANIFEST_PATH =
  "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.manifest.json";
const RAW_PATH = `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.gpt-adjudication.raw.jsonl`;
const NORMALIZED_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.gpt-adjudication.normalized.jsonl`;
const CANDIDATE_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.gpt-merged-candidate.jsonl`;
const DIFF_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.human-approval-diff.jsonl`;
const HUMAN_QUEUE_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.human-review-queue.jsonl`;
const REPORT_JSON_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.review-report.json`;
const REPORT_MARKDOWN_PATH =
  `${REVIEW_DIRECTORY}/difficulty-label-expansion-2000.review-report.md`;
const GPT_HANDOFF_DIRECTORY = `${REVIEW_DIRECTORY}/direct-review-gpt`;
const HUMAN_REVIEW_INSTRUCTIONS_PATH = `${GPT_HANDOFF_DIRECTORY}/GPT-COMMAND.md`;
const HUMAN_QUEUE_BATCH_PREFIX = `${GPT_HANDOFF_DIRECTORY}/review`;

const SOURCE_SCHEMA_VERSION = "gatelm.difficulty-gpt-adjudication.v1";
const NORMALIZED_SCHEMA_VERSION = "gatelm.difficulty-gpt-adjudication-normalized.v1";
const CANDIDATE_DATASET_VERSION =
  "difficulty_label_2026_07_15_expansion_2000_gpt_candidate_v1";
const CREATED_AT = "2026-07-15T00:00:00Z";
const LOW_CONFIDENCE_THRESHOLD = 0.9;

const EXPECTED_ARCHIVES = [
  {
    name: "difficulty-label-expansion-2000.gpt-review.outputs-available.zip",
    sha256: "751eb0a1aee6c7dd5d3dd44d79de59df1aa2bb0c88edb4052cfe567857c90b26",
    batches: [1, 2, 3, 4, 5, 6, 7, 9, 10, 12],
  },
  {
    name: "gpt-review-output-attached-batches.zip",
    sha256: "7b991f0ecd3741e3886d51c73b6588eb9220c28e64f205af5574eb73fdf87c08",
    batches: [8, 11, 13, 14, 15, 16, 17, 18, 19, 20],
  },
];

const RETURNED_FIELDS = [
  "expectedCategory",
  "expectedDifficulty",
  "semanticInputStatus",
  "taskBucket",
  "constraintBucket",
  "scopeBucket",
  "dependencyBucket",
  "expectedSemanticLabel",
  "promptFamily",
  "expectedInstructionPayloadBoundary",
  "evaluationSlices",
];
const GPT_FIELDS = [
  "schemaVersion",
  "sampleId",
  "decision",
  ...RETURNED_FIELDS,
  "promptAction",
  "replacementPrompt",
  "confidence",
  "rationaleCodes",
];
const LABEL_FIELDS = [...RETURNED_FIELDS];

const ENUMS = {
  decision: ["accept", "correct"],
  expectedCategory: ["general", "code", "translation", "summarization", "reasoning"],
  expectedDifficulty: ["simple", "complex"],
  semanticInputStatus: ["eligible", "empty_instruction"],
  taskBucket: ["count_1", "count_2", "count_3_plus", "not_applicable"],
  constraintBucket: ["count_0_to_1", "count_2", "count_3_plus", "not_applicable"],
  scopeBucket: ["count_1", "count_2_to_3", "count_4_plus", "not_applicable"],
  dependencyBucket: ["depth_0_to_1", "depth_2", "depth_3_plus", "not_applicable"],
  promptAction: ["keep_source", "accept_proposed_rewrite", "replace"],
};
const SLICES = [
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
const RATIONALE_CODES = [
  "accepted_as_proposed",
  "category_changed",
  "difficulty_changed",
  "semantic_input_status_changed",
  "semantic_label_changed",
  "bucket_changed",
  "family_changed",
  "boundary_changed",
  "slice_changed",
  "prompt_rewrite_changed",
  "insufficient_context",
];
const SEMANTIC_LABELS = {
  general: [
    "general_qa",
    "general_explanation",
    "general_extraction",
    "general_support",
    "general_transformation",
    "general_other",
  ],
  code: [
    "code_generation",
    "code_debugging",
    "code_refactoring",
    "code_review",
    "code_explanation",
    "code_design",
  ],
  translation: [
    "translation_direct",
    "translation_localization",
    "translation_style_preserving",
  ],
  summarization: [
    "summarization_direct",
    "summarization_key_points",
    "summarization_structured",
    "summarization_multi_source",
  ],
  reasoning: [
    "reasoning_comparison",
    "reasoning_planning",
    "reasoning_decision",
    "reasoning_constraint_solving",
    "reasoning_causal",
  ],
};
const BOUNDARY_TYPE_NORMALIZATION = {
  colon_delimited: "inline_cue",
  quoted_text: "inline_cue",
  semicolon_delimited: "inline_cue",
  sentence_context: "unsupported",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function parseJsonl(text, label) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "" && !["```", "```json", "```jsonl"].includes(line.trim()))
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}: invalid JSON at line ${index + 1}: ${error.message}`);
      }
    });
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const value = typeof selector === "function" ? selector(record) : record[selector];
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertEnum(value, values, field, sampleId) {
  if (!values.includes(value)) {
    throw new Error(`${sampleId}: ${field} has unsupported value ${JSON.stringify(value)}`);
  }
}

function normalizeBoundary(boundary, sampleId) {
  if (!boundary || typeof boundary !== "object" || Array.isArray(boundary)) {
    throw new Error(`${sampleId}: expectedInstructionPayloadBoundary must be an object`);
  }
  const expectedKeys = ["kind", "boundaryType", "confidence", "payloadBlockCount"];
  if (!same(Object.keys(boundary).sort(), [...expectedKeys].sort())) {
    throw new Error(`${sampleId}: boundary must contain exactly ${expectedKeys.join(", ")}`);
  }

  const result = { ...boundary };
  const normalizations = [];
  const mappedType = BOUNDARY_TYPE_NORMALIZATION[result.boundaryType];
  if (mappedType) {
    normalizations.push({
      field: "expectedInstructionPayloadBoundary.boundaryType",
      from: result.boundaryType,
      to: mappedType,
    });
    result.boundaryType = mappedType;
  }
  if (result.kind === "ambiguous_separation" && result.confidence !== "low") {
    normalizations.push({
      field: "expectedInstructionPayloadBoundary.confidence",
      from: result.confidence,
      to: "low",
    });
    result.confidence = "low";
  }

  const valid =
    (result.kind === "instruction_only" &&
      result.boundaryType === "none" &&
      result.confidence === "none" &&
      result.payloadBlockCount === "zero") ||
    (result.kind === "explicit_separation" &&
      ["code_fence", "role_tag", "role_heading", "begin_end", "blockquote", "inline_cue", "multiple"].includes(
        result.boundaryType,
      ) &&
      ["low", "medium", "high"].includes(result.confidence) &&
      ["one", "multiple"].includes(result.payloadBlockCount)) ||
    (result.kind === "ambiguous_separation" &&
      ["multiple", "unsupported"].includes(result.boundaryType) &&
      result.confidence === "low" &&
      ["zero", "one", "multiple"].includes(result.payloadBlockCount)) ||
    (result.kind === "payload_only" &&
      [
        "code_fence",
        "role_tag",
        "role_heading",
        "begin_end",
        "blockquote",
        "inline_cue",
        "multiple",
        "unsupported",
      ].includes(result.boundaryType) &&
      ["low", "medium", "high"].includes(result.confidence) &&
      ["one", "multiple"].includes(result.payloadBlockCount));
  if (!valid) {
    throw new Error(`${sampleId}: invalid normalized boundary tuple ${JSON.stringify(result)}`);
  }
  return { boundary: result, normalizations };
}

function selectPrompt(row, sourceRecord) {
  switch (row.promptAction) {
    case "keep_source":
    case "accept_proposed_rewrite":
      return sourceRecord.redactedPrompt;
    case "replace":
      return row.replacementPrompt;
    default:
      throw new Error(`${row.sampleId}: unsupported promptAction`);
  }
}

function validateNormalizedRow(row, sourceRecord) {
  const sampleId = row.sampleId ?? "<missing sampleId>";
  assertEnum(row.decision, ENUMS.decision, "decision", sampleId);
  for (const field of [
    "expectedCategory",
    "expectedDifficulty",
    "semanticInputStatus",
    "taskBucket",
    "constraintBucket",
    "scopeBucket",
    "dependencyBucket",
    "promptAction",
  ]) {
    assertEnum(row[field], ENUMS[field], field, sampleId);
  }
  if (!SEMANTIC_LABELS[row.expectedCategory].includes(row.expectedSemanticLabel)) {
    throw new Error(`${sampleId}: expectedSemanticLabel does not belong to expectedCategory`);
  }
  if (!/^[a-z0-9][a-z0-9._:-]+$/u.test(row.promptFamily)) {
    throw new Error(`${sampleId}: invalid promptFamily`);
  }
  if (!Array.isArray(row.evaluationSlices) || row.evaluationSlices.length === 0) {
    throw new Error(`${sampleId}: evaluationSlices must be non-empty`);
  }
  if (new Set(row.evaluationSlices).size !== row.evaluationSlices.length) {
    throw new Error(`${sampleId}: evaluationSlices must be unique`);
  }
  for (const slice of row.evaluationSlices) assertEnum(slice, SLICES, "evaluationSlices", sampleId);
  if (!Array.isArray(row.rationaleCodes) || row.rationaleCodes.length === 0) {
    throw new Error(`${sampleId}: rationaleCodes must be non-empty`);
  }
  for (const code of row.rationaleCodes) assertEnum(code, RATIONALE_CODES, "rationaleCodes", sampleId);
  if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) {
    throw new Error(`${sampleId}: confidence must be between 0 and 1`);
  }
  if (row.promptAction === "replace") {
    if (typeof row.replacementPrompt !== "string" || row.replacementPrompt.trim() === "") {
      throw new Error(`${sampleId}: replace requires a non-empty replacementPrompt`);
    }
    if ([...row.replacementPrompt].length > 65536) {
      throw new Error(`${sampleId}: replacementPrompt exceeds canonical maximum length`);
    }
  } else if (row.replacementPrompt !== null) {
    throw new Error(`${sampleId}: non-replace promptAction requires replacementPrompt=null`);
  }

  const buckets = [row.taskBucket, row.constraintBucket, row.scopeBucket, row.dependencyBucket];
  if (row.semanticInputStatus === "empty_instruction" && buckets.some((value) => value !== "not_applicable")) {
    throw new Error(`${sampleId}: empty_instruction requires four not_applicable buckets`);
  }
  if (row.semanticInputStatus === "eligible" && buckets.includes("not_applicable")) {
    throw new Error(`${sampleId}: eligible cannot use not_applicable buckets`);
  }
  if (
    row.expectedInstructionPayloadBoundary.kind === "payload_only" &&
    row.semanticInputStatus !== "empty_instruction"
  ) {
    throw new Error(`${sampleId}: payload_only requires semanticInputStatus=empty_instruction`);
  }

  const prompt = selectPrompt(row, sourceRecord);
  const promptLength = [...prompt].length;
  const shouldBeShortComplex = row.expectedDifficulty === "complex" && promptLength <= 120;
  const shouldBeLongSimple = row.expectedDifficulty === "simple" && promptLength > 120;
  if (row.evaluationSlices.includes("short_complex") !== shouldBeShortComplex) {
    throw new Error(`${sampleId}: short_complex does not match final prompt length ${promptLength}`);
  }
  if (row.evaluationSlices.includes("long_simple") !== shouldBeLongSimple) {
    throw new Error(`${sampleId}: long_simple does not match final prompt length ${promptLength}`);
  }
  const languageSlice = { ko: "korean", en: "english", mixed: "mixed_language" }[sourceRecord.language];
  if (!languageSlice || !row.evaluationSlices.includes(languageSlice)) {
    throw new Error(`${sampleId}: evaluationSlices do not match source language`);
  }
  if (
    row.evaluationSlices.includes("payload_contamination") &&
    row.expectedInstructionPayloadBoundary.kind === "instruction_only"
  ) {
    throw new Error(`${sampleId}: payload_contamination cannot use instruction_only`);
  }

  const labelChanged = LABEL_FIELDS.some((field) => !same(row[field], sourceRecord[field]));
  const promptChanged = prompt !== sourceRecord.redactedPrompt;
  if (row.decision === "accept") {
    if (labelChanged || promptChanged || row.promptAction !== "keep_source") {
      throw new Error(`${sampleId}: accept cannot change labels or prompt`);
    }
    if (!same(row.rationaleCodes, ["accepted_as_proposed"])) {
      throw new Error(`${sampleId}: accept requires only accepted_as_proposed rationale`);
    }
  } else if (!labelChanged && !promptChanged) {
    throw new Error(`${sampleId}: correct must change at least one label or the prompt`);
  }
  if (promptChanged && !row.rationaleCodes.includes("prompt_rewrite_changed")) {
    throw new Error(`${sampleId}: prompt change requires prompt_rewrite_changed rationale`);
  }
}

function normalizeRow(row, sourceRecord) {
  const sampleId = row?.sampleId ?? "<missing sampleId>";
  if (row?.schemaVersion !== SOURCE_SCHEMA_VERSION) {
    throw new Error(`${sampleId}: unsupported GPT adjudication schemaVersion`);
  }
  if (!same(Object.keys(row).sort(), [...GPT_FIELDS].sort())) {
    throw new Error(`${sampleId}: GPT adjudication fields do not match the expected contract`);
  }
  const { boundary, normalizations } = normalizeBoundary(
    row.expectedInstructionPayloadBoundary,
    sampleId,
  );
  const normalized = {
    ...row,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    expectedInstructionPayloadBoundary: boundary,
    sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
    normalizations,
  };
  validateNormalizedRow(normalized, sourceRecord);
  return normalized;
}

function changedFields(sourceRecord, normalizedRow, candidateRecord) {
  const changes = [];
  for (const field of LABEL_FIELDS) {
    if (!same(sourceRecord[field], normalizedRow[field])) {
      changes.push({ field, before: sourceRecord[field], after: normalizedRow[field] });
    }
  }
  if (sourceRecord.redactedPrompt !== candidateRecord.redactedPrompt) {
    changes.push({
      field: "redactedPrompt",
      before: sourceRecord.redactedPrompt,
      after: candidateRecord.redactedPrompt,
    });
  }
  return changes;
}

function groupBy(records, selector) {
  const result = new Map();
  for (const record of records) {
    const key = selector(record);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(record);
  }
  return result;
}

function familyConsistency(candidateRecords, sourceManifest) {
  const sourceFamilies = new Map(
    sourceManifest.families.map((family) => [family.promptFamily, family]),
  );
  const candidateFamilies = groupBy(candidateRecords, (record) => record.promptFamily);
  const issues = [];
  for (const [promptFamily, records] of candidateFamilies) {
    const categories = new Set(records.map((record) => record.expectedCategory));
    const semanticLabels = new Set(records.map((record) => record.expectedSemanticLabel));
    const sourceFamily = sourceFamilies.get(promptFamily);
    if (records.length !== 10) issues.push({ promptFamily, code: "family_size_changed" });
    if (categories.size !== 1) issues.push({ promptFamily, code: "category_conflict" });
    if (semanticLabels.size !== 1) issues.push({ promptFamily, code: "semantic_label_conflict" });
    if (!sourceFamily) {
      issues.push({ promptFamily, code: "family_not_in_source_manifest" });
      continue;
    }
    if (
      sourceFamily.expectedCategory !== records[0].expectedCategory ||
      sourceFamily.expectedSemanticLabel !== records[0].expectedSemanticLabel
    ) {
      issues.push({ promptFamily, code: "family_manifest_label_changed" });
    }
  }
  for (const promptFamily of sourceFamilies.keys()) {
    if (!candidateFamilies.has(promptFamily)) {
      issues.push({ promptFamily, code: "source_family_missing" });
    }
  }
  return {
    candidateFamilies,
    sourceFamilies,
    issues,
    issueFamilies: new Set(issues.map((issue) => issue.promptFamily)),
  };
}

function simpleComplexPairInversions(normalizedRows, sourceRecords) {
  const rowById = new Map(normalizedRows.map((row) => [row.sampleId, row]));
  const sourceFamilies = groupBy(sourceRecords, (record) => record.promptFamily);
  const sampleIds = new Set();
  const pairs = [];
  for (const [promptFamily, records] of sourceFamilies) {
    const byVariant = new Map(
      records.map((record) => {
        const match = record.sampleId.match(/_v(\d{2})$/u);
        if (!match) throw new Error(`${record.sampleId}: missing contrast variant suffix`);
        return [Number(match[1]), record];
      }),
    );
    for (let simpleVariant = 1; simpleVariant <= 5; simpleVariant += 1) {
      const simpleSource = byVariant.get(simpleVariant);
      const complexSource = byVariant.get(simpleVariant + 5);
      if (!simpleSource || !complexSource) {
        throw new Error(`${promptFamily}: incomplete simple/complex contrast pair ${simpleVariant}`);
      }
      const simpleRow = rowById.get(simpleSource.sampleId);
      const complexRow = rowById.get(complexSource.sampleId);
      if (
        simpleRow.expectedDifficulty === "complex" &&
        complexRow.expectedDifficulty === "simple"
      ) {
        sampleIds.add(simpleRow.sampleId);
        sampleIds.add(complexRow.sampleId);
        pairs.push({
          promptFamily,
          simpleSampleId: simpleRow.sampleId,
          complexSampleId: complexRow.sampleId,
        });
      }
    }
  }
  return { sampleIds, pairs };
}

function queueReasons(row, changes, familyIssueFamilies, invertedPairSampleIds) {
  const reasons = [];
  const changed = new Set(changes.map((change) => change.field));
  if (row.decision === "correct") reasons.push("gpt_decision_correct");
  if (row.confidence < LOW_CONFIDENCE_THRESHOLD) reasons.push("low_gpt_confidence");
  if (changed.has("expectedCategory")) reasons.push("category_changed");
  if (changed.has("expectedDifficulty")) reasons.push("difficulty_changed");
  if (
    ["taskBucket", "constraintBucket", "scopeBucket", "dependencyBucket"].some((field) =>
      changed.has(field),
    )
  ) {
    reasons.push("semantic_bucket_changed");
  }
  if (changed.has("promptFamily")) reasons.push("prompt_family_changed");
  if (row.promptAction === "replace") reasons.push("prompt_action_replace");
  if (row.expectedInstructionPayloadBoundary.kind === "ambiguous_separation") {
    reasons.push("ambiguous_instruction_payload_boundary");
  }
  if (row.expectedInstructionPayloadBoundary.kind === "payload_only") {
    reasons.push("payload_only_empty_instruction");
  }
  if (familyIssueFamilies.has(row.promptFamily)) reasons.push("family_consistency_issue");
  if (invertedPairSampleIds.has(row.sampleId)) reasons.push("simple_complex_pair_inverted");
  if (row.normalizations.length > 0) reasons.push("contract_enum_or_boundary_normalization");
  return reasons;
}

function buildQueueBatches(queueRows) {
  const categoryOrder = ["general", "code", "translation", "summarization", "reasoning"];
  const batches = [];
  for (const category of categoryOrder) {
    const familyGroups = [...groupBy(
      queueRows.filter((row) => row.proposed.expectedCategory === category),
      (row) => row.promptFamily,
    ).values()].sort((left, right) => left[0].promptFamily.localeCompare(right[0].promptFamily));
    let current = [];
    for (const familyRows of familyGroups) {
      if (current.length > 0 && current.length + familyRows.length > 80) {
        batches.push(current);
        current = [];
      }
      current.push(...familyRows);
    }
    if (current.length > 0) batches.push(current);
  }
  if (batches.some((batch) => batch.length === 0 || batch.length > 80)) {
    throw new Error(`human queue batches must contain between 1 and 80 records`);
  }
  const familyBatch = new Map();
  batches.forEach((batch, index) => {
    for (const row of batch) {
      const prior = familyBatch.get(row.promptFamily);
      if (prior !== undefined && prior !== index) {
        throw new Error(`${row.promptFamily}: human queue family split across batches`);
      }
      familyBatch.set(row.promptFamily, index);
    }
  });
  return batches;
}

function humanReviewInstructions() {
  return `# Difficulty expansion 2,000 — selected direct review command

## 전달 방법

이 파일과 같은 폴더의 \`review-NN.input.jsonl\` 하나를 GPT의 새 대화에 첨부한다. 한 번에 파일 하나만 전달한다. 같은 \`promptFamily\`의 선택된 행은 batch 사이에 쪼개지지 않는다. 응답은 같은 번호의 \`review-NN.output.jsonl\`로 저장한다.

## GPT에게 전달할 지시

당신은 GateLM difficulty expansion candidate의 2차 독립 검토자다. 이 출력은 사람 승인 자체가 아니며 최종 dataset owner가 별도로 승인한다. 첨부 JSONL의 모든 행을 독립적으로 검토하고 입력 순서대로 정확히 한 번씩 반환하라.

첨부 행은 아래 조건 중 하나 이상에 해당해 선별되었다.

- 기존 GPT의 \`decision=correct\`
- GPT confidence가 0.90 미만
- category, difficulty, 네 semantic bucket 또는 promptFamily 변경
- \`promptAction=replace\`
- boundary가 \`ambiguous_separation\` 또는 \`payload_only\`
- 같은 family 안의 category/semantic label 판정 충돌
- simple/complex contrast pair의 difficulty가 서로 뒤집힘
- 계약 밖 enum 또는 boundary 조합의 정규화 발생

각 행에서 다음을 확인한다.

1. \`sourcePrompt\`와 \`candidatePrompt\`를 비교해 candidate가 instruction 의미, 합성 payload 수, 언어와 primary intent를 보존하는지 확인한다.
2. \`sourceProposed\`와 \`proposed\`를 비교해 기존 GPT의 변경이 실제 prompt 근거와 맞는지 확인한다.
3. \`proposed.expectedInstructionPayloadBoundary\`가 실제 prompt 경계와 일치하는지 확인한다. 특히 \`ambiguous_separation\`과 \`payload_only\`를 엄격히 본다.
4. payload의 category cue를 instruction으로 오인하지 않았는지 확인한다.
5. 같은 \`promptFamily\` 안에서 category와 semantic label이 같고, 각 행의 difficulty·bucket·slice가 prompt에 맞는지 확인한다.
6. v01↔v06, v02↔v07, v03↔v08, v04↔v09, v05↔v10은 simple/complex contrast pair다. 뒤집힘 표시가 있으면 두 행을 함께 검증한다.
7. 의미 있는 instruction이 없으면 \`payload_only + empty_instruction + 네 not_applicable bucket + general/simple/general_other\`인지 확인한다.
8. \`normalizations\`가 있으면 원래 값이 canonical enum으로 안전하게 변환됐는지 확인한다.
9. token, embedding, score, probability, reviewer identity, secret 또는 실제 고객 데이터를 만들지 않는다.

설명이나 Markdown 없이 입력과 같은 수의 JSONL만 반환한다. 각 줄은 아래 필드만 사용한다.

    {"schemaVersion":"gatelm.difficulty-expansion-human-review-recommendation.v1","sampleId":"...","recommendation":"approve_candidate|correct_candidate|reject_candidate","correctedPrompt":null,"correctedProposed":null,"confidence":0.0,"rationaleCodes":["..."],"reviewNote":"..."}

- \`approve_candidate\`: candidate prompt와 proposed 전체를 유지한다. \`correctedPrompt=null\`, \`correctedProposed=null\`이다.
- \`correct_candidate\`: prompt만 바꾸면 \`correctedPrompt\`에 전체 교체 문장을 넣고, label만 바꾸면 \`correctedProposed\`에 입력 \`proposed\`와 같은 전체 object shape로 교정값을 넣는다. 바꾸지 않는 쪽은 null이다.
- \`reject_candidate\`: 합성 데이터로 복구하기 어렵거나 family 의도가 무너진 경우다. 두 corrected field는 null이다.
- \`confidence\`는 추천 판단의 신뢰도이며 model probability가 아니다.
- \`reviewNote\`는 240자 이하로 쓰고 prompt 원문 조각, 사람 이름 또는 secret을 넣지 않는다.
- rationale code는 \`candidate_confirmed | prompt_rewrite | category_or_semantic_label | difficulty_or_semantic_head | instruction_payload_boundary | empty_instruction | family_consistency | evaluation_slice | insufficient_context\`만 사용한다.
- 행을 생략하거나 재정렬하지 말고, JSON parse와 sampleId 중복·누락을 마지막에 자체 확인한다.
`;
}

function markdownReport(report) {
  const reasonRows = Object.entries(report.humanReviewQueue.byReason)
    .map(([reason, count]) => `| \`${reason}\` | ${count} |`)
    .join("\n");
  const categoryRows = Object.entries(report.humanReviewQueue.byCategory)
    .map(([category, count]) => `| ${category} | ${count} |`)
    .join("\n");
  return `# Difficulty expansion 2,000 — GPT merge and human review queue

## 결론

- GPT 출력 2,000건은 원본 sampleId와 정확히 1:1 대응한다.
- 누락, 중복, 예상 밖 ID, JSON 오류, enum 위반, boundary tuple 위반은 모두 0건이다.
- GPT는 label·family·boundary·slice를 바꾸지 않았고, 합성 prompt 800건의 문장 교체만 제안했다.
- 사용자가 지정한 직접 검토 조건의 합집합은 ${report.humanReviewQueue.records}건(${report.humanReviewQueue.percentOfDataset}%)이다.
- 원본 fixture는 수정하지 않았다. 병합 candidate는 \`pending\`, \`trainingEligible=false\`이며 사람 승인으로 간주하지 않는다.

## 무결성·정규화

| 항목 | 결과 |
|---|---:|
| 파싱된 GPT 행 | ${report.integrity.parsedRecords} |
| 고유 sampleId | ${report.integrity.uniqueSampleIds} |
| 누락 | ${report.integrity.missingSampleIds} |
| 중복 | ${report.integrity.duplicateSampleIds} |
| 예상 밖 ID | ${report.integrity.unexpectedSampleIds} |
| enum 위반 | ${report.normalization.enumViolations} |
| boundary 조합 위반 | ${report.normalization.boundaryTupleViolations} |
| 실제 정규화 | ${report.normalization.applied} |

## GPT 변경 제안

| 항목 | 건수 |
|---|---:|
| accept | ${report.gpt.decisions.accept ?? 0} |
| correct | ${report.gpt.decisions.correct ?? 0} |
| prompt 교체 | ${report.changes.redactedPrompt} |
| category/difficulty/semantic target/family/boundary/slice 변경 | ${report.changes.nonPromptLabelChanges} |
| 교체 후 length slice 불일치 | ${report.validation.postRewriteLengthSliceMismatches} |

800개 prompt 교체는 후보와 승인 diff에 반영했지만 원본에 자동 반영하지 않았다. 행 단위 검토 큐 밖의 교체도 최종 owner 승인 전까지 승인된 데이터가 아니다.

## Family 일관성

- family: ${report.family.families}개
- family당 record: ${report.family.recordsPerFamily}개
- category/semantic label/family manifest 충돌: ${report.family.issues}건
- partition 변경 또는 family 이동: ${report.family.partitionOrMembershipChanges}건
- simple/complex contrast pair 뒤집힘: ${report.validation.simpleComplexPairInversions}쌍

## 직접 검토 큐 ${report.humanReviewQueue.records}건의 선정 이유

아래 이유의 합집합만 \`${path.basename(HUMAN_QUEUE_PATH)}\`에 포함했다. 이유별 수는 서로 겹친다.

| 이유 | 건수 |
|---|---:|
${reasonRows}

| Category | 큐 건수 |
|---|---:|
${categoryRows}

- 큐 안에서 prompt diff가 있는 행: ${report.humanReviewQueue.withPromptChanges}건
- label 확인만 필요한 행: ${report.humanReviewQueue.withoutPromptChanges}건
- 큐 밖 자동 후보: ${report.humanReviewQueue.excludedRecords}건

## 승인 방법

1. 사람은 human review queue의 \`sourcePrompt\`, \`candidatePrompt\`, \`proposed\`, \`queueReasons\`만 확인한다.
2. 800개 문장 변경 전체의 최종 diff는 \`${path.basename(DIFF_PATH)}\`에서 일괄 승인 여부를 확인한다.
3. 승인 전에는 candidate를 기존 owner-approved 500건과 합치거나 학습 입력으로 승격하지 않는다.
4. 승인 결과를 별도 artifact로 남긴 뒤에만 \`human_review + approved\` 파생 dataset을 만든다.
5. GPT 검토 보조가 필요하면 \`direct-review-gpt/${path.basename(HUMAN_REVIEW_INSTRUCTIONS_PATH)}\`와 같은 폴더의 \`review-NN.input.jsonl\` 하나만 함께 전달한다. GPT 응답은 owner의 사람 승인으로 간주하지 않는다.

## 산출물

- \`${path.basename(RAW_PATH)}\`: ZIP 20개 batch의 canonical merge
- \`${path.basename(NORMALIZED_PATH)}\`: enum/boundary 정규화 결과와 normalization audit
- \`${path.basename(CANDIDATE_PATH)}\`: GPT prompt 교체를 적용한 2,000건 candidate
- \`${path.basename(DIFF_PATH)}\`: 800개 변경의 사람 승인용 before/after diff
- \`${path.basename(HUMAN_QUEUE_PATH)}\`: 지정 조건의 통합 직접 검토 큐
- \`direct-review-gpt/review-NN.input.jsonl\`: family-complete, 최대 80건의 GPT 전달용 큐
- \`direct-review-gpt/${path.basename(HUMAN_REVIEW_INSTRUCTIONS_PATH)}\`: GPT 2차 검토 명령문
- \`${path.basename(REPORT_JSON_PATH)}\`: 해시와 전체 통계
`;
}

export function buildReviewArtifacts({ rawText, sourceText, sourceManifestText }) {
  const rawRows = parseJsonl(rawText, "GPT adjudication");
  const sourceRecords = parseJsonl(sourceText, "source expansion dataset");
  const sourceManifest = JSON.parse(sourceManifestText);
  if (rawRows.length !== 2000 || sourceRecords.length !== 2000) {
    throw new Error(`expected 2,000 GPT rows and source records, got ${rawRows.length}/${sourceRecords.length}`);
  }

  const sourceIds = sourceRecords.map((record) => record.sampleId);
  const sourceIdSet = new Set(sourceIds);
  const sourceById = new Map(sourceRecords.map((record) => [record.sampleId, record]));
  const rawIdCounts = new Map();
  for (const row of rawRows) rawIdCounts.set(row.sampleId, (rawIdCounts.get(row.sampleId) ?? 0) + 1);
  const missing = sourceIds.filter((sampleId) => !rawIdCounts.has(sampleId));
  const duplicates = [...rawIdCounts].filter(([, count]) => count > 1);
  const unexpected = [...rawIdCounts.keys()].filter((sampleId) => !sourceIdSet.has(sampleId));
  if (missing.length || duplicates.length || unexpected.length) {
    throw new Error(
      `GPT sampleId mismatch: missing=${missing.length}, duplicates=${duplicates.length}, unexpected=${unexpected.length}`,
    );
  }

  const rawById = new Map(rawRows.map((row) => [row.sampleId, row]));
  const orderedRawRows = sourceIds.map((sampleId) => rawById.get(sampleId));
  const normalizedRows = orderedRawRows.map((row) => normalizeRow(row, sourceById.get(row.sampleId)));
  const candidateRecords = normalizedRows.map((row) => {
    const sourceRecord = sourceById.get(row.sampleId);
    return {
      ...sourceRecord,
      datasetVersion: CANDIDATE_DATASET_VERSION,
      redactedPrompt: selectPrompt(row, sourceRecord),
      ...Object.fromEntries(RETURNED_FIELDS.map((field) => [field, row[field]])),
    };
  });
  const candidateFailures = verifyDifficultyLabelRecords(candidateRecords);
  if (candidateFailures.length > 0) {
    throw new Error(`merged candidate failed canonical v2 validation:\n${candidateFailures.join("\n")}`);
  }

  const family = familyConsistency(candidateRecords, sourceManifest);
  const sourceFamilyById = new Map(
    sourceManifest.families.map((row) => [row.promptFamily, row]),
  );
  const diffs = normalizedRows.map((row, index) => {
    const sourceRecord = sourceRecords[index];
    const candidateRecord = candidateRecords[index];
    return {
      row,
      sourceRecord,
      candidateRecord,
      changes: changedFields(sourceRecord, row, candidateRecord),
    };
  });
  const changedDiffs = diffs.filter(({ changes }) => changes.length > 0);
  const diffRows = changedDiffs.map(({ row, sourceRecord, changes }) => ({
    schemaVersion: "gatelm.difficulty-expansion-human-approval-diff.v1",
    sampleId: row.sampleId,
    promptFamily: row.promptFamily,
    partition: sourceFamilyById.get(sourceRecord.promptFamily)?.partition ?? null,
    gptDecision: row.decision,
    gptConfidence: row.confidence,
    rationaleCodes: row.rationaleCodes,
    changes,
    humanApprovalStatus: "pending",
  }));
  const inversions = simpleComplexPairInversions(normalizedRows, sourceRecords);
  const inversionPairBySampleId = new Map();
  for (const pair of inversions.pairs) {
    inversionPairBySampleId.set(pair.simpleSampleId, pair);
    inversionPairBySampleId.set(pair.complexSampleId, pair);
  }
  const queued = diffs
    .map(({ row, sourceRecord, candidateRecord, changes }) => ({
      row,
      sourceRecord,
      candidateRecord,
      changes,
      reasons: queueReasons(
        row,
        changes,
        family.issueFamilies,
        inversions.sampleIds,
      ),
    }))
    .filter(({ reasons }) => reasons.length > 0);
  const queueRows = queued.map(({ row, sourceRecord, candidateRecord, changes, reasons }) => ({
    schemaVersion: "gatelm.difficulty-expansion-human-review-queue.v1",
    sampleId: row.sampleId,
    promptFamily: row.promptFamily,
    partition: sourceFamilyById.get(sourceRecord.promptFamily)?.partition ?? null,
    language: sourceRecord.language,
    queueReasons: reasons,
    sourcePrompt: sourceRecord.redactedPrompt,
    candidatePrompt: candidateRecord.redactedPrompt,
    promptChanged: changes.some((change) => change.field === "redactedPrompt"),
    sourceProposed: Object.fromEntries(
      RETURNED_FIELDS.map((field) => [field, sourceRecord[field]]),
    ),
    proposed: Object.fromEntries(RETURNED_FIELDS.map((field) => [field, row[field]])),
    gptDecision: row.decision,
    promptAction: row.promptAction,
    gptConfidence: row.confidence,
    rationaleCodes: row.rationaleCodes,
    normalizations: row.normalizations,
    simpleComplexInversionPair: inversionPairBySampleId.get(row.sampleId) ?? null,
    humanDecision: null,
    humanCorrections: null,
  }));
  const queueBatches = buildQueueBatches(queueRows);

  const canonicalRawText = canonicalJsonl(orderedRawRows);
  const normalizedText = canonicalJsonl(normalizedRows);
  const candidateText = canonicalJsonl(candidateRecords);
  const diffText = canonicalJsonl(diffRows);
  const queueText = canonicalJsonl(queueRows);
  const queueBatchFiles = Object.fromEntries(
    queueBatches.map((batch, index) => [
      `${HUMAN_QUEUE_BATCH_PREFIX}-${String(index + 1).padStart(2, "0")}.input.jsonl`,
      canonicalJsonl(batch),
    ]),
  );
  const allNormalizations = normalizedRows.flatMap((row) => row.normalizations);
  const nonPromptLabelChanges = changedDiffs.reduce(
    (sum, { changes }) => sum + changes.filter((change) => change.field !== "redactedPrompt").length,
    0,
  );
  const queueReasonCounts = countBy(queueRows.flatMap((row) => row.queueReasons), (value) => value);
  const familyMembershipChanges = normalizedRows.filter(
    (row, index) => row.promptFamily !== sourceRecords[index].promptFamily,
  ).length;
  const report = {
    schemaVersion: "gatelm.difficulty-expansion-gpt-review-report.v1",
    status: "gpt_merged_human_review_pending",
    createdAt: CREATED_AT,
    sourceDatasetVersion: sourceRecords[0].datasetVersion,
    candidateDatasetVersion: CANDIDATE_DATASET_VERSION,
    trainingEligible: false,
    humanReviewClaimed: false,
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
    sourceArchives: EXPECTED_ARCHIVES,
    integrity: {
      parsedRecords: orderedRawRows.length,
      uniqueSampleIds: rawIdCounts.size,
      missingSampleIds: missing.length,
      duplicateSampleIds: duplicates.length,
      unexpectedSampleIds: unexpected.length,
    },
    normalization: {
      enumViolations: 0,
      boundaryTupleViolations: 0,
      applied: allNormalizations.length,
      byField: countBy(allNormalizations, "field"),
    },
    gpt: {
      decisions: countBy(normalizedRows, "decision"),
      promptActions: countBy(normalizedRows, "promptAction"),
      confidence: {
        minimum: Math.min(...normalizedRows.map((row) => row.confidence)),
        maximum: Math.max(...normalizedRows.map((row) => row.confidence)),
        belowThreshold: normalizedRows.filter((row) => row.confidence < LOW_CONFIDENCE_THRESHOLD).length,
      },
    },
    changes: {
      changedRecords: changedDiffs.length,
      redactedPrompt: changedDiffs.filter(({ changes }) =>
        changes.some((change) => change.field === "redactedPrompt"),
      ).length,
      nonPromptLabelChanges,
      datasetVersionMetadataTransitions: candidateRecords.length,
    },
    validation: {
      canonicalRecordFailures: candidateFailures.length,
      postRewriteLengthSliceMismatches: 0,
      simpleComplexPairInversions: inversions.pairs.length,
      simpleComplexPairInversionDetails: inversions.pairs,
    },
    family: {
      families: family.candidateFamilies.size,
      recordsPerFamily: 10,
      issues: family.issues.length,
      issueDetails: family.issues,
      partitionOrMembershipChanges: familyMembershipChanges,
    },
    humanReviewQueue: {
      policy:
        "union(decision_correct,confidence<0.90,category_change,difficulty_change,bucket_change,family_change,prompt_action_replace,ambiguous_boundary,payload_only,family_conflict,simple_complex_pair_inversion,contract_normalization)",
      records: queueRows.length,
      excludedRecords: candidateRecords.length - queueRows.length,
      percentOfDataset: Number(((queueRows.length / candidateRecords.length) * 100).toFixed(1)),
      withPromptChanges: queueRows.filter((row) => row.promptChanged).length,
      withoutPromptChanges: queueRows.filter((row) => !row.promptChanged).length,
      byReason: queueReasonCounts,
      byCategory: countBy(queueRows, (row) => row.proposed.expectedCategory),
      byPartition: countBy(queueRows, "partition"),
      families: new Set(queueRows.map((row) => row.promptFamily)).size,
      batches: queueBatches.map((batch, index) => ({
        batch: index + 1,
        records: batch.length,
        families: new Set(batch.map((row) => row.promptFamily)).size,
        category: [...new Set(batch.map((row) => row.proposed.expectedCategory))].join("+"),
      })),
    },
    artifacts: {
      rawAdjudication: { path: RAW_PATH, records: orderedRawRows.length, sha256: sha256(canonicalRawText) },
      normalizedAdjudication: {
        path: NORMALIZED_PATH,
        records: normalizedRows.length,
        sha256: sha256(normalizedText),
      },
      mergedCandidate: { path: CANDIDATE_PATH, records: candidateRecords.length, sha256: sha256(candidateText) },
      humanApprovalDiff: { path: DIFF_PATH, records: diffRows.length, sha256: sha256(diffText) },
      humanReviewQueue: { path: HUMAN_QUEUE_PATH, records: queueRows.length, sha256: sha256(queueText) },
    },
  };
  const reportJsonText = `${JSON.stringify(report, null, 2)}\n`;
  const reportMarkdownText = markdownReport(report);
  return {
    rawRows: orderedRawRows,
    normalizedRows,
    candidateRecords,
    diffRows,
    queueRows,
    queueBatches,
    report,
    files: {
      [RAW_PATH]: canonicalRawText,
      [NORMALIZED_PATH]: normalizedText,
      [CANDIDATE_PATH]: candidateText,
      [DIFF_PATH]: diffText,
      [HUMAN_QUEUE_PATH]: queueText,
      ...queueBatchFiles,
      [HUMAN_REVIEW_INSTRUCTIONS_PATH]: humanReviewInstructions(),
      [REPORT_JSON_PATH]: reportJsonText,
      [REPORT_MARKDOWN_PATH]: reportMarkdownText,
    },
  };
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

function readZipEntries(archivePath) {
  const buffer = readFileSync(archivePath);
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`${archivePath}: invalid central directory entry ${index + 1}`);
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`${archivePath}: invalid local header for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (compressionMethod === 0) content = compressed;
    else if (compressionMethod === 8) content = inflateRawSync(compressed);
    else throw new Error(`${archivePath}: unsupported ZIP compression method ${compressionMethod}`);
    if (content.length !== uncompressedSize) {
      throw new Error(`${archivePath}: uncompressed size mismatch for ${name}`);
    }
    entries.push({ name, content });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return { buffer, entries };
}

function batchNumber(name) {
  const match = name.match(/batch-(\d{2})\.output\.jsonl$/u);
  if (!match) throw new Error(`cannot identify GPT batch number from ${name}`);
  return Number(match[1]);
}

function rawTextFromArchives(archivePaths) {
  if (archivePaths.length !== EXPECTED_ARCHIVES.length) {
    throw new Error(`expected ${EXPECTED_ARCHIVES.length} --archive arguments`);
  }
  const rows = [];
  const batches = [];
  for (const archivePath of archivePaths) {
    const expected = EXPECTED_ARCHIVES.find((item) => item.name === path.basename(archivePath));
    if (!expected) throw new Error(`unexpected archive ${path.basename(archivePath)}`);
    const { buffer, entries } = readZipEntries(archivePath);
    const actualHash = sha256(buffer);
    if (actualHash !== expected.sha256) {
      throw new Error(`${archivePath}: SHA-256 mismatch; expected ${expected.sha256}, got ${actualHash}`);
    }
    const jsonlEntries = entries.filter((entry) => entry.name.endsWith(".jsonl"));
    const actualBatches = jsonlEntries.map((entry) => batchNumber(entry.name)).sort((left, right) => left - right);
    if (!same(actualBatches, expected.batches)) {
      throw new Error(`${archivePath}: batch membership does not match expected evidence`);
    }
    for (const entry of jsonlEntries) {
      const batch = batchNumber(entry.name);
      const entryRows = parseJsonl(entry.content.toString("utf8"), `${archivePath}:${entry.name}`);
      if (entryRows.length !== 100) throw new Error(`${entry.name}: expected 100 rows, got ${entryRows.length}`);
      rows.push(...entryRows);
      batches.push(batch);
    }
  }
  const orderedBatches = [...batches].sort((left, right) => left - right);
  if (!same(orderedBatches, Array.from({ length: 20 }, (_, index) => index + 1))) {
    throw new Error("archives must cover GPT batches 01 through 20 exactly once");
  }
  return canonicalJsonl(rows);
}

function argumentValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1]);
  }
  return values;
}

function writeOrCheck(files, check) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.resolve(relativePath);
    if (check) {
      if (readFileSync(absolutePath, "utf8") !== content) {
        throw new Error(`generated GPT review artifact is stale: ${relativePath}`);
      }
      continue;
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
}

function main() {
  const check = process.argv.includes("--check");
  const archivePaths = argumentValues("--archive");
  if (check && archivePaths.length > 0) throw new Error("--check cannot be combined with --archive");
  const rawText =
    archivePaths.length > 0
      ? rawTextFromArchives(archivePaths)
      : readFileSync(path.resolve(RAW_PATH), "utf8");
  const result = buildReviewArtifacts({
    rawText,
    sourceText: readFileSync(path.resolve(SOURCE_DATASET_PATH), "utf8"),
    sourceManifestText: readFileSync(path.resolve(SOURCE_MANIFEST_PATH), "utf8"),
  });
  writeOrCheck(result.files, check);
  console.log(`${check ? "verified" : "merged"} ${result.report.integrity.parsedRecords} GPT rows`);
  console.log(`prompt change candidates: ${result.report.changes.redactedPrompt}`);
  console.log(`human review queue: ${result.report.humanReviewQueue.records}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
