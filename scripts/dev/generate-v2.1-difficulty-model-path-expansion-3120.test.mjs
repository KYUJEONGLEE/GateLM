import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const expectedBatches = {
  t1: { role: "train", partition: "train", records: 400, families: 80 },
  t2: { role: "train", partition: "train", records: 400, families: 80 },
  t3: { role: "train", partition: "train", records: 400, families: 80 },
  t4: { role: "train", partition: "train", records: 395, families: 79 },
  c1: { role: "calibration", partition: "calibration", records: 275, families: 55 },
  c2: { role: "calibration", partition: "calibration", records: 250, families: 50 },
  e1: { role: "evaluation", partition: "holdout", records: 375, families: 75 },
  e2: { role: "evaluation", partition: "holdout", records: 375, families: 75 },
  p1: { role: "promotion", partition: "holdout", records: 250, families: 50 },
};

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function readJsonl(filePath) {
  return readFileSync(filePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

test("freezes 3,120 review-only candidates into family-disjoint model-path partitions", () => {
  const index = readJson(path.join(root, "generation-index.json"));

  assert.equal(index.decisionBoundaryVersion, "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2");
  assert.equal(index.trainingPolicyVersion, "difficulty-training-policy.single-request-model-path.2026-07-15.v2");
  assert.equal(index.reviewStatus, "pending_owner_review");
  assert.equal(index.trainingEligible, false);
  assert.equal(index.candidateRecords, 3120);
  assert.equal(index.candidateFamilies, 624);
  assert.equal(index.ownerApprovedSourceRecordsUnchanged, 2500);
  assert.equal(index.batches.length, Object.keys(expectedBatches).length);

  const allSampleIds = new Set();
  const allFamilies = new Set();
  const roleFamilies = new Map();
  for (const batch of index.batches) {
    const expected = expectedBatches[batch.batchId];
    assert.ok(expected, `unexpected batch ${batch.batchId}`);
    assert.equal(batch.partitionRole, expected.role);
    assert.equal(batch.manifestPartition, expected.partition);
    assert.equal(batch.records, expected.records);
    assert.equal(batch.families, expected.families);

    const datasetPath = path.resolve(batch.datasetPath);
    assert.equal(path.resolve(batch.goAuditPath), path.join(root, batch.batchId, `${batch.batchId}.go-audit.json`));
    const manifest = readJson(path.resolve(batch.manifestPath));
    const datasetText = readFileSync(datasetPath, "utf8");
    const records = readJsonl(datasetPath);
    assert.equal(sha256(datasetText), batch.datasetSha256);
    assert.equal(manifest.datasetSha256, batch.datasetSha256);
    assert.equal(manifest.trainingEligible, false);
    assert.equal(manifest.counts.humanReviewedFamilies, 0);
    assert.equal(manifest.counts.approvedHumanReviewedFamilies, 0);
    assert.equal(records.length, expected.records);

    for (const record of records) {
      assert.equal(record.semanticInputStatus, "eligible");
      assert.equal(record.labelSource, "synthetic_fixture");
      assert.equal(record.reviewStatus, "pending");
      assert.equal(record.reviewerCount, 0);
      assert.equal(allSampleIds.has(record.sampleId), false, `duplicate sample ${record.sampleId}`);
      allSampleIds.add(record.sampleId);

      const previousRole = roleFamilies.get(record.promptFamily);
      assert.ok(previousRole === undefined || previousRole === expected.role);
      roleFamilies.set(record.promptFamily, expected.role);
      allFamilies.add(record.promptFamily);
    }
  }

  assert.equal(allSampleIds.size, 3120);
  assert.equal(allFamilies.size, 624);
  assert.equal([...roleFamilies.values()].filter((role) => role === "train").length, 319);
  assert.equal([...roleFamilies.values()].filter((role) => role === "calibration").length, 105);
  assert.equal([...roleFamilies.values()].filter((role) => role === "evaluation").length, 150);
  assert.equal([...roleFamilies.values()].filter((role) => role === "promotion").length, 50);
});

test("keeps every candidate on the current Gateway model path", () => {
  const binaryRoot = mkdtempSync(path.join(os.tmpdir(), "gatelm-difficulty-audit-"));
  const auditBinary = path.join(binaryRoot, process.platform === "win32" ? "difficulty-decision-audit.exe" : "difficulty-decision-audit");
  const build = spawnSync(
    "go",
    ["build", "-o", auditBinary, "./cmd/difficulty-decision-audit"],
    {
      cwd: path.resolve("apps/gateway-core"),
      encoding: "utf8",
      env: {
        ...process.env,
        GOCACHE: path.resolve(".gocache"),
        TEMP: path.resolve(".tmp"),
        TMP: path.resolve(".tmp"),
      },
    },
  );
  assert.equal(build.status, 0, build.stderr);
  let total = 0;
  try {
    for (const batchId of Object.keys(expectedBatches)) {
      const batchRoot = path.join(root, batchId);
      const result = spawnSync(
        auditBinary,
        [
        "-dataset",
        path.join(batchRoot, `${batchId}.candidate.jsonl`),
        "-manifest",
        path.join(batchRoot, `${batchId}.candidate.manifest.json`),
        "-allow-pending",
      ],
        {
          cwd: path.resolve("apps/gateway-core"),
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const audit = JSON.parse(result.stdout);
      const frozenAudit = readJson(path.join(batchRoot, `${batchId}.go-audit.json`));
      assert.deepEqual(frozenAudit, audit, `${batchId}: frozen Go audit drifted`);
      assert.equal(audit.decisionBoundaryVersion, "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2");
      assert.equal(audit.simpleSentinelRecords, 0, `${batchId}: simple sentinel candidates`);
      assert.equal(audit.hardSentinelRecords, 0, `${batchId}: hard sentinel candidates`);
      assert.equal(audit.modelPathRecords, expectedBatches[batchId].records);
      assert.equal(audit.semanticStatusRouteMismatches, 0);
      assert.equal(JSON.stringify(audit).includes("redactedPrompt"), false);
      total += audit.modelPathRecords;
    }
  } finally {
    rmSync(binaryRoot, { recursive: true, force: true });
  }
  assert.equal(total, 3120);
});
