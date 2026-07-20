import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const datasetVersion = "difficulty_independent_ood_5000_2026_07_18_candidate_v1";
const createdAt = "2026-07-19T00:00:00Z";
const batchSize = 100;
const blindReviewPath =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/difficulty-independent-ood-5000.v1.blind-review.jsonl";
const kitRoot = "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit";
const labelGuideSourcePath = "docs/v2.1.0/difficulty-label-guide.md";
const instructionsPath = `${kitRoot}/GPT-REVIEW-INSTRUCTIONS.md`;
const commandAPath = `${kitRoot}/CHATGPT-COMMAND-REVIEWER-A.md`;
const commandBPath = `${kitRoot}/CHATGPT-COMMAND-REVIEWER-B.md`;
const copiedLabelGuidePath = `${kitRoot}/LABEL-GUIDE.md`;
const manifestPath = `${kitRoot}/PACKET-MANIFEST.json`;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseJsonl(text, label) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}:${index + 1}: invalid JSON (${error.message})`);
      }
    });
}

function packetPath(batchNumber) {
  return `${kitRoot}/packets/difficulty-independent-ood-5000.gpt-review.batch-${String(batchNumber).padStart(3, "0")}.input.jsonl`;
}

function toPacketRow(record, batchId, position) {
  return {
    schemaVersion: "gatelm.difficulty-independent-ood-gpt-review-input.v1",
    datasetVersion,
    batchId,
    position,
    sampleId: record.sampleId,
    sourcePrompt: record.redactedPrompt,
    language: record.language,
    promptRuneLength: [...record.redactedPrompt].length,
    sourcePolicy: {
      syntheticOnly: true,
      customerDataIncluded: false,
      provisionalLabelsHidden: true,
      promptFamilyHidden: true,
      datasetSplitHidden: true,
      classifierOutputHidden: true,
    },
  };
}

export function buildGptReviewKitArtifacts(options = {}) {
  const blindText = options.blindText ?? readFileSync(path.join(rootDir, blindReviewPath), "utf8");
  const labelGuide = options.labelGuide ?? readFileSync(path.join(rootDir, labelGuideSourcePath), "utf8");
  const instructions = options.instructions ?? readFileSync(path.join(rootDir, instructionsPath), "utf8");
  const commandA = options.commandA ?? readFileSync(path.join(rootDir, commandAPath), "utf8");
  const commandB = options.commandB ?? readFileSync(path.join(rootDir, commandBPath), "utf8");
  const records = parseJsonl(blindText, blindReviewPath);
  if (records.length !== 5000) throw new Error(`expected 5,000 blind rows, got ${records.length}`);
  if (new Set(records.map((record) => record.sampleId)).size !== records.length) {
    throw new Error("blind input sampleId values must be unique");
  }
  const allowedBlindKeys = ["datasetVersion", "language", "redactedPrompt", "sampleId", "schemaVersion"];
  for (const record of records) {
    if (record.datasetVersion !== datasetVersion) throw new Error(`${record.sampleId}: datasetVersion mismatch`);
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(allowedBlindKeys)) {
      throw new Error(`${record.sampleId}: blind input contains an unexpected field`);
    }
  }

  const artifacts = {
    [copiedLabelGuidePath]: labelGuide,
  };
  const packets = [];
  const packetSampleIds = new Set();
  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batchNumber = offset / batchSize + 1;
    const batchId = `batch-${String(batchNumber).padStart(3, "0")}`;
    const rows = records.slice(offset, offset + batchSize).map((record, index) => {
      if (packetSampleIds.has(record.sampleId)) throw new Error(`duplicate packet sampleId: ${record.sampleId}`);
      packetSampleIds.add(record.sampleId);
      return toPacketRow(record, batchId, index + 1);
    });
    if (rows.length !== batchSize) throw new Error(`${batchId}: expected ${batchSize} rows`);
    const packetText = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const relativePath = packetPath(batchNumber);
    artifacts[relativePath] = packetText;
    packets.push({
      batchId,
      records: rows.length,
      inputPath: relativePath,
      inputSha256: sha256(packetText),
      reviewerAOutputName: `difficulty-independent-ood-5000.gpt-review.reviewer-a.${batchId}.output.jsonl`,
      reviewerBOutputName: `difficulty-independent-ood-5000.gpt-review.reviewer-b.${batchId}.output.jsonl`,
    });
  }
  if (packets.length !== 50 || packetSampleIds.size !== 5000) {
    throw new Error("review packets must cover 5,000 samples in exactly 50 batches");
  }

  const manifest = {
    schemaVersion: "gatelm.difficulty-independent-ood-gpt-review-packet-manifest.v1",
    datasetVersion,
    reviewMode: "blind_independent_automated_annotation",
    sourceBlindReviewPath: blindReviewPath,
    sourceBlindReviewSha256: sha256(blindText),
    instructionsPath,
    instructionsSha256: sha256(instructions),
    labelGuidePath: copiedLabelGuidePath,
    labelGuideSha256: sha256(labelGuide),
    reviewerCommands: {
      reviewer_a: { path: commandAPath, sha256: sha256(commandA) },
      reviewer_b: { path: commandBPath, sha256: sha256(commandB) },
    },
    batchSize,
    batchCount: packets.length,
    records: packetSampleIds.size,
    provisionalLabelsIncluded: false,
    promptFamilyIncluded: false,
    datasetSplitIncluded: false,
    classifierOutputsIncluded: false,
    automatedReviewOnly: true,
    confersHumanReviewStatus: false,
    trainingEligible: false,
    packets,
    createdAt,
  };
  artifacts[manifestPath] = `${JSON.stringify(manifest, null, 2)}\n`;
  return { artifacts, manifest, records };
}

function writeArtifacts(artifacts, checkOnly) {
  const drift = [];
  for (const [relativePath, contents] of Object.entries(artifacts)) {
    const absolutePath = path.join(rootDir, relativePath);
    if (checkOnly) {
      if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== contents) drift.push(relativePath);
      continue;
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents, "utf8");
  }
  if (drift.length > 0) throw new Error(`stale GPT review kit artifacts:\n${drift.join("\n")}`);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const { artifacts, manifest } = buildGptReviewKitArtifacts();
  writeArtifacts(artifacts, checkOnly);
  console.log(
    `${checkOnly ? "verified" : "wrote"} ${manifest.batchCount} blind ChatGPT packets with ${manifest.records} records`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
