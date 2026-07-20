import assert from "node:assert/strict";
import test from "node:test";

import {
  DATASET_DIMENSIONS,
  buildArtifacts,
  parseJsonl,
  validateRecords,
  verifyPersistedArtifacts,
} from "../enterprise-synthetic-8000-lib.mjs";

test("builds exactly 8,000 deterministic candidate records", () => {
  const first = buildArtifacts();
  const second = buildArtifacts();
  assert.equal(first.records.length, 8000);
  assert.equal(first.datasetText, second.datasetText);
  assert.equal(first.manifestText, second.manifestText);
  assert.deepEqual(validateRecords(first.records), []);
});

test("keeps every derivation group in one split", () => {
  const { records } = buildArtifacts();
  const splitsByGroup = new Map();
  for (const record of records) {
    if (!splitsByGroup.has(record.group_id)) splitsByGroup.set(record.group_id, new Set());
    splitsByGroup.get(record.group_id).add(record.split);
  }
  assert.ok([...splitsByGroup.values()].every((splits) => splits.size === 1));
});

test("covers all requested task, domain, language, and boundary dimensions", () => {
  const { records, manifest } = buildArtifacts();
  assert.equal(new Set(records.map((record) => record.task_type)).size, 23);
  assert.equal(new Set(records.map((record) => record.service_domain)).size, 23);
  assert.equal(manifest.distributions.language.ko, 7400);
  assert.equal(manifest.distributions.language.en, 200);
  assert.equal(manifest.distributions.language.mixed, 400);
  assert.equal(manifest.coverage.long_simple_records, 800);
  assert.equal(manifest.coverage.long_complex_records, 800);
  assert.equal(
    new Set(records.filter((record) => record.boundary_case).map((record) => record.counterexample_type)).size,
    DATASET_DIMENSIONS.simpleBoundaryTypes.length + DATASET_DIMENSIONS.complexBoundaryTypes.length,
  );
});

test("rejects a split leak and unsafe secret-like prompt", () => {
  const { records } = buildArtifacts();
  const mutated = records.map((record) => ({ ...record }));
  mutated[1].split = "test";
  mutated[2].redacted_prompt = "API key = sk-example-secret-value-1234";
  const failures = validateRecords(mutated, { checkNearDuplicates: false });
  assert.ok(failures.some((failure) => failure.includes("group leaks across splits")));
  assert.ok(failures.some((failure) => failure.includes("forbidden secret pattern")));
});

test("verifies the persisted JSONL hash and manifest", () => {
  const artifacts = buildArtifacts();
  const parsed = parseJsonl(artifacts.datasetText);
  assert.equal(parsed.length, 8000);
  assert.deepEqual(verifyPersistedArtifacts(artifacts.datasetText, artifacts.manifest), []);
  assert.ok(
    verifyPersistedArtifacts(`${artifacts.datasetText} `, artifacts.manifest).some((failure) =>
      failure.includes("dataset_sha256 mismatch"),
    ),
  );
});
