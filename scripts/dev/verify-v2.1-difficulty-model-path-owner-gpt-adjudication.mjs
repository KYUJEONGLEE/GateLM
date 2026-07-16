import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

const reviewRoot = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const importRoot = path.join(reviewRoot, "owner-gpt-adjudication-review");
const proposedRoot = path.join(importRoot, "proposed");
const batchIds = ["t1", "t2", "t3", "t4", "c1", "c2", "e1", "e2", "p1"];
const checkOnly = process.argv.includes("--check");
const refreshGoAuditsRequested = process.argv.includes("--refresh-go-audits");
const existingSources = [
  ["docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl", "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json"],
  ["docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.jsonl", "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.manifest.json"],
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const parseJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
const parseJsonl = (filePath) => readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
const jsonl = (records) => (records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "");

function writeOrCheck(filePath, contents) {
  if (checkOnly) {
    if (readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "") !== contents) throw new Error(`${filePath}: owner GPT final verification artifact drifted`);
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function groupBy(values, selector) {
  const grouped = new Map();
  for (const value of values) {
    const key = selector(value);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  return grouped;
}

function counts(values, selector) {
  return Object.fromEntries([...groupBy(values, selector)]
    .map(([key, rows]) => [key, rows.length])
    .sort(([left], [right]) => String(left).localeCompare(String(right))));
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

function exactText(prompt) {
  return prompt.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function tokenSet(value) {
  return new Set(value.split(" ").filter((token) => token.length > 1));
}

function gramSet(value, size = 4) {
  const compact = value.replace(/\s+/gu, "");
  const result = new Set();
  for (let index = 0; index <= compact.length - size; index += 1) result.add(compact.slice(index, index + size));
  return result;
}

function intersectionSize(left, right) {
  let count = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) if (large.has(value)) count += 1;
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
      return { row, tokens: tokenSet(normalized), grams: gramSet(normalized) };
    });
    for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
      const left = prepared[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
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
  const score = (item) => Math.max(item.tokenJaccard, item.charFourGramDice);
  candidates.sort((left, right) => score(right) - score(left));
  strictLeakage.sort((left, right) => score(right) - score(left));
  return { candidates, strictLeakage };
}

function semanticLoad(record) {
  const weight = (value) => (/3_plus|4_plus|depth_3_plus/u.test(value) ? 2 : /count_2|2_to_3|depth_2/u.test(value) ? 1 : 0);
  return weight(record.taskBucket) + weight(record.constraintBucket) + weight(record.scopeBucket) + weight(record.dependencyBucket);
}

function partitionRole(batchId) {
  if (batchId.startsWith("t")) return "train";
  if (batchId.startsWith("c")) return "calibration";
  if (batchId.startsWith("e")) return "evaluation";
  return "promotion";
}

function refreshGoAudits() {
  if (checkOnly) throw new Error("--check and --refresh-go-audits cannot be combined");
  const gatewayRoot = path.resolve("apps/gateway-core");
  const cacheRoot = path.resolve(".gocache");
  const tempRoot = path.resolve(".tmp");
  mkdirSync(cacheRoot, { recursive: true });
  mkdirSync(tempRoot, { recursive: true });
  for (const batchId of batchIds) {
    const datasetPath = path.join(proposedRoot, `${batchId}.owner-gpt-recommended.candidate.jsonl`);
    const manifestPath = path.join(proposedRoot, `${batchId}.owner-gpt-recommended.go-audit-manifest.json`);
    const result = spawnSync(
      "go",
      ["run", "./cmd/difficulty-decision-audit", "-dataset", datasetPath, "-manifest", manifestPath, "-allow-pending"],
      {
        cwd: gatewayRoot,
        encoding: "utf8",
        env: { ...process.env, GOCACHE: cacheRoot, TEMP: tempRoot, TMP: tempRoot },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    if (result.status !== 0) throw new Error(`${batchId}: owner GPT final Go audit failed: ${result.stderr}`);
    JSON.parse(result.stdout);
    writeFileSync(path.join(proposedRoot, `${batchId}.owner-gpt-recommended.go-audit.json`), `${result.stdout.trimEnd()}\n`, "utf8");
  }
}

function main() {
  const failures = [];
  const gateQueue = [];
  const familyOwners = new Map();
  const exactPrompts = new Map();
  const finalRows = [];
  const batches = [];

  for (const batchId of batchIds) {
    const datasetPath = path.join(proposedRoot, `${batchId}.owner-gpt-recommended.candidate.jsonl`);
    const manifestPath = path.join(proposedRoot, `${batchId}.owner-gpt-recommended.go-audit-manifest.json`);
    const auditPath = path.join(proposedRoot, `${batchId}.owner-gpt-recommended.go-audit.json`);
    if (!existsSync(auditPath)) throw new Error(`${auditPath}: missing; run with --refresh-go-audits`);
    const datasetBytes = readFileSync(datasetPath);
    const records = parseJsonl(datasetPath);
    const manifest = parseJson(manifestPath);
    const audit = parseJson(auditPath);
    const schemaFailures = verifyDifficultyLabelRecords(records);
    failures.push(...schemaFailures.map((failure) => `${batchId}: ${failure}`));
    if (manifest.datasetSha256 !== sha256(datasetBytes)) failures.push(`${batchId}: final manifest hash mismatch`);
    if (audit.datasetSha256 !== manifest.datasetSha256) failures.push(`${batchId}: final Go audit hash mismatch`);
    if (audit.totalRecords !== records.length || audit.modelPathRecords !== records.length || audit.hardSentinelRecords !== 0 || audit.simpleSentinelRecords !== 0 || audit.semanticStatusRouteMismatches !== 0) {
      failures.push(`${batchId}: final actual Go model-path gate failed`);
      for (const evidence of audit.evidenceRecords.filter((record) => record.route !== "model")) {
        gateQueue.push({ type: "go_route", batchId, sampleId: evidence.sampleId, promptFamily: evidence.familyId, evidence });
      }
    }
    const familyRows = groupBy(records, (record) => record.promptFamily);
    for (const [family, rows] of familyRows) {
      const previous = familyOwners.get(family);
      if (previous) failures.push(`${batchId}: final family ${family} also appears in ${previous}`);
      familyOwners.set(family, batchId);
      if (new Set(rows.map((row) => `${row.expectedCategory}\u0000${row.expectedSemanticLabel}`)).size !== 1) {
        failures.push(`${batchId}: final family ${family} has inconsistent category/semantic labels`);
        gateQueue.push({ type: "family_label_inconsistency", batchId, promptFamily: family, sampleIds: rows.map((row) => row.sampleId) });
      }
    }
    for (const record of records) {
      const key = exactText(record.redactedPrompt);
      const previous = exactPrompts.get(key);
      if (previous && previous.promptFamily !== record.promptFamily) {
        failures.push(`${batchId}: final exact duplicate ${previous.sampleId}/${record.sampleId}`);
        gateQueue.push({ type: "exact_duplicate", batchId, sampleId: record.sampleId, promptFamily: record.promptFamily, otherSampleId: previous.sampleId, otherFamily: previous.promptFamily });
      }
      exactPrompts.set(key, record);
      finalRows.push({ ...record, batchId, partitionRole: partitionRole(batchId), sourceKind: "new" });
    }
    const categoryMismatches = audit.evidenceRecords.filter((record) => record.expectedCategory !== record.actualCategory);
    batches.push({ batchId, records, audit, categoryMismatches, schemaFailures });
  }

  const existingRows = [];
  for (const [datasetFile, manifestFile] of existingSources) {
    const records = parseJsonl(path.resolve(datasetFile));
    const manifest = parseJson(path.resolve(manifestFile));
    const partitionByFamily = new Map(manifest.families.map((family) => [family.promptFamily, family.partition]));
    for (const record of records) {
      if (familyOwners.has(record.promptFamily)) failures.push(`existing/final family collision: ${record.promptFamily}`);
      const key = exactText(record.redactedPrompt);
      const previous = exactPrompts.get(key);
      if (previous && previous.promptFamily !== record.promptFamily) {
        failures.push(`final/existing exact duplicate: ${previous.sampleId}/${record.sampleId}`);
        gateQueue.push({ type: "existing_exact_duplicate", sampleId: previous.sampleId, promptFamily: previous.promptFamily, otherSampleId: record.sampleId, otherFamily: record.promptFamily });
      }
      exactPrompts.set(key, record);
      existingRows.push({ ...record, partition: partitionByFamily.get(record.promptFamily), sourceKind: "existing" });
    }
  }

  const near = nearDuplicateReport([...existingRows, ...finalRows]);
  const strictCrossPartitionOrExisting = near.strictLeakage.filter((item) => item.pairType === "cross_partition" || item.pairType === "new_vs_existing");
  if (strictCrossPartitionOrExisting.length > 0) {
    failures.push(`final strict cross-partition/new-existing near-duplicate leakage candidates: ${strictCrossPartitionOrExisting.length}`);
    gateQueue.push(...strictCrossPartitionOrExisting.map((item) => ({ type: "strict_split_or_existing_near_duplicate", ...item })));
  }
  const simpleRows = finalRows.filter((record) => record.expectedDifficulty === "simple");
  const complexRows = finalRows.filter((record) => record.expectedDifficulty === "complex");
  const simpleStrong = simpleRows.filter((record) => [record.taskBucket, record.constraintBucket, record.scopeBucket, record.dependencyBucket].some((value) => /3_plus|4_plus|depth_3_plus/u.test(value)));
  const simpleOverloaded = simpleRows.filter((record) => semanticLoad(record) > 1);
  const complexUnderloaded = complexRows.filter((record) => semanticLoad(record) < 2);
  const heuristicSignals = [
    ...simpleStrong.map((record) => ({ type: "simple_strong_bucket_heuristic", batchId: record.batchId, sampleId: record.sampleId, promptFamily: record.promptFamily })),
    ...simpleOverloaded.map((record) => ({ type: "simple_overloaded_bucket_heuristic", batchId: record.batchId, sampleId: record.sampleId, promptFamily: record.promptFamily })),
    ...complexUnderloaded.map((record) => ({ type: "complex_underloaded_bucket_heuristic", batchId: record.batchId, sampleId: record.sampleId, promptFamily: record.promptFamily })),
  ];
  const forbiddenPatterns = [
    /\bsk-[a-z0-9_-]{8,}\b/iu,
    /authorization\s*:/iu,
    /api[_ -]?key\s*[:=]\s*\S+/iu,
    /-----begin [a-z ]*private key-----/iu,
    /\b\d{3}-\d{2}-\d{4}\b/u,
  ];
  const securityHits = finalRows.filter((record) => forbiddenPatterns.some((pattern) => pattern.test(record.redactedPrompt)));
  if (securityHits.length > 0) failures.push(`final forbidden synthetic-data security pattern hits: ${securityHits.length}`);
  gateQueue.push(...securityHits.map((record) => ({ type: "security_pattern", batchId: record.batchId, sampleId: record.sampleId, promptFamily: record.promptFamily })));

  for (const batch of batches) {
    const batchNear = near.candidates.filter((item) => item.leftSampleId.includes(`_${batch.batchId}_`) || item.rightSampleId.includes(`_${batch.batchId}_`));
    const batchStrict = near.strictLeakage.filter((item) => item.leftSampleId.includes(`_${batch.batchId}_`) || item.rightSampleId.includes(`_${batch.batchId}_`));
    const report = {
      schemaVersion: "gatelm.difficulty-owner-gpt-final-batch-verification.v1",
      batchId: batch.batchId,
      records: batch.records.length,
      families: new Set(batch.records.map((record) => record.promptFamily)).size,
      gates: {
        schemaFailures: batch.schemaFailures.length,
        actualGoModelPathRecords: batch.audit.modelPathRecords,
        actualGoHardSentinelRecords: batch.audit.hardSentinelRecords,
        actualGoSimpleSentinelRecords: batch.audit.simpleSentinelRecords,
        semanticStatusRouteMismatches: batch.audit.semanticStatusRouteMismatches,
        categoryClassifierMismatches: batch.categoryMismatches.length,
        nearDuplicateCandidates: batchNear.length,
        strictNearDuplicateCandidates: batchStrict.length,
        humanOwnerConfirmationStatus: "pending",
      },
      distributions: {
        category: counts(batch.records, (record) => record.expectedCategory),
        difficulty: counts(batch.records, (record) => record.expectedDifficulty),
        language: counts(batch.records, (record) => record.language),
        semanticLabel: counts(batch.records, (record) => record.expectedSemanticLabel),
        slices: counts(batch.records.flatMap((record) => record.evaluationSlices), (slice) => slice),
        taskBucket: counts(batch.records, (record) => record.taskBucket),
        constraintBucket: counts(batch.records, (record) => record.constraintBucket),
        scopeBucket: counts(batch.records, (record) => record.scopeBucket),
        dependencyBucket: counts(batch.records, (record) => record.dependencyBucket),
      },
    };
    writeOrCheck(path.join(proposedRoot, `${batch.batchId}.owner-gpt-recommended.verification-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  }

  const nearReport = {
    schemaVersion: "gatelm.difficulty-owner-gpt-final-near-duplicate-report.v1",
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
      strictCrossPartitionOrExisting: strictCrossPartitionOrExisting.length,
    },
    strictCandidates: near.strictLeakage,
    candidates: near.candidates,
  };
  writeOrCheck(path.join(importRoot, "final-near-duplicate-report.json"), `${JSON.stringify(nearReport, null, 2)}\n`);

  const importSummary = parseJson(path.join(importRoot, "import-summary.json"));
  const summary = {
    schemaVersion: "gatelm.difficulty-owner-gpt-final-verification-summary.v1",
    status: failures.length === 0 ? "validated_pending_human_owner_confirmation" : "failed_pending_correction",
    counts: {
      records: finalRows.length,
      families: familyOwners.size,
      batches: batches.length,
      modelPath: batches.reduce((sum, batch) => sum + batch.audit.modelPathRecords, 0),
      hardSentinel: batches.reduce((sum, batch) => sum + batch.audit.hardSentinelRecords, 0),
      simpleSentinel: batches.reduce((sum, batch) => sum + batch.audit.simpleSentinelRecords, 0),
      categoryClassifierMismatches: batches.reduce((sum, batch) => sum + batch.categoryMismatches.length, 0),
      exactDuplicates: failures.filter((failure) => failure.includes("exact duplicate")).length,
      familyCollisions: failures.filter((failure) => failure.includes("family collision") || failure.includes("also appears")).length,
      broadNearDuplicateCandidates: near.candidates.length,
      strictNearDuplicateCandidates: near.strictLeakage.length,
      strictCrossPartitionOrExistingNearDuplicates: strictCrossPartitionOrExisting.length,
      simpleStrongBucketHeuristicSignals: simpleStrong.length,
      simpleOverloadedBucketHeuristicSignals: simpleOverloaded.length,
      complexUnderloadedBucketHeuristicSignals: complexUnderloaded.length,
      securityPatternHits: securityHits.length,
      customPromptsActuallyRechecked: importSummary.totals.localGoRechecks,
    },
    failures,
    humanOwnerConfirmationStatus: "pending",
    trainingEligible: false,
    promotionHoldoutUse: "label_review_only_no_model_or_threshold_selection",
  };
  writeOrCheck(path.join(importRoot, "final-verification-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeOrCheck(path.join(importRoot, "gate-correction-queue.jsonl"), jsonl(gateQueue));
  writeOrCheck(path.join(importRoot, "semantic-load-heuristic-review-signals.jsonl"), jsonl(heuristicSignals));

  const confirmationGuide = [
    "# Final human owner confirmation",
    "",
    `- Verification status: ${summary.status}`,
    `- Recommended records/families: ${summary.counts.records}/${summary.counts.families}`,
    `- Actual Go model path: ${summary.counts.modelPath}/${summary.counts.records}`,
    `- Hard/simple sentinels: ${summary.counts.hardSentinel}/${summary.counts.simpleSentinel}`,
    `- Exact duplicates / family collisions: ${summary.counts.exactDuplicates}/${summary.counts.familyCollisions}`,
    `- Strict cross-partition or existing-data near duplicates: ${summary.counts.strictCrossPartitionOrExistingNearDuplicates}`,
    `- Broad near-duplicate candidates (reported, not automatically rejected): ${summary.counts.broadNearDuplicateCandidates}`,
    `- Non-contract semantic-load heuristic signals: ${summary.counts.simpleStrongBucketHeuristicSignals + summary.counts.simpleOverloadedBucketHeuristicSignals + summary.counts.complexUnderloadedBucketHeuristicSignals} (reported only; the label guide forbids deriving difficulty by bucket sum)`,
    `- Security-pattern hits: ${summary.counts.securityPatternHits}`,
    `- New custom prompts rechecked locally: ${summary.counts.customPromptsActuallyRechecked}`,
    "- P1 was used for label review only; no model or threshold selection was performed.",
    "- Current candidate and owner-approved datasets remain unchanged. All recommendations remain pending and training-ineligible.",
    "",
    failures.length === 0
      ? "All technical gates passed. A human owner may now approve or reject the complete 3,120-record recommendation set in one decision."
      : `Technical gates did not pass. Resolve the ${gateQueue.length} queued gate findings before approval.`,
    "",
  ].join("\n");
  writeOrCheck(path.join(importRoot, "FINAL-HUMAN-OWNER-CONFIRMATION.md"), confirmationGuide);
  writeOrCheck(path.join(importRoot, "FINAL-HUMAN-OWNER-DECISION-TEMPLATE.json"), `${JSON.stringify({
    schemaVersion: "gatelm.difficulty-human-owner-final-decision.v1",
    decision: "pending",
    scope: { records: finalRows.length, families: familyOwners.size, batches: batchIds },
    verifiedDatasetSha256ByBatch: Object.fromEntries(batchIds.map((batchId) => [batchId, parseJson(path.join(proposedRoot, `${batchId}.owner-gpt-recommended.go-audit-manifest.json`)).datasetSha256])),
    confirmations: {
      actualGoModelPathAllRecords: summary.counts.modelPath === finalRows.length,
      exactDuplicatesZero: summary.counts.exactDuplicates === 0,
      familyCollisionsZero: summary.counts.familyCollisions === 0,
      strictSplitOrExistingLeakageZero: summary.counts.strictCrossPartitionOrExistingNearDuplicates === 0,
      difficultyNotDerivedFromBucketSum: true,
      securityPatternHitsZero: summary.counts.securityPatternHits === 0,
      promotionHoldoutLabelReviewOnly: true,
    },
    ownerNote: "",
  }, null, 2)}\n`);

  console.log(JSON.stringify(summary.counts));
  if (failures.length > 0) throw new Error(`owner GPT final verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

if (refreshGoAuditsRequested) refreshGoAudits();
main();
