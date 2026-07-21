import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildArtifacts } from "./generate-independent-review-packets.mjs";
import { buildTargetedPacket } from "./generate-gemini-targeted-review-packet.mjs";

const DATASET_PATH = path.resolve(
  "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.jsonl",
);
const REVIEWER_B_RESULTS_PATH = path.resolve(
  "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-b-gpt/reviewer-b-results.normalized.jsonl",
);
const REVIEWER_B_MANIFEST_PATH = path.resolve(
  "docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-b-gpt/reviewer-b-import-manifest.json",
);
const DEFAULT_OUTPUT_ROOT = path.resolve(
  ".tmp/routing-difficulty-independent-review/reviewer-c-gpt-deep-review-3650",
);
const DEFAULT_PRIVATE_MANIFEST_PATH = path.resolve(
  ".tmp/routing-difficulty-independent-review/private-do-not-send/gpt-reviewer-c-deep-review-3650-provenance.json",
);
const EXPECTED_RECORDS = 3_650;
const MAX_RECORDS_PER_BATCH = 50;
const MAX_PROMPT_CHARACTERS_PER_BATCH = 45_000;
const INPUT_SCHEMA_VERSION =
  "gatelm.routing-difficulty-axis-review-input.v1";
const RESULT_SCHEMA_VERSION =
  "gatelm.routing-difficulty-axis-review-result.v1";
const ORDER_SALT = "gatelm-reviewer-c-gpt-deep-review-order-v1";
const REASON_CODES = [
  "single_bounded_task",
  "mechanical_transformation",
  "direct_retrieval_or_explanation",
  "limited_local_reasoning",
  "dependent_multistep_workflow",
  "multi_source_or_context_synthesis",
  "expert_analysis_or_tradeoff",
  "verification_or_falsification",
  "multi_tool_or_external_evidence",
  "state_concurrency_or_system_reasoning",
  "multiple_dependent_deliverables",
  "long_but_simple",
  "short_but_complex",
  "technical_terms_not_decisive",
  "language_not_decisive",
  "ambiguous_or_missing_context",
  "unsafe_or_unreadable_input",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function readJsonlText(text, label) {
  return text
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}:${index + 1}: ${error.message}`);
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

function orderAndGroup(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.review_group_id) ?? [];
    group.push(row);
    groups.set(row.review_group_id, group);
  }
  return [...groups.entries()]
    .map(([reviewGroupId, records]) => ({
      reviewGroupId,
      records: records.sort((left, right) =>
        left.item_id.localeCompare(right.item_id, "en"),
      ),
      promptCharacters: records.reduce(
        (total, row) => total + row.prompt.length,
        0,
      ),
    }))
    .sort((left, right) =>
      sha256(`${ORDER_SALT}|${left.reviewGroupId}`).localeCompare(
        sha256(`${ORDER_SALT}|${right.reviewGroupId}`),
        "en",
      ),
    );
}

function makeBatches(groups) {
  const batches = [];
  let currentGroups = [];
  let currentRecords = 0;
  let currentCharacters = 0;
  const flush = () => {
    if (currentGroups.length === 0) return;
    batches.push({
      groups: currentGroups,
      records: currentRecords,
      promptCharacters: currentCharacters,
    });
    currentGroups = [];
    currentRecords = 0;
    currentCharacters = 0;
  };
  for (const group of groups) {
    if (
      currentGroups.length > 0 &&
      (currentRecords + group.records.length > MAX_RECORDS_PER_BATCH ||
        currentCharacters + group.promptCharacters >
          MAX_PROMPT_CHARACTERS_PER_BATCH)
    ) {
      flush();
    }
    currentGroups.push(group);
    currentRecords += group.records.length;
    currentCharacters += group.promptCharacters;
  }
  flush();
  return batches;
}

export function buildOutputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://gatelm.local/routing/difficulty/reviewer-c-axis-result.schema.json",
    title: "GateLM structured difficulty axis review result - Reviewer C",
    type: "object",
    additionalProperties: false,
    properties: {
      schema_version: { const: RESULT_SCHEMA_VERSION },
      reviewer_id: { const: "C" },
      batch_id: { type: "string", pattern: "^C-[0-9]{4}$" },
      item_id: { type: "string", pattern: "^ri_[a-f0-9]{24}$" },
      axis_decisions: {
        type: "object",
        additionalProperties: false,
        properties: {
          reasoning_level: {
            enum: ["direct_or_mechanical", "limited_local", "multi_step_analysis"],
          },
          task_dependency: {
            enum: ["single_or_independent", "dependent_two_step", "dependent_multi_step"],
          },
          constraint_tradeoff: {
            enum: ["none_or_mechanical", "moderate", "high"],
          },
          expert_judgment: {
            enum: ["none_or_standard", "specialized_but_mechanical", "specialized_judgment"],
          },
          context_integration: {
            enum: ["single_or_local", "long_but_direct", "multiple_sources_integrated"],
          },
          tool_external_evidence: {
            enum: ["none", "single_simple_tool", "multiple_tools_or_interpreted_evidence"],
          },
          verification: {
            enum: ["none", "bounded_check", "iterative_or_falsification"],
          },
        },
        required: [
          "reasoning_level",
          "task_dependency",
          "constraint_tradeoff",
          "expert_judgment",
          "context_integration",
          "tool_external_evidence",
          "verification",
        ],
      },
      difficulty: { enum: ["simple", "complex"] },
      confidence: { enum: ["high", "medium", "low"] },
      reason_codes: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        uniqueItems: true,
        items: { enum: REASON_CODES },
      },
      needs_human_adjudication: { type: "boolean" },
    },
    required: [
      "schema_version",
      "reviewer_id",
      "batch_id",
      "item_id",
      "axis_decisions",
      "difficulty",
      "confidence",
      "reason_codes",
      "needs_human_adjudication",
    ],
  };
}

function labelingGuide() {
  return `# GateLM Reviewer C 구조화 난이도 판정 가이드

당신은 Reviewer C다. 각 사용자 Prompt에 답하거나 문제를 풀지 말고, 요청을 제대로 수행하는 데 필요한 **작업 난이도**를 새로 판정한다. 현재 후보 라벨이나 다른 리뷰어 결과는 제공되지 않으며 이를 추측하거나 요청하면 안 된다.

## 표면 신호 금지

- 길이 자체는 난이도가 아니다. 긴 입력의 직접 번역·요약·형식 변환은 Simple일 수 있다.
- 짧은 입력도 증명, 원인 분석, 의존적 설계·검증이 필요하면 Complex일 수 있다.
- 영어·한영 혼합이라는 이유만으로 Complex 또는 Simple로 분류하지 않는다.
- 코드, 전문 용어, 보안·법률·의학 용어가 있다는 사실만으로 Complex가 되지 않는다.
- 작업 수가 여러 개여도 서로 독립적인 기계적 변환이면 Simple일 수 있다.
- 도구 하나로 끝나는 단순 조회는 Simple일 수 있다.

## 7개 축을 먼저 각각 판정한다

### 1. reasoning_level

- \`direct_or_mechanical\`: 조회·복사·번역·요약·형식 변환처럼 직접 수행
- \`limited_local\`: 제한된 범위의 국소 추론 또는 간단한 비교
- \`multi_step_analysis\`: 여러 추론 단계, 원인 분석, 증명, 의사결정

### 2. task_dependency

- \`single_or_independent\`: 단일 작업 또는 서로 독립적인 작업
- \`dependent_two_step\`: 첫 결과를 다음 단계가 사용하는 2단계
- \`dependent_multi_step\`: 세 단계 이상이 의존적으로 연결

### 3. constraint_tradeoff

- \`none_or_mechanical\`: 제약이 없거나 기계적으로 동시에 충족 가능
- \`moderate\`: 여러 제약을 조정해야 하지만 판단 부담이 제한적
- \`high\`: 충돌하는 조건·위험·비용 사이의 전문적 trade-off

### 4. expert_judgment

- \`none_or_standard\`: 일반 지식 또는 표준적 처리
- \`specialized_but_mechanical\`: 전문 용어는 있지만 작업은 직접적
- \`specialized_judgment\`: 분야 지식을 적용한 분석·판단·위험 평가

### 5. context_integration

- \`single_or_local\`: 짧거나 단일 문맥만 사용
- \`long_but_direct\`: 길지만 직접 변환하며 복합 통합은 없음
- \`multiple_sources_integrated\`: 여러 문서·근거·정보 조각을 실질적으로 통합

### 6. tool_external_evidence

- \`none\`: 외부 도구나 최신 근거 불필요
- \`single_simple_tool\`: 단일 검색·도구 결과를 직접 사용
- \`multiple_tools_or_interpreted_evidence\`: 여러 도구·자료를 연속 사용하고 해석

### 7. verification

- \`none\`: 별도 검증 불필요
- \`bounded_check\`: 한 번의 간단한 확인·검산
- \`iterative_or_falsification\`: 테스트·재현·반증·수정 전후 반복 검증

## 최종 difficulty

### Simple

전체적으로 한 번의 제한된 작업으로 안정적으로 수행할 수 있고, 강한 의존적 추론·통합·trade-off·반복 검증이 필요하지 않은 요청이다.

### Complex

의존적 다단계 수행, 다중 자료 통합, 전문적 trade-off, 여러 도구 결과 해석, 반복 검증 중 하나 이상이 강하게 요구되는 요청이다.

축의 값을 단순 점수 합산하지 말고 전체 요청을 종합한다. 전문 용어만 많은 직접 변환과 긴 문맥의 단순 요약을 Complex로 올리지 않는다. 반대로 짧은 인과 분석·증명·경쟁 상태 재현 및 수정 검증을 Simple로 낮추지 않는다.

## 결과 규칙

- 반드시 7개 축을 모두 채운다.
- 반드시 \`simple | complex\` 중 하나를 선택한다.
- 확신이 낮거나 핵심 자료가 누락·손상됐으면 최선의 라벨을 반환하면서 \`needs_human_adjudication=true\`로 둔다.
- 장문 사고 과정, 자유 서술 rationale, Prompt 원문 또는 일부 문장을 결과에 넣지 않는다.
- 입력과 같은 순서로 한 줄당 JSON 객체 하나만 반환한다.
`;
}

function outputExample() {
  return jsonl([
    {
      schema_version: RESULT_SCHEMA_VERSION,
      reviewer_id: "C",
      batch_id: "C-0001",
      item_id: "ri_0123456789abcdef01234567",
      axis_decisions: {
        reasoning_level: "direct_or_mechanical",
        task_dependency: "single_or_independent",
        constraint_tradeoff: "none_or_mechanical",
        expert_judgment: "specialized_but_mechanical",
        context_integration: "long_but_direct",
        tool_external_evidence: "none",
        verification: "none",
      },
      difficulty: "simple",
      confidence: "high",
      reason_codes: ["long_but_simple", "technical_terms_not_decisive"],
      needs_human_adjudication: false,
    },
    {
      schema_version: RESULT_SCHEMA_VERSION,
      reviewer_id: "C",
      batch_id: "C-0001",
      item_id: "ri_89abcdef0123456789abcdef",
      axis_decisions: {
        reasoning_level: "multi_step_analysis",
        task_dependency: "dependent_multi_step",
        constraint_tradeoff: "moderate",
        expert_judgment: "specialized_judgment",
        context_integration: "single_or_local",
        tool_external_evidence: "single_simple_tool",
        verification: "iterative_or_falsification",
      },
      difficulty: "complex",
      confidence: "high",
      reason_codes: ["short_but_complex", "verification_or_falsification"],
      needs_human_adjudication: false,
    },
  ]);
}

function startHere(batchCount) {
  return `# Reviewer C(GPT) 구조화 정밀 검토 시작 안내

이 패키지는 GateLM Prompt ${EXPECTED_RECORDS.toLocaleString("en-US")}건의 블라인드 구조화 난이도 검토용이다.

1. \`LABELING-GUIDE.md\`를 전부 읽는다.
2. \`OUTPUT-SCHEMA.json\`을 전부 읽는다.
3. \`inputs/C-0001.input.jsonl\`부터 ${batchCount}개 batch를 순서대로 처리한다.
4. 각 입력 한 줄마다 7개 축, difficulty, confidence, reason_codes, needs_human_adjudication을 반환한다.
5. 결과는 \`outputs/C-0001.output.jsonl\` 형식으로 만들고 모두 ZIP으로 반환한다.

채팅창에 보낼 명령은 \`COPY-PASTE-PROMPT.txt\`에 있다. Prompt에 답하지 말고 난이도만 판정한다.
`;
}

function copyPastePrompt(batchCount) {
  return `첨부한 ZIP의 압축을 풀고 START-HERE.md, LABELING-GUIDE.md, OUTPUT-SCHEMA.json을 먼저 전부 읽어라.

당신은 GateLM 난이도 분류 Reviewer C다. 이 작업은 이전 판단을 수정하는 작업이 아니라, 제공된 Prompt만 보고 처음부터 새로 수행하는 블라인드 구조화 판정이다. 기존 후보 라벨이나 다른 리뷰어 결과를 추측하거나 요청하지 마라.

inputs 폴더의 ${batchCount}개 batch를 순서대로 모두 처리하라. 각 Prompt에 답하지 말고, 반드시 7개 축을 각각 판정한 뒤 최종 difficulty를 simple 또는 complex로 선택하라. 길이, 언어, 전문 용어, 코드 포함 여부를 단독 근거로 사용하지 마라. 긴 Simple, 짧은 Complex, 영어·한영 혼합 Simple/Complex 가능성을 동일하게 검토하라.

각 입력 batch마다 같은 번호의 output JSONL을 만들고 OUTPUT-SCHEMA.json을 정확히 지켜라. 입력 한 줄당 출력 한 줄을 같은 순서로 작성하며 item_id를 변경하지 마라. 자유 서술 rationale이나 Prompt 원문을 결과에 넣지 마라.

완료 후 모든 output JSONL을 하나의 ZIP으로 반환하라. 한 번에 전부 처리할 수 없다면 완료한 batch 결과 ZIP과 마지막 완료 batch 번호를 반환하고 다음 대화에서 이어서 처리하라.
`;
}

function writeOrCheck(filePath, contents, checkOnly) {
  if (checkOnly) {
    let actual;
    try {
      actual = readFileSync(filePath, "utf8");
    } catch {
      throw new Error(`missing Reviewer C packet file: ${filePath}`);
    }
    if (actual !== contents) throw new Error(`stale Reviewer C packet file: ${filePath}`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

export function buildReviewerCPacket({ datasetText, reviewerBText, reviewerBManifest }) {
  const targeted = buildTargetedPacket({
    datasetText,
    reviewerBText,
    reviewerBManifest,
  });
  if (targeted.selectedItemIds.size !== EXPECTED_RECORDS) {
    throw new Error(`expected ${EXPECTED_RECORDS} targeted item IDs`);
  }

  const fullPacket = buildArtifacts(datasetText);
  const reviewerA = fullPacket.reviewerArtifacts.find(
    ({ reviewer }) => reviewer.id === "A",
  );
  const selectedRows = [];
  for (const batch of reviewerA.manifest.batch_index) {
    const contents = reviewerA.files.get(
      batch.input_file.replaceAll("/", path.sep),
    );
    for (const row of readJsonlText(contents, batch.input_file)) {
      if (targeted.selectedItemIds.has(row.item_id)) selectedRows.push(row);
    }
  }
  if (
    selectedRows.length !== EXPECTED_RECORDS ||
    new Set(selectedRows.map((row) => row.item_id)).size !== EXPECTED_RECORDS
  ) {
    throw new Error("Reviewer C input set does not match the targeted review set");
  }

  const groups = orderAndGroup(selectedRows);
  const batches = makeBatches(groups);
  const files = new Map();
  const batchIndex = [];
  const orderedItemIds = [];
  for (const [index, batch] of batches.entries()) {
    const batchId = `C-${String(index + 1).padStart(4, "0")}`;
    const rows = batch.groups.flatMap((group) =>
      group.records.map((row) => {
        orderedItemIds.push(row.item_id);
        return {
          schema_version: INPUT_SCHEMA_VERSION,
          reviewer_id: "C",
          batch_id: batchId,
          item_id: row.item_id,
          review_group_id: row.review_group_id,
          prompt: row.prompt,
        };
      }),
    );
    const fileName = `${batchId}.input.jsonl`;
    const contents = jsonl(rows);
    files.set(path.join("inputs", fileName), contents);
    batchIndex.push({
      batch_id: batchId,
      input_file: `inputs/${fileName}`,
      expected_output_file: `outputs/${batchId}.output.jsonl`,
      records: rows.length,
      groups: batch.groups.length,
      prompt_characters: batch.promptCharacters,
      input_sha256: sha256(contents),
    });
  }

  const reviewSetSha256 = sha256(
    `${[...targeted.selectedItemIds].sort().join("\n")}\n`,
  );
  const packageManifest = {
    schema_version:
      "gatelm.routing-difficulty-structured-axis-review-packet-manifest.v1",
    review_mode: "blind_structured_axis_review",
    reviewer: { id: "C", intended_model_family: "GPT" },
    records: EXPECTED_RECORDS,
    groups: groups.length,
    batches: batches.length,
    dataset_sha256: sha256(datasetText),
    review_set_sha256: reviewSetSha256,
    reviewer_order_sha256: sha256(`${orderedItemIds.join("\n")}\n`),
    batching: {
      selected_group_atomic: true,
      max_records_per_batch: MAX_RECORDS_PER_BATCH,
      max_prompt_characters_per_batch: MAX_PROMPT_CHARACTERS_PER_BATCH,
    },
    required_axis_count: 7,
    candidate_labels_included: false,
    prior_reviewer_results_included: false,
    selection_reasons_included: false,
    original_ids_included: false,
    human_approval_status: "pending",
    training_eligible: false,
    batch_index: batchIndex,
  };
  const privateManifest = {
    schema_version:
      "gatelm.routing-difficulty-reviewer-c-provenance-manifest.v1",
    reviewer_role: "same_model_family_blind_second_pass",
    independent_reviewer_credit: false,
    dataset_sha256: sha256(datasetText),
    reviewer_b_normalized_sha256: sha256(reviewerBText),
    reviewer_b_source_zip_sha256: reviewerBManifest.source_zip.sha256,
    selection_manifest: targeted.privateManifest,
    review_set_sha256: reviewSetSha256,
    records: EXPECTED_RECORDS,
    batches: batches.length,
    reviewer_packet_disclosures: {
      prior_reviewer_label: false,
      prior_reviewer_confidence: false,
      current_candidate_label: false,
      selection_reason: false,
      original_sample_id: false,
    },
  };

  const guide = labelingGuide();
  const schema = `${JSON.stringify(buildOutputSchema(), null, 2)}\n`;
  const example = outputExample();
  const start = startHere(batches.length);
  const command = copyPastePrompt(batches.length);
  files.set("START-HERE.md", start);
  files.set("COPY-PASTE-PROMPT.txt", command);
  files.set("LABELING-GUIDE.md", guide);
  files.set("OUTPUT-SCHEMA.json", schema);
  files.set("OUTPUT-EXAMPLE.jsonl", example);
  files.set(
    "PACKET-MANIFEST.json",
    `${JSON.stringify(packageManifest, null, 2)}\n`,
  );
  files.set(
    "outputs/PUT-RESULT-FILES-HERE.txt",
    "각 batch의 JSONL 결과 파일을 이 폴더에 저장하세요.\n",
  );

  return { files, packageManifest, privateManifest };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const datasetText = readFileSync(DATASET_PATH, "utf8");
  const reviewerBText = readFileSync(REVIEWER_B_RESULTS_PATH, "utf8");
  const reviewerBManifest = readJson(REVIEWER_B_MANIFEST_PATH);
  const built = buildReviewerCPacket({
    datasetText,
    reviewerBText,
    reviewerBManifest,
  });

  if (options.checkOnly && !statSync(options.outputRoot).isDirectory()) {
    throw new Error(`missing Reviewer C packet directory: ${options.outputRoot}`);
  }
  for (const [relativePath, contents] of built.files) {
    writeOrCheck(
      path.join(options.outputRoot, relativePath),
      contents,
      options.checkOnly,
    );
  }
  writeOrCheck(
    options.privateManifestPath,
    `${JSON.stringify(built.privateManifest, null, 2)}\n`,
    options.checkOnly,
  );
  console.log(
    `${options.checkOnly ? "verified" : "wrote"} Reviewer C deep-review packet: ${built.packageManifest.records} items, ${built.packageManifest.batches} batches, 7 required axes; independent reviewer credit remains false`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
