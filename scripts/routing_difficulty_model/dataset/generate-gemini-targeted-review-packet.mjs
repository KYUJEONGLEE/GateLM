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
  ".tmp/routing-difficulty-independent-review/reviewer-a-gemini-targeted-3650",
);
const DEFAULT_PRIVATE_MANIFEST_PATH = path.resolve(
  ".tmp/routing-difficulty-independent-review/private-do-not-send/gemini-targeted-3650-selection.json",
);
const EXPECTED_RECORDS = 3_650;
const EXPECTED_DISAGREEMENTS = 3_491;
const EXPECTED_LOW_CONFIDENCE = 308;
const EXPECTED_NEEDS_HUMAN = 316;
const MAX_RECORDS_PER_BATCH = 100;
const MAX_PROMPT_CHARACTERS_PER_BATCH = 70_000;

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

function readJsonl(filePath) {
  return readJsonlText(readFileSync(filePath, "utf8"), filePath);
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

export function selectTargetRows(reviewerBRows, datasetById) {
  return reviewerBRows.filter((row) => {
    const datasetRecord = datasetById.get(row.sample_id);
    if (!datasetRecord) throw new Error(`${row.sample_id}: reviewer B row is not in dataset`);
    return (
      datasetRecord.label !== row.difficulty ||
      row.confidence === "low" ||
      row.needs_human_adjudication
    );
  });
}

function selectionStatistics(reviewerBRows, datasetById) {
  const disagreements = new Set();
  const lowConfidence = new Set();
  const needsHuman = new Set();
  for (const row of reviewerBRows) {
    const datasetRecord = datasetById.get(row.sample_id);
    if (!datasetRecord) throw new Error(`${row.sample_id}: reviewer B row is not in dataset`);
    if (datasetRecord.label !== row.difficulty) disagreements.add(row.item_id);
    if (row.confidence === "low") lowConfidence.add(row.item_id);
    if (row.needs_human_adjudication) needsHuman.add(row.item_id);
  }
  const uncertainty = new Set([...lowConfidence, ...needsHuman]);
  const union = new Set([...disagreements, ...uncertainty]);
  const intersectionSize = (left, right) =>
    [...left].filter((itemId) => right.has(itemId)).length;
  return {
    candidate_disagreements: disagreements.size,
    low_confidence: lowConfidence.size,
    needs_human_adjudication: needsHuman.size,
    low_confidence_in_needs_human: intersectionSize(lowConfidence, needsHuman),
    uncertainty_in_disagreements: intersectionSize(uncertainty, disagreements),
    uncertainty_outside_disagreements: [...uncertainty].filter(
      (itemId) => !disagreements.has(itemId),
    ).length,
    union_records: union.size,
  };
}

function groupSelectedRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.review_group_id) ?? [];
    group.push(row);
    groups.set(row.review_group_id, group);
  }
  return [...groups.entries()].map(([reviewGroupId, records]) => ({
    reviewGroupId,
    records,
    promptCharacters: records.reduce((total, row) => total + row.prompt.length, 0),
  }));
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

function startHere(batchCount) {
  return `# Gemini 리뷰어 A 시작 안내

이 패키지는 GateLM Prompt ${EXPECTED_RECORDS.toLocaleString("en-US")}건의 **블라인드 독립 난이도 판정** 전용이다.

## 바로 시작하기

1. \`LABELING-GUIDE.md\`를 전부 읽는다.
2. \`OUTPUT-SCHEMA.json\`을 전부 읽는다.
3. \`inputs\`의 \`A-0001.input.jsonl\`부터 순서대로 처리한다.
4. 각 batch마다 \`outputs/A-0001.output.jsonl\` 형식의 결과를 만든다.
5. ${batchCount}개 batch를 모두 완료한 뒤 output JSONL만 ZIP으로 반환한다.

채팅창에 보낼 명령은 \`COPY-PASTE-PROMPT.txt\`에 준비되어 있다.

## 절대 금지

- 프롬프트 자체에 답하기
- 기존 후보 라벨이나 다른 리뷰어 결과 요청·추측
- 길이, 언어, 전문 용어, 코드 포함 여부만으로 판정
- 입력 행 누락, 순서 변경, item_id 변경
- JSONL 밖의 설명 또는 Markdown fence 삽입
- 결과에 프롬프트 원문이나 일부 문장 복사

각 항목을 독립적으로 판정한다. 이 결과만으로 사람 승인이나 학습 승격이 완료되지는 않는다.
`;
}

function copyPastePrompt(batchCount) {
  return `첨부한 ZIP의 압축을 풀고 START-HERE.md, LABELING-GUIDE.md, OUTPUT-SCHEMA.json을 먼저 전부 읽어라.

당신은 GateLM 난이도 분류의 독립 리뷰어 A(Gemini)다. inputs 폴더의 ${batchCount}개 batch를 순서대로 모두 처리하라. 프롬프트에 답하지 말고 각 항목을 simple 또는 complex로 판정하라. 기존 후보 라벨이나 다른 리뷰어 결과를 추측하거나 요청하지 마라.

각 입력 batch마다 같은 번호의 JSONL 결과 파일을 만들고 OUTPUT-SCHEMA.json을 정확히 지켜라. 입력 한 줄당 출력 한 줄을 같은 순서로 작성하고 item_id를 변경하지 마라. 결과에는 프롬프트 원문·일부 문장·자유 서술 설명을 넣지 마라. difficulty, confidence, reason_codes, needs_human_adjudication만 구조화해서 반환하라.

완료 후 모든 output JSONL을 하나의 ZIP으로 반환하라. 한 번에 전부 처리할 수 없다면 완료한 batch 결과 ZIP과 마지막 완료 batch 번호를 반환하고, 다음 대화에서 이어서 처리하라.
`;
}

function writeOrCheck(filePath, contents, checkOnly) {
  if (checkOnly) {
    let actual;
    try {
      actual = readFileSync(filePath, "utf8");
    } catch {
      throw new Error(`missing generated targeted review file: ${filePath}`);
    }
    if (actual !== contents) {
      throw new Error(`stale generated targeted review file: ${filePath}`);
    }
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

export function buildTargetedPacket({ datasetText, reviewerBText, reviewerBManifest }) {
  const datasetRows = readJsonlText(datasetText, DATASET_PATH);
  const datasetById = new Map(datasetRows.map((row) => [row.sample_id, row]));
  const reviewerBRows = readJsonlText(reviewerBText, REVIEWER_B_RESULTS_PATH);
  if (reviewerBRows.length !== 15_000 || datasetRows.length !== 15_000) {
    throw new Error("targeted review selection requires complete 15,000-row inputs");
  }
  if (reviewerBManifest.packet.dataset_sha256 !== sha256(datasetText)) {
    throw new Error("reviewer B evidence does not match the current dataset hash");
  }
  if (
    reviewerBManifest.artifacts.normalized_sha256 !== sha256(reviewerBText)
  ) {
    throw new Error("reviewer B normalized result hash mismatch");
  }

  const statistics = selectionStatistics(reviewerBRows, datasetById);
  if (
    statistics.candidate_disagreements !== EXPECTED_DISAGREEMENTS ||
    statistics.low_confidence !== EXPECTED_LOW_CONFIDENCE ||
    statistics.needs_human_adjudication !== EXPECTED_NEEDS_HUMAN ||
    statistics.union_records !== EXPECTED_RECORDS
  ) {
    throw new Error(`unexpected targeted selection counts: ${JSON.stringify(statistics)}`);
  }
  const selectedRows = selectTargetRows(reviewerBRows, datasetById);
  const selectedItemIds = new Set(selectedRows.map((row) => row.item_id));
  if (selectedItemIds.size !== EXPECTED_RECORDS) {
    throw new Error(`expected ${EXPECTED_RECORDS} unique selected item IDs`);
  }

  const fullPacket = buildArtifacts(datasetText);
  const reviewerA = fullPacket.reviewerArtifacts.find(
    ({ reviewer }) => reviewer.id === "A",
  );
  const orderedSelectedInputs = [];
  for (const batch of reviewerA.manifest.batch_index) {
    const inputText = reviewerA.files.get(
      batch.input_file.replaceAll("/", path.sep),
    );
    for (const row of readJsonlText(inputText, batch.input_file)) {
      if (selectedItemIds.has(row.item_id)) orderedSelectedInputs.push(row);
    }
  }
  if (
    orderedSelectedInputs.length !== EXPECTED_RECORDS ||
    new Set(orderedSelectedInputs.map((row) => row.item_id)).size !== EXPECTED_RECORDS
  ) {
    throw new Error("targeted Gemini inputs do not match the selected item set");
  }

  const batches = makeBatches(groupSelectedRows(orderedSelectedInputs));
  const files = new Map();
  const batchIndex = [];
  const orderedItemIds = [];
  for (const [index, batch] of batches.entries()) {
    const batchId = `A-${String(index + 1).padStart(4, "0")}`;
    const rows = batch.groups.flatMap((group) =>
      group.records.map((row) => {
        orderedItemIds.push(row.item_id);
        return { ...row, batch_id: batchId };
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

  const selectedSetSha256 = sha256(
    `${[...selectedItemIds].sort().join("\n")}\n`,
  );
  const packageManifest = {
    schema_version:
      "gatelm.routing-difficulty-targeted-independent-review-packet-manifest.v1",
    protocol_version: "gatelm.routing-difficulty-independent-review.v1",
    review_mode: "blind_independent_simple_complex_labeling",
    reviewer: { id: "A", intended_model_family: "Gemini" },
    records: EXPECTED_RECORDS,
    groups: new Set(orderedSelectedInputs.map((row) => row.review_group_id)).size,
    batches: batches.length,
    dataset_sha256: sha256(datasetText),
    review_set_sha256: selectedSetSha256,
    reviewer_order_sha256: sha256(`${orderedItemIds.join("\n")}\n`),
    batching: {
      selected_group_atomic: true,
      max_records_per_batch: MAX_RECORDS_PER_BATCH,
      max_prompt_characters_per_batch: MAX_PROMPT_CHARACTERS_PER_BATCH,
    },
    candidate_labels_included: false,
    reviewer_b_results_included: false,
    selection_reasons_included: false,
    original_ids_included: false,
    human_approval_status: "pending",
    training_eligible: false,
    batch_index: batchIndex,
  };
  const privateManifest = {
    schema_version:
      "gatelm.routing-difficulty-targeted-review-selection-manifest.v1",
    dataset_sha256: sha256(datasetText),
    reviewer_b_normalized_sha256: sha256(reviewerBText),
    reviewer_b_source_zip_sha256: reviewerBManifest.source_zip.sha256,
    selection_rule:
      "candidate_disagreement OR reviewer_b_confidence_low OR reviewer_b_needs_human_adjudication",
    counts: statistics,
    review_set_sha256: selectedSetSha256,
    reviewer_packet_disclosures: {
      reviewer_b_label: false,
      reviewer_b_confidence: false,
      reviewer_b_reason_codes: false,
      current_candidate_label: false,
      selection_reason: false,
      original_sample_id: false,
    },
  };

  const start = startHere(batches.length);
  const command = copyPastePrompt(batches.length);
  files.set("START-HERE.md", start);
  files.set("COPY-PASTE-PROMPT.txt", command);
  files.set("LABELING-GUIDE.md", reviewerA.files.get("LABELING-GUIDE.md"));
  files.set("OUTPUT-SCHEMA.json", reviewerA.files.get("OUTPUT-SCHEMA.json"));
  files.set("OUTPUT-EXAMPLE.jsonl", reviewerA.files.get("OUTPUT-EXAMPLE.jsonl"));
  files.set(
    "PACKET-MANIFEST.json",
    `${JSON.stringify(packageManifest, null, 2)}\n`,
  );
  files.set(
    "outputs/PUT-RESULT-FILES-HERE.txt",
    "각 batch의 JSONL 결과 파일을 이 폴더에 저장하세요.\n",
  );

  return {
    files,
    packageManifest,
    privateManifest,
    selectedItemIds,
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const datasetText = readFileSync(DATASET_PATH, "utf8");
  const reviewerBText = readFileSync(REVIEWER_B_RESULTS_PATH, "utf8");
  const reviewerBManifest = readJson(REVIEWER_B_MANIFEST_PATH);
  const built = buildTargetedPacket({
    datasetText,
    reviewerBText,
    reviewerBManifest,
  });

  if (options.checkOnly && !statSync(options.outputRoot).isDirectory()) {
    throw new Error(`missing generated targeted packet directory: ${options.outputRoot}`);
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
    `${options.checkOnly ? "verified" : "wrote"} ${built.packageManifest.records} blind Gemini review items in ${built.packageManifest.batches} batches; GPT labels and selection reasons excluded`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
