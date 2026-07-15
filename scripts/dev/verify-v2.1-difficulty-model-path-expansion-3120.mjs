import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  verifyDifficultyLabelDatasetManifest,
  verifyDifficultyLabelRecords,
} from "../verify-v2.1-difficulty-eval.mjs";

const root = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const batchIds = ["t1", "t2", "t3", "t4", "c1", "c2", "e1", "e2", "p1"];
const checkOnly = process.argv.includes("--check");
const refreshGoAuditsRequested = process.argv.includes("--refresh-go-audits");
const existingSources = [
  ["docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl", "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json"],
  ["docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.jsonl", "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.manifest.json"],
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const parseJson = (file) => JSON.parse(readFileSync(path.resolve(file), "utf8").replace(/^\uFEFF/u, ""));
const parseJsonl = (file) => readFileSync(path.resolve(file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

function writeOrCheck(filePath, contents) {
  if (checkOnly) {
    const actual = readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
    if (actual !== contents) throw new Error(`${filePath}: verification artifact drifted; rerun with --refresh-go-audits`);
    return;
  }
  writeFileSync(filePath, contents, "utf8");
}

function refreshGoAudits() {
  if (checkOnly) throw new Error("--check and --refresh-go-audits cannot be combined");
  const gatewayRoot = path.resolve("apps/gateway-core");
  for (const batchId of batchIds) {
    const batchRoot = path.join(root, batchId);
    const result = spawnSync(
      "go",
      [
        "run",
        "./cmd/difficulty-decision-audit",
        "-dataset",
        path.join(batchRoot, `${batchId}.candidate.jsonl`),
        "-manifest",
        path.join(batchRoot, `${batchId}.candidate.manifest.json`),
        "-allow-pending",
      ],
      {
        cwd: gatewayRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GOCACHE: path.resolve(".gocache"),
          TEMP: path.resolve(".tmp"),
          TMP: path.resolve(".tmp"),
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    if (result.status !== 0) throw new Error(`${batchId}: Go decision audit failed: ${result.stderr}`);
    JSON.parse(result.stdout);
    writeFileSync(path.join(batchRoot, `${batchId}.go-audit.json`), `${result.stdout.trimEnd()}\n`, "utf8");
  }
}

function groupBy(values, selector) {
  const result = new Map();
  for (const value of values) {
    const key = selector(value);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(value);
  }
  return result;
}

function counts(values, selector) {
  return Object.fromEntries([...groupBy(values, selector)].map(([key, rows]) => [key, rows.length]).sort(([a], [b]) => String(a).localeCompare(String(b))));
}

function instructionOnly(prompt) {
  return prompt.replace(/```[\s\S]*?```/gu, " ");
}

function normalizedText(prompt) {
  return instructionOnly(prompt)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\d+/gu, "<n>")
    .replace(/[^\p{L}\p{N}_<>]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(value.split(" ").filter((token) => token.length > 1));
}

function gramSet(value, size = 4) {
  const compact = value.replace(/\s+/gu, "");
  const result = new Set();
  for (let index = 0; index <= compact.length - size; index++) result.add(compact.slice(index, index + size));
  return result;
}

function intersectionSize(left, right) {
  let count = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) if (large.has(value)) count++;
  return count;
}

function jaccard(left, right) {
  const intersection = intersectionSize(left, right);
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function dice(left, right) {
  return (2 * intersectionSize(left, right)) / Math.max(1, left.size + right.size);
}

function partitionKind(record) {
  return record.partitionRole ?? record.partition ?? "unknown";
}

function pairType(left, right) {
  if (left.sourceKind === "existing" || right.sourceKind === "existing") return "new_vs_existing";
  return partitionKind(left) === partitionKind(right) ? "within_partition" : "cross_partition";
}

function nearDuplicateReport(allRows) {
  const candidates = [];
  const strictLeakage = [];
  const groups = groupBy(allRows, (row) => `${row.expectedSemanticLabel}\u0000${row.language}`);
  for (const rows of groups.values()) {
    const prepared = rows.map((row) => {
      const normalized = normalizedText(row.redactedPrompt);
      return { row, normalized, tokens: tokenSet(normalized), grams: gramSet(normalized) };
    });
    for (let leftIndex = 0; leftIndex < prepared.length; leftIndex++) {
      const left = prepared[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex++) {
        const right = prepared[rightIndex];
        if (left.row.promptFamily === right.row.promptFamily) continue;
        if (left.row.sourceKind === "existing" && right.row.sourceKind === "existing") continue;
        const tokenScore = jaccard(left.tokens, right.tokens);
        if (tokenScore < 0.55) continue;
        const charScore = dice(left.grams, right.grams);
        const item = {
          leftSampleId: left.row.sampleId,
          leftFamily: left.row.promptFamily,
          leftPartition: partitionKind(left.row),
          rightSampleId: right.row.sampleId,
          rightFamily: right.row.promptFamily,
          rightPartition: partitionKind(right.row),
          semanticLabel: left.row.expectedSemanticLabel,
          language: left.row.language,
          pairType: pairType(left.row, right.row),
          tokenJaccard: Number(tokenScore.toFixed(4)),
          charFourGramDice: Number(charScore.toFixed(4)),
        };
        if (tokenScore >= 0.72 || charScore >= 0.86) candidates.push(item);
        if (tokenScore >= 0.88 || charScore >= 0.94) strictLeakage.push(item);
      }
    }
  }
  candidates.sort((left, right) => Math.max(right.tokenJaccard, right.charFourGramDice) - Math.max(left.tokenJaccard, left.charFourGramDice));
  strictLeakage.sort((left, right) => Math.max(right.tokenJaccard, right.charFourGramDice) - Math.max(left.tokenJaccard, left.charFourGramDice));
  return { candidates, strictLeakage };
}

function semanticLoad(record) {
  const weight = (value) => /3_plus|4_plus|depth_3_plus/u.test(value) ? 2 : /count_2|2_to_3|depth_2/u.test(value) ? 1 : 0;
  return weight(record.taskBucket) + weight(record.constraintBucket) + weight(record.scopeBucket) + weight(record.dependencyBucket);
}

function main() {
  const failures = [];
  const batchData = [];
  const familyOwners = new Map();
  const exactPrompts = new Map();
  const newRows = [];

  for (const batchId of batchIds) {
    const datasetFile = path.join(root, batchId, `${batchId}.candidate.jsonl`);
    const manifestFile = path.join(root, batchId, `${batchId}.candidate.manifest.json`);
    const auditFile = path.join(root, batchId, `${batchId}.go-audit.json`);
    const datasetBytes = readFileSync(datasetFile);
    const records = parseJsonl(datasetFile);
    const manifest = parseJson(manifestFile);
    const audit = parseJson(auditFile);
    const schemaFailures = [
      ...verifyDifficultyLabelRecords(records),
      ...verifyDifficultyLabelDatasetManifest(manifest, { manifestPath: `${batchId} candidate manifest` }),
    ];
    if (schemaFailures.length > 0) failures.push(...schemaFailures.map((failure) => `${batchId}: ${failure}`));
    if (manifest.datasetSha256 !== sha256(datasetBytes)) failures.push(`${batchId}: manifest hash mismatch`);
    if (audit.datasetSha256 !== manifest.datasetSha256) failures.push(`${batchId}: Go audit hash mismatch`);
    if (audit.totalRecords !== records.length || audit.modelPathRecords !== records.length || audit.hardSentinelRecords !== 0 || audit.simpleSentinelRecords !== 0 || audit.semanticStatusRouteMismatches !== 0) {
      failures.push(`${batchId}: actual Go route gate failed`);
    }
    const familyRows = groupBy(records, (record) => record.promptFamily);
    for (const family of familyRows.keys()) {
      const previous = familyOwners.get(family);
      if (previous) failures.push(`${batchId}: family ${family} also appears in ${previous}`);
      familyOwners.set(family, batchId);
    }
    for (const record of records) {
      const key = record.redactedPrompt.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
      const previous = exactPrompts.get(key);
      if (previous && previous.promptFamily !== record.promptFamily) failures.push(`${batchId}: exact duplicate ${previous.sampleId}/${record.sampleId}`);
      exactPrompts.set(key, record);
      newRows.push({ ...record, batchId, partitionRole: batchId.startsWith("t") ? "train" : batchId.startsWith("c") ? "calibration" : batchId.startsWith("e") ? "evaluation" : "promotion", sourceKind: "new" });
    }
    const mismatches = audit.evidenceRecords.filter((row) => row.expectedCategory !== row.actualCategory);
    batchData.push({ batchId, records, manifest, audit, mismatches });
  }

  const existingRows = [];
  for (const [datasetFile, manifestFile] of existingSources) {
    const records = parseJsonl(datasetFile);
    const manifest = parseJson(manifestFile);
    const partitionByFamily = new Map(manifest.families.map((family) => [family.promptFamily, family.partition]));
    for (const record of records) {
      if (familyOwners.has(record.promptFamily)) failures.push(`existing family collision: ${record.promptFamily}`);
      const key = record.redactedPrompt.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
      const previous = exactPrompts.get(key);
      if (previous && previous.promptFamily !== record.promptFamily) failures.push(`new/existing exact duplicate: ${previous.sampleId}/${record.sampleId}`);
      exactPrompts.set(key, record);
      existingRows.push({ ...record, partition: partitionByFamily.get(record.promptFamily), sourceKind: "existing" });
    }
  }

  const near = nearDuplicateReport([...existingRows, ...newRows]);
  const crossPartitionStrict = near.strictLeakage.filter((item) => item.pairType === "cross_partition" || item.pairType === "new_vs_existing");
  const simpleRows = newRows.filter((record) => record.expectedDifficulty === "simple");
  const complexRows = newRows.filter((record) => record.expectedDifficulty === "complex");
  const simpleStrong = simpleRows.filter((record) => [record.taskBucket, record.constraintBucket, record.scopeBucket, record.dependencyBucket].some((value) => /3_plus|4_plus|depth_3_plus/u.test(value)));
  const simpleOverloaded = simpleRows.filter((record) => semanticLoad(record) > 1);
  const complexUnderloaded = complexRows.filter((record) => semanticLoad(record) < 2);
  if (simpleStrong.length > 0) failures.push(`simple records with strong semantic bucket: ${simpleStrong.length}`);
  if (simpleOverloaded.length > 0) failures.push(`simple records with more than one moderate-equivalent semantic signal: ${simpleOverloaded.length}`);
  if (complexUnderloaded.length > 0) failures.push(`complex records with semantic load below two: ${complexUnderloaded.length}`);
  if (crossPartitionStrict.length > 0) failures.push(`strict cross-partition/new-existing near-duplicate leakage candidates: ${crossPartitionStrict.length}`);

  const forbiddenPatterns = [
    /\bsk-[a-z0-9_-]{8,}\b/iu,
    /authorization\s*:/iu,
    /api[_ -]?key\s*[:=]\s*\S+/iu,
    /-----begin [a-z ]*private key-----/iu,
    /\b\d{3}-\d{2}-\d{4}\b/u,
  ];
  const securityHits = newRows.filter((record) => forbiddenPatterns.some((pattern) => pattern.test(record.redactedPrompt)));
  if (securityHits.length > 0) failures.push(`forbidden synthetic-data security pattern hits: ${securityHits.length}`);

  for (const batch of batchData) {
    const batchPairs = near.candidates.filter((item) => item.leftSampleId.includes(`_${batch.batchId}_`) || item.rightSampleId.includes(`_${batch.batchId}_`));
    const strictPairs = near.strictLeakage.filter((item) => item.leftSampleId.includes(`_${batch.batchId}_`) || item.rightSampleId.includes(`_${batch.batchId}_`));
    const report = {
      schemaVersion: "gatelm.difficulty-batch-verification.v1",
      batchId: batch.batchId,
      datasetSha256: batch.manifest.datasetSha256,
      gates: {
        schemaFailures: 0,
        exactDuplicates: 0,
        familyCollisions: 0,
        splitLeakage: strictPairs.filter((item) => item.pairType === "cross_partition").length,
        actualGoModelPathRecords: batch.audit.modelPathRecords,
        actualGoHardSentinelRecords: batch.audit.hardSentinelRecords,
        actualGoSimpleSentinelRecords: batch.audit.simpleSentinelRecords,
        semanticStatusRouteMismatches: batch.audit.semanticStatusRouteMismatches,
        categoryClassifierMismatches: batch.mismatches.length,
        nearDuplicateCandidates: batchPairs.length,
        strictNearDuplicateCandidates: strictPairs.length,
        humanReviewStatus: "pending",
        ownerApprovalStatus: "pending",
      },
      categoryMismatchByExpectedActual: counts(batch.mismatches, (row) => `${row.expectedCategory}->${row.actualCategory}`),
      categoryMismatchBySlice: Object.fromEntries(["negation", "indirect_expression", "synonym", "short_complex", "long_simple", "payload_contamination", "category_confusion", "ood_terminology"].map((slice) => [slice, batch.mismatches.filter((row) => row.evaluationSlices.includes(slice)).length])),
      distributions: parseJson(path.join(root, batch.batchId, `${batch.batchId}.generation-report.json`)).distributions,
    };
    writeOrCheck(path.join(root, batch.batchId, `${batch.batchId}.verification-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  }

  const nearReport = {
    schemaVersion: "gatelm.difficulty-near-duplicate-report.v1",
    method: {
      grouping: "same expectedSemanticLabel and language",
      payloadHandling: "explicit fenced payload removed before comparison",
      normalization: "NFKC, lowercase, numbers replaced, punctuation collapsed",
      candidateThreshold: "token Jaccard >= 0.72 or character four-gram Dice >= 0.86 after token prefilter >= 0.55",
      strictLeakageThreshold: "token Jaccard >= 0.88 or character four-gram Dice >= 0.94",
    },
    counts: {
      candidates: near.candidates.length,
      strictCandidates: near.strictLeakage.length,
      strictCrossPartitionOrExisting: crossPartitionStrict.length,
    },
    strictCandidates: near.strictLeakage,
    candidates: near.candidates,
  };
  writeOrCheck(path.join(root, "near-duplicate-report.json"), `${JSON.stringify(nearReport, null, 2)}\n`);

  const summary = {
    schemaVersion: "gatelm.difficulty-expansion-verification-summary.v1",
    status: failures.length === 0 ? "passed" : "failed",
    counts: {
      records: newRows.length,
      families: familyOwners.size,
      batches: batchData.length,
      modelPath: batchData.reduce((sum, batch) => sum + batch.audit.modelPathRecords, 0),
      hardSentinel: batchData.reduce((sum, batch) => sum + batch.audit.hardSentinelRecords, 0),
      simpleSentinel: batchData.reduce((sum, batch) => sum + batch.audit.simpleSentinelRecords, 0),
      categoryClassifierMismatches: batchData.reduce((sum, batch) => sum + batch.mismatches.length, 0),
      exactDuplicates: 0,
      familyCollisions: 0,
      strictCrossPartitionOrExistingNearDuplicates: crossPartitionStrict.length,
      broadNearDuplicateCandidates: near.candidates.length,
      simpleStrongBucketConflicts: simpleStrong.length,
      simpleOverloadedBucketConflicts: simpleOverloaded.length,
      complexUnderloadedBucketConflicts: complexUnderloaded.length,
      securityPatternHits: securityHits.length,
    },
    failures,
    batchReports: batchIds.map((batchId) => `docs/v2.1.0/reviews/difficulty-model-path-expansion-3120/${batchId}/${batchId}.verification-report.json`),
    nearDuplicateReport: "docs/v2.1.0/reviews/difficulty-model-path-expansion-3120/near-duplicate-report.json",
  };
  writeOrCheck(path.join(root, "verification-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary.counts));
  if (failures.length > 0) throw new Error(`difficulty expansion verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

if (refreshGoAuditsRequested) refreshGoAudits();
main();
