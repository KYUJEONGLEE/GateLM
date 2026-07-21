import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATASET_PATH = path.resolve(
  "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.jsonl",
);
const DEFAULT_OUTPUT_ROOT = path.resolve(
  ".tmp/routing-difficulty-independent-review",
);
const EXPECTED_RECORDS = 15_000;
const MAX_RECORDS_PER_BATCH = 100;
const MAX_PROMPT_CHARACTERS_PER_BATCH = 70_000;
const INPUT_SCHEMA_VERSION =
  "gatelm.routing-difficulty-independent-review-input.v1";
const RESULT_SCHEMA_VERSION =
  "gatelm.routing-difficulty-independent-review-result.v1";
const MANIFEST_SCHEMA_VERSION =
  "gatelm.routing-difficulty-independent-review-packet-manifest.v1";
const REVIEW_PROTOCOL_VERSION = "gatelm.routing-difficulty-independent-review.v1";

const REVIEWERS = [
  {
    id: "A",
    modelFamily: "Gemini",
    slug: "reviewer-a-gemini",
    orderSalt: "gatelm-reviewer-a-gemini-order-v1",
  },
  {
    id: "B",
    modelFamily: "GPT",
    slug: "reviewer-b-gpt",
    orderSalt: "gatelm-reviewer-b-gpt-order-v1",
  },
];

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

function parseArguments(argv) {
  let outputRoot = DEFAULT_OUTPUT_ROOT;
  let checkOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      checkOnly = true;
      continue;
    }
    if (argument === "--output-root") {
      const next = argv[index + 1];
      if (!next) throw new Error("--output-root requires a path");
      outputRoot = path.resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }

  return { outputRoot, checkOnly };
}

function readJsonl(filePath) {
  return readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function opaqueId(prefix, namespace, value, length = 24) {
  return `${prefix}_${sha256(`${namespace}|${value}`).slice(0, length)}`;
}

function ensureDataset(records) {
  if (records.length !== EXPECTED_RECORDS) {
    throw new Error(
      `expected ${EXPECTED_RECORDS} dataset records, got ${records.length}`,
    );
  }

  const sampleIds = new Set();
  for (const [index, record] of records.entries()) {
    if (record?.schema_version !== "gatelm.routing-difficulty-dataset-record.v1") {
      throw new Error(`record ${index + 1}: unexpected schema_version`);
    }
    if (typeof record.sample_id !== "string" || record.sample_id.length === 0) {
      throw new Error(`record ${index + 1}: missing sample_id`);
    }
    if (sampleIds.has(record.sample_id)) {
      throw new Error(`duplicate sample_id: ${record.sample_id}`);
    }
    sampleIds.add(record.sample_id);
    if (typeof record.group_id !== "string" || record.group_id.length === 0) {
      throw new Error(`${record.sample_id}: missing group_id`);
    }
    if (
      typeof record.redacted_prompt !== "string" ||
      record.redacted_prompt.trim().length === 0
    ) {
      throw new Error(`${record.sample_id}: missing redacted_prompt`);
    }
  }
}

function buildBlindRecords(records) {
  const seenItemIds = new Set();
  const seenGroupIds = new Map();

  return records.map((record) => {
    const itemId = opaqueId(
      "ri",
      "gatelm-routing-difficulty-review-item-v1",
      record.sample_id,
    );
    const reviewGroupId = opaqueId(
      "rg",
      "gatelm-routing-difficulty-review-group-v1",
      record.group_id,
    );
    if (seenItemIds.has(itemId)) throw new Error(`opaque item ID collision: ${itemId}`);
    seenItemIds.add(itemId);

    const priorGroupId = seenGroupIds.get(reviewGroupId);
    if (priorGroupId && priorGroupId !== record.group_id) {
      throw new Error(`opaque group ID collision: ${reviewGroupId}`);
    }
    seenGroupIds.set(reviewGroupId, record.group_id);

    return {
      itemId,
      reviewGroupId,
      sampleId: record.sample_id,
      groupId: record.group_id,
      prompt: record.redacted_prompt,
    };
  });
}

function groupRecords(blindRecords) {
  const groups = new Map();
  for (const record of blindRecords) {
    const group = groups.get(record.reviewGroupId) ?? [];
    group.push(record);
    groups.set(record.reviewGroupId, group);
  }
  return [...groups.entries()].map(([reviewGroupId, records]) => ({
    reviewGroupId,
    records: records.sort((left, right) =>
      left.itemId.localeCompare(right.itemId, "en"),
    ),
    promptCharacters: records.reduce(
      (total, record) => total + record.prompt.length,
      0,
    ),
  }));
}

function orderGroups(groups, salt) {
  return [...groups].sort((left, right) => {
    const leftKey = sha256(`${salt}|${left.reviewGroupId}`);
    const rightKey = sha256(`${salt}|${right.reviewGroupId}`);
    return leftKey.localeCompare(rightKey, "en");
  });
}

function makeBatches(groups) {
  const batches = [];
  let current = [];
  let currentRecordCount = 0;
  let currentPromptCharacters = 0;

  const flush = () => {
    if (current.length === 0) return;
    batches.push({
      groups: current,
      recordCount: currentRecordCount,
      promptCharacters: currentPromptCharacters,
    });
    current = [];
    currentRecordCount = 0;
    currentPromptCharacters = 0;
  };

  for (const group of groups) {
    if (
      current.length > 0 &&
      (currentRecordCount + group.records.length > MAX_RECORDS_PER_BATCH ||
        currentPromptCharacters + group.promptCharacters >
          MAX_PROMPT_CHARACTERS_PER_BATCH)
    ) {
      flush();
    }
    current.push(group);
    currentRecordCount += group.records.length;
    currentPromptCharacters += group.promptCharacters;
  }
  flush();
  return batches;
}

function labelingGuide(reviewer) {
  return `# GateLM Simple / Complex 독립 판정 가이드

당신은 **리뷰어 ${reviewer.id} (${reviewer.modelFamily})**다. 사용자 프롬프트를 해결하거나 답변하지 말고, 요청을 제대로 수행하는 데 필요한 작업 난이도만 판정한다.

## 독립성 원칙

- 다른 리뷰어의 결과, 기존 후보 라벨, 자동 분류 결과를 요청하거나 추측하지 않는다.
- 입력에는 블라인드 \`item_id\`와 \`review_group_id\`만 있다. 원본 ID나 후보 라벨을 복원하려 하지 않는다.
- 프롬프트 길이, 언어, 전문 용어, 코드 포함 여부, 특정 업무 분야를 라벨의 단독 근거로 사용하지 않는다.
- 긴 입력도 한 번의 직접 변환이면 Simple일 수 있고, 짧은 입력도 의존적 추론·검증이 강하면 Complex일 수 있다.
- 동일 \`review_group_id\`의 표현 변형은 함께 참고할 수 있지만 각 항목을 독립적으로 판정한다. 의미가 동일하다면 라벨 일관성을 확인한다.

## Simple

다음 특징을 종합했을 때 한 번의 제한된 작업으로 안정적으로 처리할 수 있는 요청이다.

- 단일 작업 또는 서로 독립적인 기계적 작업
- 단순 조회, 설명, 복사, 번역, 요약, 형식 변환
- 제한된 국소 추론만 필요
- 복잡한 문맥 통합이나 전문적 판단이 불필요
- 외부 도구·검색·실행 결과의 연속 해석이나 결과 검증이 불필요

## Complex

다음 중 하나 이상이 **강하게** 필요해 전체 수행 난이도가 높아지는 요청이다.

- 앞 단계 결과를 다음 단계가 사용하는 의존적 다단계 작업
- 원인 분석, 비교 평가, 의사결정, 수학적·논리적 추론
- 여러 문서·정보 조각·긴 문맥의 실질적 통합
- 전문적 판단과 다수 제약 사이의 trade-off
- 여러 도구·검색·파일·외부 근거의 연속 사용과 해석
- 테스트, 검산, 사실 확인, 재현, 수정 전후 검증
- 서로 의존하는 복수 산출물

항목 하나가 보인다는 이유만으로 자동으로 Complex로 분류하지 않는다. 특히 도구 하나로 끝나는 단순 조회, 긴 텍스트의 직접 요약, 전문 용어가 있는 단순 변환은 Simple일 수 있다.

## 판정할 7개 축

1. 추론·분석 수준
2. 작업 단계 수와 단계 간 의존성
3. 동시에 충족해야 하는 제약과 trade-off
4. 전문 지식과 전문적 판단
5. 여러 문맥·자료의 통합 필요성
6. 도구·검색·파일·외부 자원의 연속 사용
7. 결과 검증·검산·테스트 필요성

## 경계 처리

- 반드시 \`simple\` 또는 \`complex\` 중 하나를 최선의 판정으로 반환한다.
- 입력이 모호하거나 핵심 자료가 누락됐거나 손상되어 확신하기 어렵다면 \`needs_human_adjudication=true\`로 둔다.
- 낮은 확신을 숨기지 말고 \`confidence=low\`로 둔다.
- 프롬프트 원문이나 일부 문장을 결과에 복사하지 않는다. 자유 서술 rationale도 작성하지 않는다.
`;
}

function outputContract(reviewer) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://gatelm.local/routing/difficulty/independent-review/${reviewer.id.toLowerCase()}/result.schema.json`,
    title: `GateLM independent difficulty review result - Reviewer ${reviewer.id}`,
    type: "object",
    additionalProperties: false,
    properties: {
      schema_version: { const: RESULT_SCHEMA_VERSION },
      reviewer_id: { const: reviewer.id },
      batch_id: {
        type: "string",
        pattern: `^${reviewer.id}-[0-9]{4}$`,
      },
      item_id: { type: "string", pattern: "^ri_[a-f0-9]{24}$" },
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
      "difficulty",
      "confidence",
      "reason_codes",
      "needs_human_adjudication",
    ],
  };
}

function copyPastePrompt(reviewer) {
  return `첨부한 ZIP의 압축을 풀고 START-HERE.md, LABELING-GUIDE.md, OUTPUT-SCHEMA.json을 먼저 전부 읽어라.

당신은 GateLM 난이도 분류의 독립 리뷰어 ${reviewer.id} (${reviewer.modelFamily})다. inputs 폴더의 모든 batch를 순서대로 처리하라. 프롬프트에 답하지 말고 각 항목을 simple 또는 complex로 판정하라. 기존 라벨이나 다른 리뷰어 결과를 추측하거나 요청하지 마라.

각 입력 batch마다 같은 번호의 JSONL 결과 파일을 만들고 OUTPUT-SCHEMA.json을 정확히 지켜라. 입력 한 줄당 출력 한 줄을 같은 순서로 작성하고, item_id를 변경하지 마라. 결과에는 프롬프트 원문·일부 문장·자유 서술 설명을 넣지 마라. 라벨, confidence, reason_codes, needs_human_adjudication만 구조화해서 반환하라.

완료 후 모든 output JSONL을 하나의 ZIP으로 반환하라. 한 번에 전부 처리할 수 없다면 완료한 batch 결과 ZIP과 마지막 완료 batch 번호를 반환하고, 다음 대화에서 이어서 처리하라.
`;
}

function startHere(reviewer, batchCount) {
  return `# Reviewer ${reviewer.id} (${reviewer.modelFamily}) 시작 안내

이 패키지는 GateLM 15,000개 Prompt에 대한 **블라인드 독립 난이도 판정** 전용이다.

## 바로 시작하기

1. \`LABELING-GUIDE.md\`를 전부 읽는다.
2. \`OUTPUT-SCHEMA.json\`을 전부 읽는다.
3. \`inputs\`의 \`${reviewer.id}-0001.input.jsonl\`부터 순서대로 처리한다.
4. 각 batch마다 \`outputs/${reviewer.id}-0001.output.jsonl\` 형식의 결과를 만든다.
5. ${batchCount}개 batch를 모두 완료한 뒤 output JSONL만 ZIP으로 반환한다.

채팅창에 보낼 명령은 \`COPY-PASTE-PROMPT.txt\`에 준비되어 있다.

## 절대 금지

- 프롬프트 자체에 답하기
- 현재 후보 라벨이나 다른 리뷰어 결과 요청·추측
- 길이, 언어, 전문 용어, 코드 포함 여부만으로 판정
- 입력 행 누락, 순서 변경, item_id 변경
- JSONL 밖의 설명 또는 Markdown fence 삽입
- 결과에 프롬프트 원문이나 일부 문장 복사

이 단계는 사람 승인(adjudication)이 아니다. 두 독립 리뷰 결과는 일치도 비교와 사람 검수 queue 생성에만 사용한다.
`;
}

function exampleOutput(reviewer) {
  return jsonl([
    {
      schema_version: RESULT_SCHEMA_VERSION,
      reviewer_id: reviewer.id,
      batch_id: `${reviewer.id}-0001`,
      item_id: "ri_0123456789abcdef01234567",
      difficulty: "simple",
      confidence: "high",
      reason_codes: ["single_bounded_task", "mechanical_transformation"],
      needs_human_adjudication: false,
    },
    {
      schema_version: RESULT_SCHEMA_VERSION,
      reviewer_id: reviewer.id,
      batch_id: `${reviewer.id}-0001`,
      item_id: "ri_89abcdef0123456789abcdef",
      difficulty: "complex",
      confidence: "medium",
      reason_codes: [
        "dependent_multistep_workflow",
        "verification_or_falsification",
      ],
      needs_human_adjudication: false,
    },
  ]);
}

function buildReviewerFiles({ reviewer, groups, datasetSha256, sampleSetSha256 }) {
  const orderedGroups = orderGroups(groups, reviewer.orderSalt);
  const batches = makeBatches(orderedGroups);
  const files = new Map();
  const batchManifest = [];
  const orderedItemIds = [];

  for (const [index, batch] of batches.entries()) {
    const batchId = `${reviewer.id}-${String(index + 1).padStart(4, "0")}`;
    const rows = batch.groups.flatMap((group) =>
      group.records.map((record) => {
        orderedItemIds.push(record.itemId);
        return {
          schema_version: INPUT_SCHEMA_VERSION,
          reviewer_id: reviewer.id,
          batch_id: batchId,
          item_id: record.itemId,
          review_group_id: record.reviewGroupId,
          prompt: record.prompt,
        };
      }),
    );
    const contents = jsonl(rows);
    const fileName = `${batchId}.input.jsonl`;
    files.set(path.join("inputs", fileName), contents);
    batchManifest.push({
      batch_id: batchId,
      input_file: `inputs/${fileName}`,
      expected_output_file: `outputs/${batchId}.output.jsonl`,
      records: rows.length,
      groups: batch.groups.length,
      prompt_characters: batch.promptCharacters,
      input_sha256: sha256(contents),
    });
  }

  const guide = labelingGuide(reviewer);
  const schema = `${JSON.stringify(outputContract(reviewer), null, 2)}\n`;
  const command = copyPastePrompt(reviewer);
  const start = startHere(reviewer, batches.length);
  const example = exampleOutput(reviewer);
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    protocol_version: REVIEW_PROTOCOL_VERSION,
    review_mode: "blind_independent_simple_complex_labeling",
    reviewer: {
      id: reviewer.id,
      intended_model_family: reviewer.modelFamily,
    },
    records: orderedItemIds.length,
    groups: groups.length,
    batches: batches.length,
    dataset_sha256: datasetSha256,
    sample_set_sha256: sampleSetSha256,
    reviewer_order_sha256: sha256(`${orderedItemIds.join("\n")}\n`),
    batching: {
      group_atomic: true,
      max_records_per_batch: MAX_RECORDS_PER_BATCH,
      max_prompt_characters_per_batch:
        MAX_PROMPT_CHARACTERS_PER_BATCH,
    },
    blind_fields_excluded: [
      "sample_id",
      "group_id",
      "automatic_label",
      "label",
      "label_confidence",
      "label_reason",
      "language",
      "source",
      "source_dataset",
      "task_type",
      "service_domain",
      "length_bucket",
      "reasoning_level",
      "task_step_count",
      "constraint_count",
      "tool_required",
      "verification_required",
      "split",
    ],
    result_schema_version: RESULT_SCHEMA_VERSION,
    candidate_labels_included: false,
    other_reviewer_results_included: false,
    human_approval_status: "pending",
    training_eligible: false,
    files: {
      start: "START-HERE.md",
      copy_paste_prompt: "COPY-PASTE-PROMPT.txt",
      label_guide: "LABELING-GUIDE.md",
      output_schema: "OUTPUT-SCHEMA.json",
      output_example: "OUTPUT-EXAMPLE.jsonl",
    },
    batch_index: batchManifest,
  };

  files.set("START-HERE.md", start);
  files.set("COPY-PASTE-PROMPT.txt", command);
  files.set("LABELING-GUIDE.md", guide);
  files.set("OUTPUT-SCHEMA.json", schema);
  files.set("OUTPUT-EXAMPLE.jsonl", example);
  files.set("PACKET-MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`);
  files.set("outputs/PUT-RESULT-FILES-HERE.txt", "각 batch의 JSONL 결과 파일을 이 폴더에 저장하세요.\n");

  return { files, manifest };
}

function writeOrCheckFiles(root, files, checkOnly) {
  const expectedFiles = new Set([...files.keys()].map((name) => name.replaceAll("\\", "/")));

  if (checkOnly && !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`missing generated packet directory: ${root}`);
  }

  for (const [relativePath, contents] of files) {
    const filePath = path.join(root, relativePath);
    if (checkOnly) {
      let actual;
      try {
        actual = readFileSync(filePath, "utf8");
      } catch {
        throw new Error(`missing generated packet file: ${filePath}`);
      }
      if (actual !== contents) throw new Error(`stale generated packet file: ${filePath}`);
      continue;
    }
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents, "utf8");
  }

  if (checkOnly) {
    const walk = (directory, relativeRoot = "") => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relativePath = path
          .join(relativeRoot, entry.name)
          .replaceAll("\\", "/");
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolutePath, relativePath);
        else if (!expectedFiles.has(relativePath)) {
          throw new Error(`unexpected generated packet file: ${absolutePath}`);
        }
      }
    };
    walk(root);
  }
}

export function buildArtifacts(datasetText) {
  const records = datasetText
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  ensureDataset(records);

  const blindRecords = buildBlindRecords(records);
  const groups = groupRecords(blindRecords);
  const datasetSha256 = sha256(datasetText);
  const sampleSetSha256 = sha256(
    `${blindRecords
      .map((record) => record.itemId)
      .sort((left, right) => left.localeCompare(right, "en"))
      .join("\n")}\n`,
  );
  const reviewerArtifacts = REVIEWERS.map((reviewer) => ({
    reviewer,
    ...buildReviewerFiles({ reviewer, groups, datasetSha256, sampleSetSha256 }),
  }));

  const mappingRows = blindRecords
    .map((record) => ({
      schema_version: "gatelm.routing-difficulty-review-item-map.v1",
      item_id: record.itemId,
      sample_id: record.sampleId,
      review_group_id: record.reviewGroupId,
      group_id: record.groupId,
    }))
    .sort((left, right) => left.item_id.localeCompare(right.item_id, "en"));

  const privateManifest = {
    schema_version: "gatelm.routing-difficulty-review-run-manifest.v1",
    protocol_version: REVIEW_PROTOCOL_VERSION,
    dataset_path: path.relative(process.cwd(), DATASET_PATH).replaceAll("\\", "/"),
    dataset_sha256: datasetSha256,
    records: records.length,
    groups: groups.length,
    sample_set_sha256: sampleSetSha256,
    reviewers: reviewerArtifacts.map(({ reviewer, manifest }) => ({
      id: reviewer.id,
      intended_model_family: reviewer.modelFamily,
      packet_directory: reviewer.slug,
      records: manifest.records,
      batches: manifest.batches,
      reviewer_order_sha256: manifest.reviewer_order_sha256,
    })),
    invariant_checks: {
      same_record_count: reviewerArtifacts.every(
        ({ manifest }) => manifest.records === records.length,
      ),
      same_sample_set: reviewerArtifacts.every(
        ({ manifest }) => manifest.sample_set_sha256 === sampleSetSha256,
      ),
      different_reviewer_order:
        reviewerArtifacts[0].manifest.reviewer_order_sha256 !==
        reviewerArtifacts[1].manifest.reviewer_order_sha256,
      candidate_labels_excluded: reviewerArtifacts.every(
        ({ manifest }) => manifest.candidate_labels_included === false,
      ),
    },
  };

  if (Object.values(privateManifest.invariant_checks).some((value) => !value)) {
    throw new Error("independent review packet invariant failed");
  }

  return {
    records,
    groups,
    reviewerArtifacts,
    privateFiles: new Map([
      ["review-item-map.jsonl", jsonl(mappingRows)],
      ["review-run-manifest.json", `${JSON.stringify(privateManifest, null, 2)}\n`],
    ]),
    privateManifest,
  };
}

function main() {
  const { outputRoot, checkOnly } = parseArguments(process.argv.slice(2));
  const datasetText = readFileSync(DATASET_PATH, "utf8");
  const artifacts = buildArtifacts(datasetText);

  for (const { reviewer, files } of artifacts.reviewerArtifacts) {
    writeOrCheckFiles(path.join(outputRoot, reviewer.slug), files, checkOnly);
  }
  writeOrCheckFiles(
    path.join(outputRoot, "private-do-not-send"),
    artifacts.privateFiles,
    checkOnly,
  );

  const batchSummary = artifacts.reviewerArtifacts
    .map(({ reviewer, manifest }) => `${reviewer.id}:${manifest.batches}`)
    .join(", ");
  console.log(
    `${checkOnly ? "verified" : "wrote"} ${artifacts.records.length} blind review items (${batchSummary}); private mapping excluded from reviewer packets`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
