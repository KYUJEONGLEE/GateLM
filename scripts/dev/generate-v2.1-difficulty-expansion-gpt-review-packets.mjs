import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const datasetPath = path.resolve(
  "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.fixture.jsonl",
);
const outputDirectory = path.resolve(
  "docs/v2.1.0/reviews/difficulty-label-expansion-2000-gpt",
);
const filePrefix = "difficulty-label-expansion-2000.gpt-review";
const categories = ["general", "code", "translation", "summarization", "reasoning"];
const returnedFields = [
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

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readJsonl(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}: line ${index + 1}: invalid JSON (${error.message})`);
      }
    });
}

function groupBy(values, selector) {
  const groups = new Map();
  for (const value of values) {
    const key = selector(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

function reviewReasonCodes(record) {
  const reasons = ["full_label_review", "semantic_head_targets"];
  if (record.expectedInstructionPayloadBoundary.kind !== "instruction_only") {
    reasons.push("instruction_payload_boundary");
  }
  if (record.semanticInputStatus === "empty_instruction") reasons.push("empty_instruction_sentinel");
  if (record.evaluationSlices.includes("short_complex")) reasons.push("short_complex");
  if (record.evaluationSlices.includes("long_simple")) reasons.push("long_simple");
  for (const slice of [
    "negation",
    "indirect_expression",
    "synonym",
    "payload_contamination",
    "category_confusion",
    "ood_terminology",
  ]) {
    if (record.evaluationSlices.includes(slice)) reasons.push(slice);
  }
  return reasons;
}

function toReviewItem(record) {
  return {
    sampleId: record.sampleId,
    sourcePrompt: record.redactedPrompt,
    proposedPrompt: record.redactedPrompt,
    language: record.language,
    reviewReasonCodes: reviewReasonCodes(record),
    proposed: Object.fromEntries(returnedFields.map((field) => [field, record[field]])),
  };
}

function buildBatches(records) {
  if (records.length !== 2000) throw new Error(`expected 2000 source records, got ${records.length}`);
  if (new Set(records.map((record) => record.sampleId)).size !== records.length) {
    throw new Error("source sampleId values must be unique");
  }

  const categoryFamilies = new Map();
  for (const category of categories) {
    const categoryRecords = records.filter((record) => record.expectedCategory === category);
    const families = [...groupBy(categoryRecords, (record) => record.promptFamily)]
      .sort(([left], [right]) => left.localeCompare(right));
    if (families.length !== 40) {
      throw new Error(`${category}: expected 40 prompt families, got ${families.length}`);
    }
    for (const [promptFamily, familyRecords] of families) {
      if (familyRecords.length !== 10) {
        throw new Error(`${promptFamily}: expected 10 records, got ${familyRecords.length}`);
      }
      familyRecords.sort((left, right) => left.sampleId.localeCompare(right.sampleId));
    }
    categoryFamilies.set(category, families);
  }

  const batches = [];
  for (let batchIndex = 0; batchIndex < 20; batchIndex += 1) {
    const rows = [];
    for (const category of categories) {
      const families = categoryFamilies.get(category);
      rows.push(...families[batchIndex * 2][1], ...families[batchIndex * 2 + 1][1]);
    }
    if (rows.length !== 100 || new Set(rows.map((record) => record.promptFamily)).size !== 10) {
      throw new Error(`batch ${batchIndex + 1}: expected 100 records across 10 complete families`);
    }
    batches.push(rows.map(toReviewItem));
  }

  const allItems = batches.flat();
  if (allItems.length !== 2000 || new Set(allItems.map((item) => item.sampleId)).size !== 2000) {
    throw new Error("review batches must cover every sampleId exactly once");
  }
  const sourceIds = [...records.map((record) => record.sampleId)].sort();
  const batchIds = [...allItems.map((item) => item.sampleId)].sort();
  if (JSON.stringify(sourceIds) !== JSON.stringify(batchIds)) {
    throw new Error("review batch membership does not match the source dataset");
  }
  return batches;
}

function batchPath(batchIndex) {
  return path.join(
    outputDirectory,
    `${filePrefix}.batch-${String(batchIndex + 1).padStart(2, "0")}.input.jsonl`,
  );
}

function renderBatch(items) {
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

function checkFile(filePath, expectedText) {
  const actualText = readFileSync(filePath, "utf8");
  if (actualText !== expectedText) {
    throw new Error(`${filePath}: stale review packet; regenerate without --check`);
  }
}

function main() {
  const records = readJsonl(datasetPath);
  const batches = buildBatches(records);
  const batchTexts = batches.map(renderBatch);

  if (process.argv.includes("--check")) {
    batchTexts.forEach((text, index) => checkFile(batchPath(index), text));
    const combinedHash = sha256(batchTexts.join(""));
    console.log(`20 GPT review batches are complete and deterministic (${combinedHash}).`);
    return;
  }

  mkdirSync(outputDirectory, { recursive: true });
  batchTexts.forEach((text, index) => writeFileSync(batchPath(index), text, "utf8"));
  console.log(`wrote ${batches.length} GPT review batches with ${batches.flat().length} total records`);
}

main();
