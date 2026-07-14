import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyDifficultySemanticCandidates } from "./verify-v2.1-difficulty-semantic-candidates.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredPaths = [
  "scripts/routing_difficulty_model/artifacts/candidates",
  "scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v1.json",
  "scripts/routing_difficulty_model/training-policy.semantic-candidates.v1.json",
  "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json",
];

function withFixture(mutator) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-semantic-candidates-"));
  try {
    for (const relativePath of requiredPaths) {
      const source = path.join(sourceRoot, ...relativePath.split("/"));
      const target = path.join(rootDir, ...relativePath.split("/"));
      cpSync(source, target, { recursive: true });
    }
    mutator?.(rootDir);
    return verifyDifficultySemanticCandidates({ rootDir });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

test("checked-in semantic candidates use one exact 300/100/100 split", () => {
  assert.deepEqual(withFixture(), []);
});

test("semantic candidate verifier rejects holdout count drift", () => {
  const failures = withFixture((rootDir) => {
    const reportPath = path.join(
      rootDir,
      "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-comparison.owner-approved-500.v1.json",
    );
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    report.splitCounts.holdout.records = 99;
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  });
  assert(failures.some((failure) => failure.includes("exactly 300/100/100")));
});
