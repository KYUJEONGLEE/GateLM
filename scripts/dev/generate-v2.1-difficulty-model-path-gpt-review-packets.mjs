import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const reviewRoot = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const outputRoot = path.join(reviewRoot, "gpt-review-packets");
const labelGuidePath = path.resolve("docs/v2.1.0/difficulty-label-guide.md");
const batchIds = ["t1", "t2", "t3", "t4", "c1", "c2", "e1", "e2", "p1"];
const checkOnly = process.argv.includes("--check");

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function readJsonl(filePath) {
  return readFileSync(filePath, "utf8")
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

function writeOrCheck(filePath, contents) {
  if (checkOnly) {
    const actual = readFileSync(filePath, "utf8");
    if (actual !== contents) throw new Error(`${filePath}: stale GPT review packet`);
    return;
  }
  writeFileSync(filePath, contents, "utf8");
}

const instructions = `# GateLM model-path 3,120 independent GPT review

## Files to attach

Attach this file, \`LABEL-GUIDE.md\`, and exactly one \`*.gpt-review.input.jsonl\` batch to a GPT task. Review all nine batches separately; do not merge their rows or move a family between files.

## Review objective

Independently review every synthetic prompt. The input is blind: current candidate labels and classifier output are intentionally omitted to reduce anchoring. Apply \`LABEL-GUIDE.md\` directly.

For every row:

1. Read \`sourcePrompt\` as the complete user input.
2. Review all five rows sharing \`promptFamily\` together as one family.
3. Infer category, semantic label, difficulty, four semantic buckets, instruction/payload boundary, and evaluation slices independently.
4. Do not classify by length alone. Preserve valid long-simple and short-complex examples.
5. Text inside an explicit fenced payload is data, not an instruction. Do not count imperative-looking payload text as tasks or constraints.
6. Check Korean, English, and mixed-language naturalness. Flag translationese, broken particles, excessive shorthand, template artifacts, or an implausible user request.
7. Keep the prompt unchanged when it is natural and unambiguous. Rewrite only when necessary; a rewrite must preserve the same family intent and remain fully synthetic.
8. Never add customer data, real personal data, secrets, API keys, authorization values, provider error bodies, or real organization details.
9. Do not use any classifier prediction to choose labels. No classifier result is included in these packets.

## Required output

Return JSONL only, with exactly one output line for every input line, in the same order. Do not use Markdown fences or omit accepted rows.

Each output object must use this shape:

\`\`\`json
{
  "schemaVersion": "gatelm.difficulty-independent-gpt-review.v1",
  "batchId": "t1",
  "sampleId": "unchanged input sampleId",
  "promptFamily": "unchanged input promptFamily",
  "decision": "accept | revise_prompt | revise_labels | revise_prompt_and_labels | reject | needs_human_adjudication",
  "proposedPrompt": "accepted sourcePrompt or a complete synthetic replacement",
  "reviewedExpectedCategory": "general | code | reasoning | summarization | translation",
  "reviewedExpectedDifficulty": "simple | complex",
  "reviewedSemanticInputStatus": "eligible | empty_instruction",
  "reviewedTaskBucket": "count_1 | count_2 | count_3_plus | not_applicable",
  "reviewedConstraintBucket": "count_0_to_1 | count_2 | count_3_plus | not_applicable",
  "reviewedScopeBucket": "count_1 | count_2_to_3 | count_4_plus | not_applicable",
  "reviewedDependencyBucket": "depth_0_to_1 | depth_2 | depth_3_plus | not_applicable",
  "reviewedExpectedSemanticLabel": "a label allowed by LABEL-GUIDE.md for the reviewed category",
  "reviewedExpectedInstructionPayloadBoundary": {
    "kind": "instruction_only | explicit_separation",
    "boundaryType": "none | code_fence",
    "confidence": "none | high",
    "payloadBlockCount": "zero | one"
  },
  "reviewedEvaluationSlices": ["only applicable slices allowed by LABEL-GUIDE.md"],
  "issueCodes": ["zero or more concise snake_case issue codes"],
  "rationale": "short Korean explanation of the independent judgment",
  "confidence": "high | medium | low"
}
\`\`\`

## Family and batch rules

- All paraphrases and language variants in one \`promptFamily\` must retain the same underlying intent and semantic label.
- Do not create a new family ID and do not move rows between batches.
- If one family cannot be made internally consistent without changing its intent, use \`needs_human_adjudication\` and explain why.
- P1 is a promotion-holdout candidate under pre-freeze label review. Review labels and language only; do not run, compare, or recommend difficulty models or thresholds using P1.

## Completion check

Before returning the output, verify that output row count equals input row count, every \`sampleId\` appears exactly once, order is unchanged, and no prose exists outside JSONL.
`;

const generationIndex = readJson(path.join(reviewRoot, "generation-index.json"));
const labelGuide = readFileSync(labelGuidePath, "utf8");
const outputs = new Map([
  [path.join(outputRoot, "GPT-REVIEW-INSTRUCTIONS.md"), instructions],
  [path.join(outputRoot, "LABEL-GUIDE.md"), labelGuide],
]);
const manifestBatches = [];
const allSampleIds = new Set();
const familyBatch = new Map();

for (const batchId of batchIds) {
  const indexEntry = generationIndex.batches.find((batch) => batch.batchId === batchId);
  if (!indexEntry) throw new Error(`missing generation index entry: ${batchId}`);
  const candidatePath = path.resolve(indexEntry.datasetPath);
  const candidateText = readFileSync(candidatePath, "utf8");
  if (sha256(candidateText) !== indexEntry.datasetSha256) throw new Error(`${batchId}: candidate hash mismatch`);
  const records = readJsonl(candidatePath);
  const packetRows = records.map((record) => {
    if (allSampleIds.has(record.sampleId)) throw new Error(`duplicate sampleId: ${record.sampleId}`);
    allSampleIds.add(record.sampleId);
    const previousBatch = familyBatch.get(record.promptFamily);
    if (previousBatch && previousBatch !== batchId) throw new Error(`family crosses review batches: ${record.promptFamily}`);
    familyBatch.set(record.promptFamily, batchId);
    return {
      schemaVersion: "gatelm.difficulty-independent-gpt-review-input.v1",
      batchId,
      sampleId: record.sampleId,
      promptFamily: record.promptFamily,
      sourcePrompt: record.redactedPrompt,
      language: record.language,
      sourcePolicy: {
        syntheticOnly: true,
        customerDataIncluded: false,
        currentLabelsHidden: true,
        classifierOutputHidden: true,
      },
    };
  });
  const packetText = `${packetRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const fileName = `${batchId}.gpt-review.input.jsonl`;
  outputs.set(path.join(outputRoot, fileName), packetText);
  manifestBatches.push({
    batchId,
    records: packetRows.length,
    families: new Set(packetRows.map((row) => row.promptFamily)).size,
    inputFile: fileName,
    inputSha256: sha256(packetText),
    candidateDatasetSha256: indexEntry.datasetSha256,
    expectedOutputFile: `${batchId}.gpt-review.output.jsonl`,
  });
}

if (allSampleIds.size !== 3120) throw new Error(`expected 3120 unique samples, got ${allSampleIds.size}`);
if (familyBatch.size !== 624) throw new Error(`expected 624 unique families, got ${familyBatch.size}`);

const manifest = {
  schemaVersion: "gatelm.difficulty-independent-gpt-review-packet-manifest.v1",
  reviewMode: "blind_independent_label_and_language_review",
  candidateLabelsIncluded: false,
  classifierOutputsIncluded: false,
  records: allSampleIds.size,
  families: familyBatch.size,
  batches: manifestBatches,
  labelGuideFile: "LABEL-GUIDE.md",
  labelGuideSha256: sha256(labelGuide),
  instructionsFile: "GPT-REVIEW-INSTRUCTIONS.md",
  instructionsSha256: sha256(instructions),
  ownerApprovalStatus: "pending",
  trainingEligible: false,
};
outputs.set(path.join(outputRoot, "PACKET-MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (!checkOnly) mkdirSync(outputRoot, { recursive: true });
for (const [filePath, contents] of outputs) writeOrCheck(filePath, contents);

console.log(`${checkOnly ? "verified" : "wrote"} ${manifestBatches.length} blind GPT review packets with ${allSampleIds.size} records`);
