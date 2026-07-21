import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATASET_PATH = path.resolve(
  "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.jsonl",
);
const DEFAULT_OUTPUT_ROOT = path.resolve(
  ".tmp/routing-difficulty-independent-review/reviewer-e-gpt-risk-sensitive-7974",
);
const DEFAULT_PRIVATE_MANIFEST_PATH = path.resolve(
  ".tmp/routing-difficulty-independent-review/private-do-not-send/reviewer-e-gpt-risk-sensitive-7974-provenance.json",
);
const EXPECTED_RECORDS = 7_974;
const EXPECTED_FALSE_SIMPLE_RISK = 6_697;
const EXPECTED_FALSE_COMPLEX_RISK = 1_277;
const MAX_RECORDS_PER_BATCH = 50;
const MAX_PROMPT_CHARACTERS_PER_BATCH = 45_000;
const INPUT_SCHEMA_VERSION = "gatelm.routing-difficulty-risk-sensitive-review-input.v1";
const RESULT_SCHEMA_VERSION = "gatelm.routing-difficulty-risk-sensitive-review-result.v1";
const ORDER_SALT = "gatelm-reviewer-e-risk-sensitive-order-v1";

const REASON_CODES = Object.freeze([
  "clearly_bounded_direct_task",
  "mechanical_transformation",
  "direct_lookup_or_explanation",
  "dependent_multistep_reasoning",
  "multi_source_or_context_integration",
  "constraint_or_tradeoff_analysis",
  "specialized_judgment_required",
  "multiple_tools_or_interpreted_evidence",
  "iterative_verification_or_falsification",
  "short_but_complex",
  "long_but_simple",
  "language_not_decisive",
  "technical_terms_not_decisive",
  "math_or_research_but_direct",
  "structured_or_general_but_complex",
  "ambiguity_defaults_to_complex",
  "missing_context_defaults_to_complex",
  "unsafe_or_unreadable_defaults_to_complex",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonl(text, name) {
  return text.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${name}:${index + 1}: ${error.message}`);
    }
  });
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function parseArguments(argv) {
  let outputRoot = DEFAULT_OUTPUT_ROOT;
  let privateManifestPath = DEFAULT_PRIVATE_MANIFEST_PATH;
  let checkOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      checkOnly = true;
      continue;
    }
    if (["--output-root", "--private-manifest"].includes(argument)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`${argument} requires a path`);
      if (argument === "--output-root") outputRoot = path.resolve(next);
      else privateManifestPath = path.resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  return { outputRoot, privateManifestPath, checkOnly };
}

export function selectionReasons(record) {
  const reasons = [];
  if (record.label === "simple") {
    if (["structured_data_processing", "general_query"].includes(record.task_type)) reasons.push("simple_in_undercomplex_task_slice");
    if (["en", "mixed"].includes(record.language)) reasons.push("simple_in_undercomplex_language_slice");
    if (record.length_bucket === "short") reasons.push("simple_in_short_slice");
  }
  if (record.label === "complex") {
    if (record.task_type === "math_problem") reasons.push("complex_in_math_slice");
    if (record.service_domain === "research") reasons.push("complex_in_research_slice");
  }
  return reasons;
}

function opaqueId(prefix, salt, value) {
  return `${prefix}_${sha256(`${salt}|${value}`).slice(0, 24)}`;
}

function makeRows(records) {
  return records
    .map((record) => ({
      record,
      reasons: selectionReasons(record),
      item_id: opaqueId("re", "reviewer-e-item", record.sample_id),
      review_group_id: opaqueId("reg", "reviewer-e-group", record.group_id),
    }))
    .filter((row) => row.reasons.length > 0);
}

function orderGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const current = groups.get(row.review_group_id) ?? [];
    current.push(row);
    groups.set(row.review_group_id, current);
  }
  return [...groups.entries()]
    .map(([reviewGroupId, records]) => ({
      reviewGroupId,
      records: records.sort((left, right) => left.item_id.localeCompare(right.item_id, "en")),
      promptCharacters: records.reduce((total, row) => total + [...row.record.redacted_prompt].length, 0),
    }))
    .sort((left, right) => sha256(`${ORDER_SALT}|${left.reviewGroupId}`).localeCompare(sha256(`${ORDER_SALT}|${right.reviewGroupId}`), "en"));
}

function makeBatches(groups) {
  const batches = [];
  let current = [];
  let records = 0;
  let promptCharacters = 0;
  const flush = () => {
    if (!current.length) return;
    batches.push({ groups: current, records, promptCharacters });
    current = [];
    records = 0;
    promptCharacters = 0;
  };
  for (const group of groups) {
    if (group.records.length > MAX_RECORDS_PER_BATCH || group.promptCharacters > MAX_PROMPT_CHARACTERS_PER_BATCH) {
      throw new Error(`${group.reviewGroupId}: review group exceeds one batch`);
    }
    if (current.length && (records + group.records.length > MAX_RECORDS_PER_BATCH
      || promptCharacters + group.promptCharacters > MAX_PROMPT_CHARACTERS_PER_BATCH)) flush();
    current.push(group);
    records += group.records.length;
    promptCharacters += group.promptCharacters;
  }
  flush();
  return batches;
}

export function buildOutputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://gatelm.local/routing/difficulty/reviewer-e-risk-sensitive-result.schema.json",
    title: "GateLM risk-sensitive difficulty review result - Reviewer E",
    type: "object",
    additionalProperties: false,
    properties: {
      schema_version: { const: RESULT_SCHEMA_VERSION },
      reviewer_id: { const: "E" },
      batch_id: { type: "string", pattern: "^E-[0-9]{4}$" },
      item_id: { type: "string", pattern: "^re_[a-f0-9]{24}$" },
      axis_decisions: {
        type: "object",
        additionalProperties: false,
        properties: {
          reasoning_level: { enum: ["direct_or_mechanical", "limited_local", "multi_step_analysis"] },
          task_dependency: { enum: ["single_or_independent", "dependent_two_step", "dependent_multi_step"] },
          constraint_tradeoff: { enum: ["none_or_mechanical", "moderate", "high"] },
          expert_judgment: { enum: ["none_or_standard", "specialized_but_mechanical", "specialized_judgment"] },
          context_integration: { enum: ["single_or_local", "long_but_direct", "multiple_sources_integrated"] },
          tool_external_evidence: { enum: ["none", "single_simple_tool", "multiple_tools_or_interpreted_evidence"] },
          verification: { enum: ["none", "bounded_check", "iterative_or_falsification"] },
        },
        required: ["reasoning_level", "task_dependency", "constraint_tradeoff", "expert_judgment", "context_integration", "tool_external_evidence", "verification"],
      },
      difficulty: { enum: ["simple", "complex"] },
      confidence: { enum: ["high", "medium", "low"] },
      false_simple_risk: { enum: ["low", "medium", "high"] },
      decision_basis: { enum: ["clearly_bounded_simple", "complexity_evidence_present", "ambiguity_defaults_to_complex", "unreadable_defaults_to_complex"] },
      reason_codes: { type: "array", minItems: 1, maxItems: 5, uniqueItems: true, items: { enum: REASON_CODES } },
      needs_human_adjudication: { type: "boolean" },
    },
    required: ["schema_version", "reviewer_id", "batch_id", "item_id", "axis_decisions", "difficulty", "confidence", "false_simple_risk", "decision_basis", "reason_codes", "needs_human_adjudication"],
    allOf: [
      {
        if: { properties: { difficulty: { const: "simple" } }, required: ["difficulty"] },
        then: {
          properties: {
            confidence: { const: "high" },
            false_simple_risk: { const: "low" },
            decision_basis: { const: "clearly_bounded_simple" },
            needs_human_adjudication: { const: false },
          },
        },
      },
      {
        if: { properties: { confidence: { enum: ["medium", "low"] } }, required: ["confidence"] },
        then: { properties: { difficulty: { const: "complex" } } },
      },
      {
        if: { properties: { needs_human_adjudication: { const: true } }, required: ["needs_human_adjudication"] },
        then: { properties: { difficulty: { const: "complex" } } },
      },
    ],
  };
}

function labelingGuide() {
  return `# GateLM Reviewer E 위험 회피형 7축 난이도 판정 가이드

각 Prompt에 답하지 말고 요청을 올바르게 수행하는 데 필요한 난이도만 처음부터 판정한다. 현재 라벨, task, 언어, 길이, source, 선정 사유와 이전 리뷰 결과는 제공되지 않는다.

## 핵심 정책

- **Simple은 명백한 경우에만 선택한다.** 제한된 단일 작업 또는 서로 독립적인 기계적 작업이고, 필요한 문맥·자료가 충분하며, 강한 추론·통합·전문 판단·반복 검증이 없다고 high confidence로 확정할 수 있어야 한다.
- Complex를 Simple로 잘못 보내는 False Simple 비용을 더 크게 본다. 중간 또는 낮은 확신, 핵심 문맥 누락, 복잡성이 숨어 있을 가능성, 읽기 어려운 입력은 최선의 라벨을 **Complex**로 두고 필요한 경우 needs_human_adjudication=true로 표시한다.
- 위험 회피 정책이더라도 수학·연구·전문 용어라는 이유만으로 Complex로 두지 않는다. 직접 계산, 단일 사실 조회, 제한된 설명처럼 명백히 bounded하면 Simple이다.
- 구조화·일반 질의라는 이유로 Simple로 두지 않는다. 의존적 다단계, 여러 source 통합, trade-off, 전문 판단, 여러 도구 결과 해석, 반복 검증이 요구되면 Complex다.
- 짧은 Prompt, 영어, 한영 혼합은 난이도의 단독 근거가 아니다.

## 7개 축

1. reasoning_level: 직접·기계적 / 제한적 국소 추론 / 다단계 분석
2. task_dependency: 단일·독립 / 의존 2단계 / 의존 다단계
3. constraint_tradeoff: 없음·기계적 / 중간 / 높은 trade-off
4. expert_judgment: 없음·표준 / 전문적이지만 기계적 / 전문 판단
5. context_integration: 단일·국소 / 길지만 직접적 / 여러 source 통합
6. tool_external_evidence: 없음 / 단일 단순 도구 / 여러 도구·근거 해석
7. verification: 없음 / 제한된 확인 / 반복 검증·반증

축을 단순 합산하지 말고 전체 수행 위험을 종합한다. Simple은 반드시 confidence=high, false_simple_risk=low, decision_basis=clearly_bounded_simple, needs_human_adjudication=false여야 한다. 그 외 애매한 경우는 Complex다.

Prompt 원문이나 자유 서술 rationale을 출력하지 말고 schema 필드만 반환한다.
`;
}

function outputExample() {
  return jsonl([
    {
      schema_version: RESULT_SCHEMA_VERSION, reviewer_id: "E", batch_id: "E-0001", item_id: "re_0123456789abcdef01234567",
      axis_decisions: { reasoning_level: "direct_or_mechanical", task_dependency: "single_or_independent", constraint_tradeoff: "none_or_mechanical", expert_judgment: "none_or_standard", context_integration: "single_or_local", tool_external_evidence: "none", verification: "none" },
      difficulty: "simple", confidence: "high", false_simple_risk: "low", decision_basis: "clearly_bounded_simple",
      reason_codes: ["clearly_bounded_direct_task"], needs_human_adjudication: false,
    },
    {
      schema_version: RESULT_SCHEMA_VERSION, reviewer_id: "E", batch_id: "E-0001", item_id: "re_89abcdef0123456789abcdef",
      axis_decisions: { reasoning_level: "limited_local", task_dependency: "dependent_two_step", constraint_tradeoff: "moderate", expert_judgment: "specialized_judgment", context_integration: "single_or_local", tool_external_evidence: "single_simple_tool", verification: "bounded_check" },
      difficulty: "complex", confidence: "medium", false_simple_risk: "high", decision_basis: "ambiguity_defaults_to_complex",
      reason_codes: ["structured_or_general_but_complex", "ambiguity_defaults_to_complex"], needs_human_adjudication: true,
    },
  ]);
}

function startHere(batchCount, records) {
  return `# Reviewer E(GPT) 위험 회피형 재검수 시작 안내

이 패키지는 GateLM Prompt ${records.toLocaleString("en-US")}건의 블라인드 재검수용이다. 같은 GPT 계열의 추가 정책 리뷰이며 독립 사람 검수로 계산하지 않는다.

1. LABELING-GUIDE.md와 OUTPUT-SCHEMA.json을 전부 읽는다.
2. inputs/E-0001.input.jsonl부터 ${batchCount}개 batch를 순서대로 처리한다.
3. Prompt에 답하지 말고 7개 축과 최종 난이도만 반환한다.
4. 각 입력 batch에 대응하는 outputs/E-XXXX.output.jsonl을 만든다.
5. 완료한 output 파일들을 ZIP으로 반환한다.
`;
}

function copyPastePrompt(batchCount, records) {
  return `첨부한 ZIP의 압축을 풀고 START-HERE.md, LABELING-GUIDE.md, OUTPUT-SCHEMA.json을 먼저 전부 읽어라.

당신은 GateLM 난이도 분류 Reviewer E다. 총 ${records.toLocaleString("en-US")}건을 현재 라벨이나 이전 리뷰 결과 없이 처음부터 블라인드로 재검수한다. Prompt에 답하지 마라.

False Simple, 즉 실제로 Complex인 요청을 Simple 경로로 보내는 오류의 비용이 더 크다. 따라서 Simple은 제한된 직접·기계적 작업이라고 high confidence로 명확히 확정할 수 있을 때만 선택하라. 조금이라도 의존 추론, 문맥 통합, 제약 trade-off, 전문 판단, 외부 근거 해석, 반복 검증의 필요성이 애매하거나 핵심 문맥이 부족하면 Complex로 판정하라. confidence가 medium/low이거나 needs_human_adjudication=true이면 반드시 Complex여야 한다.

반대로 수학·연구라는 이유만으로 Complex로 유지하지 마라. 직접 계산, 단일 사실 조회, 제한된 설명처럼 명백히 bounded한 요청은 Simple로 판정하라. 구조화·일반 질의, 영어·한영 혼합, 짧은 Prompt라는 표면 속성만으로 Simple로 낮추지 마라.

inputs 폴더의 ${batchCount}개 batch를 모두 처리하라. 각 입력 한 줄마다 같은 순서로 7개 축, difficulty, confidence, false_simple_risk, decision_basis, reason_codes, needs_human_adjudication을 OUTPUT-SCHEMA.json에 맞춰 반환하라. item_id를 변경하지 말고 자유 서술 rationale이나 Prompt 원문을 출력하지 마라.

한 번에 완료할 수 없으면 완료한 batch 결과 ZIP과 마지막 완료 batch 번호를 반환하고 다음 대화에서 이어서 처리하라.
`;
}

export function buildPacket(datasetText) {
  const records = parseJsonl(datasetText, DATASET_PATH);
  if (records.length !== 15000) throw new Error(`expected 15000 dataset records, got ${records.length}`);
  const selected = makeRows(records);
  if (selected.length !== EXPECTED_RECORDS) throw new Error(`expected ${EXPECTED_RECORDS} selected records, got ${selected.length}`);
  const falseSimpleRisk = selected.filter((row) => row.record.label === "simple").length;
  const falseComplexRisk = selected.filter((row) => row.record.label === "complex").length;
  if (falseSimpleRisk !== EXPECTED_FALSE_SIMPLE_RISK || falseComplexRisk !== EXPECTED_FALSE_COMPLEX_RISK) throw new Error("risk-direction counts changed");
  if (new Set(selected.map((row) => row.item_id)).size !== selected.length) throw new Error("opaque item_id collision");

  const groups = orderGroups(selected);
  const batches = makeBatches(groups);
  const files = new Map();
  const batchIndex = [];
  const orderedItemIds = [];
  for (const [index, batch] of batches.entries()) {
    const batchId = `E-${String(index + 1).padStart(4, "0")}`;
    const rows = batch.groups.flatMap((group) => group.records.map((row) => {
      orderedItemIds.push(row.item_id);
      return { schema_version: INPUT_SCHEMA_VERSION, reviewer_id: "E", batch_id: batchId, item_id: row.item_id, review_group_id: row.review_group_id, prompt: row.record.redacted_prompt };
    }));
    const contents = jsonl(rows);
    const fileName = `${batchId}.input.jsonl`;
    files.set(path.join("inputs", fileName), contents);
    batchIndex.push({ batch_id: batchId, input_file: `inputs/${fileName}`, expected_output_file: `outputs/${batchId}.output.jsonl`, records: rows.length, groups: batch.groups.length, prompt_characters: batch.promptCharacters, input_sha256: sha256(contents) });
  }

  const reviewSetSha256 = sha256(`${selected.map((row) => row.item_id).sort().join("\n")}\n`);
  const manifest = {
    schema_version: "gatelm.routing-difficulty-risk-sensitive-review-packet-manifest.v1",
    review_mode: "blind_risk_sensitive_seven_axis_review",
    reviewer: { id: "E", intended_model_family: "GPT", independent_reviewer_credit: false },
    records: selected.length,
    groups: groups.length,
    batches: batches.length,
    dataset_path: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.jsonl",
    dataset_sha256: sha256(datasetText),
    review_set_sha256: reviewSetSha256,
    reviewer_order_sha256: sha256(`${orderedItemIds.join("\n")}\n`),
    batching: { group_atomic: true, max_records_per_batch: MAX_RECORDS_PER_BATCH, max_prompt_characters_per_batch: MAX_PROMPT_CHARACTERS_PER_BATCH },
    required_axis_count: 7,
    asymmetric_false_simple_policy: true,
    candidate_labels_included: false,
    prior_reviewer_results_included: false,
    per_item_selection_reasons_included: false,
    original_ids_included: false,
    human_approval_status: "pending",
    training_eligible: false,
    batch_index: batchIndex,
  };
  const privateManifest = {
    schema_version: "gatelm.routing-difficulty-reviewer-e-private-provenance.v1",
    reviewer_role: "same_model_family_risk_sensitive_policy_review",
    independent_reviewer_credit: false,
    dataset_sha256: sha256(datasetText),
    review_set_sha256: reviewSetSha256,
    records: selected.length,
    selection_counts: { false_simple_risk: falseSimpleRisk, false_complex_risk: falseComplexRisk },
    mapping: selected.map((row) => ({ item_id: row.item_id, review_group_id: row.review_group_id, sample_id: row.record.sample_id, group_id: row.record.group_id, current_label: row.record.label, selection_reasons: row.reasons, task_type: row.record.task_type, service_domain: row.record.service_domain, language: row.record.language, length_bucket: row.record.length_bucket, source: row.record.source, split: row.record.split })),
  };

  files.set("START-HERE.md", startHere(batches.length, selected.length));
  files.set("COPY-PASTE-PROMPT.txt", copyPastePrompt(batches.length, selected.length));
  files.set("LABELING-GUIDE.md", labelingGuide());
  files.set("OUTPUT-SCHEMA.json", `${JSON.stringify(buildOutputSchema(), null, 2)}\n`);
  files.set("OUTPUT-EXAMPLE.jsonl", outputExample());
  files.set("PACKET-MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`);
  files.set("outputs/PUT-RESULT-FILES-HERE.txt", "각 batch의 JSONL 결과 파일을 이 폴더에 저장하세요.\n");
  return { files, manifest, privateManifest };
}

function writeOrCheck(filePath, contents, checkOnly) {
  if (checkOnly) {
    let actual;
    try {
      actual = readFileSync(filePath, "utf8");
    } catch {
      throw new Error(`missing Reviewer E packet file: ${filePath}`);
    }
    if (actual !== contents) throw new Error(`stale Reviewer E packet file: ${filePath}`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const datasetText = readFileSync(DATASET_PATH, "utf8");
  const packet = buildPacket(datasetText);
  if (options.checkOnly && !statSync(options.outputRoot).isDirectory()) throw new Error(`missing Reviewer E packet directory: ${options.outputRoot}`);
  for (const [relativePath, contents] of packet.files) writeOrCheck(path.join(options.outputRoot, relativePath), contents, options.checkOnly);
  writeOrCheck(options.privateManifestPath, `${JSON.stringify(packet.privateManifest, null, 2)}\n`, options.checkOnly);
  console.log(`${options.checkOnly ? "verified" : "wrote"} Reviewer E packet: ${packet.manifest.records} items, ${packet.manifest.batches} batches, risk-sensitive policy; independent reviewer credit remains false`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
