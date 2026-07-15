import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { verifyDifficultyLabelRecords } from "../verify-v2.1-difficulty-eval.mjs";

const reviewRoot = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const importRoot = path.join(reviewRoot, "independent-gpt-review");
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
    if (readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "") !== contents) {
      throw new Error(`${filePath}: independent GPT proposed verification artifact drifted`);
    }
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
  return Object.fromEntries(
    [...groupBy(values, selector)]
      .map(([key, rows]) => [key, rows.length])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
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
    const datasetPath = path.join(proposedRoot, `${batchId}.independent-gpt-proposed.candidate.jsonl`);
    const manifestPath = path.join(proposedRoot, `${batchId}.independent-gpt-proposed.go-audit-manifest.json`);
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
    if (result.status !== 0) throw new Error(`${batchId}: proposed Go decision audit failed: ${result.stderr}`);
    JSON.parse(result.stdout);
    writeFileSync(path.join(proposedRoot, `${batchId}.independent-gpt-proposed.go-audit.json`), `${result.stdout.trimEnd()}\n`, "utf8");
  }
}

function main() {
  const failures = [];
  const familyOwners = new Map();
  const exactPrompts = new Map();
  const proposedRows = [];
  const batches = [];

  for (const batchId of batchIds) {
    const datasetPath = path.join(proposedRoot, `${batchId}.independent-gpt-proposed.candidate.jsonl`);
    const manifestPath = path.join(proposedRoot, `${batchId}.independent-gpt-proposed.go-audit-manifest.json`);
    const auditPath = path.join(proposedRoot, `${batchId}.independent-gpt-proposed.go-audit.json`);
    if (!existsSync(auditPath)) throw new Error(`${auditPath}: missing; run with --refresh-go-audits`);
    const datasetBytes = readFileSync(datasetPath);
    const records = parseJsonl(datasetPath);
    const manifest = parseJson(manifestPath);
    const audit = parseJson(auditPath);
    const schemaFailures = verifyDifficultyLabelRecords(records);
    failures.push(...schemaFailures.map((failure) => `${batchId}: ${failure}`));
    if (manifest.datasetSha256 !== sha256(datasetBytes)) failures.push(`${batchId}: proposed manifest hash mismatch`);
    if (audit.datasetSha256 !== manifest.datasetSha256) failures.push(`${batchId}: proposed Go audit hash mismatch`);
    if (audit.totalRecords !== records.length || audit.modelPathRecords !== records.length || audit.hardSentinelRecords !== 0 || audit.simpleSentinelRecords !== 0 || audit.semanticStatusRouteMismatches !== 0) {
      failures.push(`${batchId}: proposed actual Go model-path gate failed`);
    }
    const familyRows = groupBy(records, (record) => record.promptFamily);
    for (const [family, rows] of familyRows) {
      const previous = familyOwners.get(family);
      if (previous) failures.push(`${batchId}: proposed family ${family} also appears in ${previous}`);
      familyOwners.set(family, batchId);
      if (new Set(rows.map((row) => `${row.expectedCategory}\u0000${row.expectedSemanticLabel}`)).size !== 1) {
        failures.push(`${batchId}: proposed family ${family} has inconsistent category/semantic labels`);
      }
    }
    for (const record of records) {
      const key = exactText(record.redactedPrompt);
      const previous = exactPrompts.get(key);
      if (previous && previous.promptFamily !== record.promptFamily) failures.push(`${batchId}: proposed exact duplicate ${previous.sampleId}/${record.sampleId}`);
      exactPrompts.set(key, record);
      proposedRows.push({ ...record, batchId, partitionRole: partitionRole(batchId), sourceKind: "new" });
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
      if (familyOwners.has(record.promptFamily)) failures.push(`existing/proposed family collision: ${record.promptFamily}`);
      const key = exactText(record.redactedPrompt);
      const previous = exactPrompts.get(key);
      if (previous && previous.promptFamily !== record.promptFamily) failures.push(`proposed/existing exact duplicate: ${previous.sampleId}/${record.sampleId}`);
      exactPrompts.set(key, record);
      existingRows.push({ ...record, partition: partitionByFamily.get(record.promptFamily), sourceKind: "existing" });
    }
  }

  const near = nearDuplicateReport([...existingRows, ...proposedRows]);
  const strictCrossPartitionOrExisting = near.strictLeakage.filter((item) => item.pairType === "cross_partition" || item.pairType === "new_vs_existing");
  if (strictCrossPartitionOrExisting.length > 0) failures.push(`proposed strict cross-partition/new-existing near-duplicate leakage candidates: ${strictCrossPartitionOrExisting.length}`);
  const simpleRows = proposedRows.filter((record) => record.expectedDifficulty === "simple");
  const complexRows = proposedRows.filter((record) => record.expectedDifficulty === "complex");
  const simpleStrong = simpleRows.filter((record) => [record.taskBucket, record.constraintBucket, record.scopeBucket, record.dependencyBucket].some((value) => /3_plus|4_plus|depth_3_plus/u.test(value)));
  const simpleOverloaded = simpleRows.filter((record) => semanticLoad(record) > 1);
  const complexUnderloaded = complexRows.filter((record) => semanticLoad(record) < 2);
  const forbiddenPatterns = [
    /\bsk-[a-z0-9_-]{8,}\b/iu,
    /authorization\s*:/iu,
    /api[_ -]?key\s*[:=]\s*\S+/iu,
    /-----begin [a-z ]*private key-----/iu,
    /\b\d{3}-\d{2}-\d{4}\b/u,
  ];
  const securityHits = proposedRows.filter((record) => forbiddenPatterns.some((pattern) => pattern.test(record.redactedPrompt)));
  if (securityHits.length > 0) failures.push(`proposed forbidden synthetic-data security pattern hits: ${securityHits.length}`);

  for (const batch of batches) {
    const batchNear = near.candidates.filter((item) => item.leftSampleId.includes(`_${batch.batchId}_`) || item.rightSampleId.includes(`_${batch.batchId}_`));
    const batchStrict = near.strictLeakage.filter((item) => item.leftSampleId.includes(`_${batch.batchId}_`) || item.rightSampleId.includes(`_${batch.batchId}_`));
    const report = {
      schemaVersion: "gatelm.difficulty-independent-gpt-proposed-batch-verification.v1",
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
        ownerApprovalStatus: "pending",
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
    writeOrCheck(path.join(proposedRoot, `${batch.batchId}.independent-gpt-proposed.verification-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  }

  const nearReport = {
    schemaVersion: "gatelm.difficulty-independent-gpt-proposed-near-duplicate-report.v1",
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
  writeOrCheck(path.join(importRoot, "proposed-near-duplicate-report.json"), `${JSON.stringify(nearReport, null, 2)}\n`);

  const summary = {
    schemaVersion: "gatelm.difficulty-independent-gpt-proposed-verification-summary.v1",
    status: failures.length === 0 ? "passed_pending_owner_approval" : "failed_pending_owner_adjudication",
    counts: {
      records: proposedRows.length,
      families: familyOwners.size,
      batches: batches.length,
      modelPath: batches.reduce((sum, batch) => sum + batch.audit.modelPathRecords, 0),
      hardSentinel: batches.reduce((sum, batch) => sum + batch.audit.hardSentinelRecords, 0),
      simpleSentinel: batches.reduce((sum, batch) => sum + batch.audit.simpleSentinelRecords, 0),
      categoryClassifierMismatches: batches.reduce((sum, batch) => sum + batch.categoryMismatches.length, 0),
      exactDuplicates: failures.filter((failure) => failure.includes("exact duplicate")).length,
      familyCollisions: failures.filter((failure) => failure.includes("family collision") || failure.includes("also appears")).length,
      strictCrossPartitionOrExistingNearDuplicates: strictCrossPartitionOrExisting.length,
      broadNearDuplicateCandidates: near.candidates.length,
      simpleStrongBucketConflicts: simpleStrong.length,
      simpleOverloadedBucketConflicts: simpleOverloaded.length,
      complexUnderloadedBucketConflicts: complexUnderloaded.length,
      securityPatternHits: securityHits.length,
    },
    failures,
    ownerApprovalStatus: "pending",
    trainingEligible: false,
  };

  const reviewDiffs = parseJsonl(path.join(importRoot, "combined.review-diff.jsonl"));
  const coreFields = new Set([
    "expectedCategory",
    "expectedDifficulty",
    "semanticInputStatus",
    "taskBucket",
    "constraintBucket",
    "scopeBucket",
    "dependencyBucket",
    "expectedSemanticLabel",
    "expectedInstructionPayloadBoundary",
  ]);
  const otherCoreFields = new Set([...coreFields].filter((field) => field !== "expectedDifficulty"));
  const difficultyConflicts = reviewDiffs.filter((diff) => diff.labelChangedFields.includes("expectedDifficulty"));
  const otherCoreConflicts = reviewDiffs.filter((diff) => diff.labelChangedFields.some((field) => otherCoreFields.has(field)));
  const coreConflictRecords = reviewDiffs.filter((diff) => diff.labelChangedFields.some((field) => coreFields.has(field)));
  const sliceOnlyConflicts = reviewDiffs.filter((diff) => diff.labelChangedFields.length === 1 && diff.labelChangedFields[0] === "evaluationSlices");
  const mediumConfidence = reviewDiffs.filter((diff) => diff.confidence === "medium");
  const promptOnlyHighConfidence = reviewDiffs.filter((diff) => diff.promptChanged && diff.labelChangedFields.length === 0 && diff.confidence === "high" && diff.decisionPromptConsistent);
  const routeBlockers = batches.flatMap((batch) => batch.audit.evidenceRecords
    .filter((evidence) => evidence.route !== "model")
    .map((evidence) => ({
      schemaVersion: "gatelm.difficulty-independent-gpt-route-blocker.v1",
      batchId: batch.batchId,
      sampleId: evidence.sampleId,
      promptFamily: evidence.familyId,
      actualGoRoute: evidence.route,
      commonEvidenceScore: evidence.commonEvidenceScore,
      categoryEvidenceScore: evidence.categoryEvidenceScore,
      reviewDiff: reviewDiffs.find((diff) => diff.sampleId === evidence.sampleId),
      requiredOwnerAction: "keep_original_prompt_or_request_another_revision_that_remains_model_path",
    })));

  const routeBlockerBySample = new Map(routeBlockers.map((record) => [record.sampleId, record.actualGoRoute]));
  const familyReviewRows = [...groupBy(reviewDiffs, (diff) => diff.promptFamily)].map(([promptFamily, diffs]) => ({
    schemaVersion: "gatelm.difficulty-independent-gpt-family-owner-review.v1",
    batchId: diffs[0].batchId,
    promptFamily,
    records: diffs.length,
    sampleIds: diffs.map((diff) => diff.sampleId),
    confidence: counts(diffs, (diff) => diff.confidence),
    decisions: counts(diffs, (diff) => diff.decision),
    promptChanges: diffs.filter((diff) => diff.promptChanged).length,
    coreLabelConflictRecords: diffs.filter((diff) => diff.labelChangedFields.some((field) => coreFields.has(field))).length,
    difficultyConflictRecords: diffs.filter((diff) => diff.labelChangedFields.includes("expectedDifficulty")).length,
    sliceConflictRecords: diffs.filter((diff) => diff.labelChangedFields.includes("evaluationSlices")).length,
    issueCodes: [...new Set(diffs.flatMap((diff) => diff.issueCodes))].sort(),
    goRouteBlockers: diffs.filter((diff) => routeBlockerBySample.has(diff.sampleId)).map((diff) => ({ sampleId: diff.sampleId, route: routeBlockerBySample.get(diff.sampleId) })),
    ownerApprovalStatus: "pending",
  })).sort((left, right) => left.batchId.localeCompare(right.batchId) || left.promptFamily.localeCompare(right.promptFamily));

  const ownerRoot = path.join(importRoot, "owner-review");
  writeOrCheck(path.join(ownerRoot, "01-go-route-blockers.jsonl"), jsonl(routeBlockers));
  writeOrCheck(path.join(ownerRoot, "02-difficulty-label-conflicts.jsonl"), jsonl(difficultyConflicts));
  writeOrCheck(path.join(ownerRoot, "03-other-core-label-conflicts.jsonl"), jsonl(otherCoreConflicts));
  writeOrCheck(path.join(ownerRoot, "04-slice-only-conflicts.jsonl"), jsonl(sliceOnlyConflicts));
  writeOrCheck(path.join(ownerRoot, "05-medium-confidence.jsonl"), jsonl(mediumConfidence));
  writeOrCheck(path.join(ownerRoot, "06-prompt-only-high-confidence.jsonl"), jsonl(promptOnlyHighConfidence));
  writeOrCheck(path.join(ownerRoot, "family-review-summary.jsonl"), jsonl(familyReviewRows));
  writeOrCheck(path.join(ownerRoot, "OWNER-DECISION-TEMPLATE.json"), `${JSON.stringify({
    schemaVersion: "gatelm.difficulty-independent-gpt-owner-decision.v1",
    ownerApprovalStatus: "pending",
    decisionGroups: {
      goRouteBlockers: "pending",
      difficultyLabelConflicts: "pending",
      otherCoreLabelConflicts: "pending",
      sliceOnlyConflicts: "pending",
      mediumConfidenceReviews: "pending",
      promptOnlyHighConfidenceBatch: "pending",
    },
    recordOverrides: [],
    familyOverrides: [],
    ownerNote: "",
  }, null, 2)}\n`);

  const ownerGuide = [
    "# Owner adjudication guide for the independent GPT review",
    "",
    "No candidate, approval, or training file has been changed. Every record remains pending and training-ineligible.",
    "",
    "## Verified import",
    "",
    "- Review outputs: 3,120 records / 624 families / 9 batches",
    "- GPT prompt decisions: accept 1,354; revise prompt 1,766",
    "- Confidence: high 2,600; medium 520",
    "- Packet alias normalization: 322 `fenced_block` values were losslessly mapped to the contract value `code_fence`; raw files are unchanged and the mapping is audited.",
    "- Category conflicts: 0; semantic-label conflicts: 0; semantic-input-status conflicts: 0",
    `- Difficulty conflicts: ${difficultyConflicts.length} (simple -> complex 74; complex -> simple 7)`,
    `- Records with any core-label conflict: ${coreConflictRecords.length}`,
    `- Slice-only conflicts: ${sliceOnlyConflicts.length}`,
    "",
    "## Proposed-prompt gates",
    "",
    `- Actual Go model path: ${summary.counts.modelPath}/${summary.counts.records}`,
    `- Hard sentinel blockers: ${summary.counts.hardSentinel}`,
    `- Exact duplicates / family collisions: ${summary.counts.exactDuplicates}/${summary.counts.familyCollisions}`,
    `- Strict cross-partition or existing-data near duplicates: ${summary.counts.strictCrossPartitionOrExistingNearDuplicates}`,
    `- Broad near-duplicate candidates for reporting: ${summary.counts.broadNearDuplicateCandidates}`,
    `- Security pattern hits: ${summary.counts.securityPatternHits}`,
    "",
    "## Recommended review order",
    "",
    `1. Resolve all ${routeBlockers.length} Go route blockers. Do not accept those prompt revisions as written.`,
    `2. Adjudicate all ${difficultyConflicts.length} difficulty changes independently using the label guide.`,
    `3. Review ${otherCoreConflicts.length} records with non-difficulty core bucket changes; overlaps with step 2 are intentional.`,
    `4. Decide whether to batch-accept the ${sliceOnlyConflicts.length} slice-only changes after checking slice policy.`,
    `5. Human-sample and then decide the ${promptOnlyHighConfidence.length} high-confidence prompt-only revisions as a batch.`,
    `6. Review all ${mediumConfidence.length} medium-confidence records individually or family-first.`,
    "",
    "Use `family-review-summary.jsonl` to work family-first. Record-level queues deliberately overlap when one record needs more than one decision. Fill `OWNER-DECISION-TEMPLATE.json` only after review; approval is not inferred from the GPT output.",
    "",
  ].join("\n");
  writeOrCheck(path.join(ownerRoot, "00-OWNER-ADJUDICATION-GUIDE.md"), ownerGuide);

  writeOrCheck(path.join(importRoot, "proposed-verification-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary.counts));
  if (failures.length > 0) throw new Error(`independent GPT proposed verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

if (refreshGoAuditsRequested) refreshGoAudits();
main();
