import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildArtifacts,
  difficultyScore,
  normalizePrompt,
  parseJsonl,
  validateBundleRecords,
  validatePublicRecords,
  verifyPersistedArtifacts,
} from "../public-prompts-7000-lib.mjs";
import { lengthLabelDistribution, lengthOnlyRocAuc } from "../dataset-bias.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
let cached;
const artifacts = () => (cached ??= buildArtifacts({ rootDir }));

test("builds exactly 7,000 deterministic public Prompt candidates", () => {
  const first = artifacts();
  const second = buildArtifacts({ rootDir });
  assert.equal(first.records.length, 7000);
  assert.equal(first.datasetText, second.datasetText);
  assert.deepEqual(validatePublicRecords(first.records), []);
});

test("meets source diversity, language, label, and split quotas", () => {
  const { manifest } = artifacts();
  assert.ok(Object.keys(manifest.distributions.source_dataset).length >= 5);
  assert.ok(Math.max(...Object.values(manifest.distributions.source_dataset)) <= 3150);
  assert.deepEqual(manifest.distributions.language, { en: 2250, ko: 4200, mixed: 550 });
  assert.deepEqual(manifest.distributions.label, { complex: 3500, simple: 3500 });
  assert.deepEqual(manifest.distributions.split, { test: 1050, train: 4900, validation: 1050 });
});

test("caps KLUE and removes context serialization and KLUE RAG queries", () => {
  const klue = artifacts().records.filter((record) => record.source_dataset === "klue_mrc");
  assert.ok(klue.length <= 800);
  assert.ok(klue.every((record) => record.source_transform === "as_published_field"));
  assert.ok(klue.every((record) => record.task_type === "fact_explanation"));
  assert.ok(klue.every((record) => record.label_reason.endsWith("without_length")));
  assert.ok(lengthOnlyRocAuc(klue) <= 0.55);
});

test("reports authorship gaps and enforces source, task, and domain caps", () => {
  const { records, manifest, bundleRecords } = artifacts();
  assert.ok(manifest.counts.human_origin_records >= 6800);
  assert.ok(manifest.counts.direct_human_authored_records >= 2600);
  assert.equal(manifest.counts.real_user_records, 0);
  assert.equal(
    manifest.coverage.direct_human_authored_gap_records,
    4200 - manifest.counts.direct_human_authored_records,
  );
  assert.equal(manifest.coverage.direct_human_authored_60_percent_met, false);
  assert.ok(Math.max(...Object.values(manifest.distributions.source_dataset)) <= 3150);
  const taskCounts = bundleRecords.reduce((counts, record) => {
    counts[record.task_type] = (counts[record.task_type] ?? 0) + 1;
    return counts;
  }, {});
  assert.ok(Object.values(taskCounts).every((count) => count >= 400 && count <= 900));
  const domainCounts = bundleRecords.reduce((counts, record) => {
    counts[record.service_domain] = (counts[record.service_domain] ?? 0) + 1;
    return counts;
  }, {});
  assert.ok(Object.values(domainCounts).every((count) => count >= 300 && count <= 1875));
  for (const field of ["task_type", "service_domain"]) {
    const grouped = Object.groupBy(bundleRecords, (record) => record[field]);
    assert.ok(Object.values(grouped).every((rows) => {
      const simpleShare = rows.filter((record) => record.label === "simple").length / rows.length;
      return simpleShare >= 0.35 && simpleShare <= 0.65;
    }));
  }
  assert.ok(records.every((record) => typeof record.source_direct_human_authored === "boolean"));
});

test("does not use raw prompt length in the difficulty score", () => {
  const prompt = "Translate hello into Korean.";
  const padded = `${prompt}\n${"alpha beta gamma delta ".repeat(100)}`;
  assert.equal(difficultyScore(prompt), difficultyScore(padded));
});

test("passes bundle length-label guardrails", () => {
  const { bundleRecords, bundleManifest } = artifacts();
  const distribution = lengthLabelDistribution(bundleRecords);
  assert.deepEqual(distribution.long, { complex: 860, simple: 860 });
  for (const labels of Object.values(distribution)) {
    const total = labels.simple + labels.complex;
    assert.ok(labels.simple / total >= 0.35 && labels.simple / total <= 0.65);
  }
  assert.ok(lengthOnlyRocAuc(bundleRecords) <= 0.6);
  assert.equal(bundleManifest.coverage.length_only_roc_auc, lengthOnlyRocAuc(bundleRecords));
});

test("contains no system or assistant messages, source answers, or raw source user identifiers", () => {
  const { records, manifest } = artifacts();
  assert.equal(manifest.filtering.system_assistant_tool_messages_included, 0);
  assert.equal(manifest.filtering.source_answers_included, 0);
  assert.equal(manifest.filtering.raw_source_user_identifiers_included, 0);
  assert.ok(records.every((record) => record.source_record_id.length === 24));
  assert.ok(records.every((record) => !/^\s*(system|assistant|developer|tool)\s*:/im.test(record.redacted_prompt)));
});

test("deduplicates normalized prompts across the complete 15,000 bundle", () => {
  const { bundleRecords } = artifacts();
  assert.equal(new Set(bundleRecords.map((record) => normalizePrompt(record.redacted_prompt))).size, 15000);
  assert.deepEqual(validateBundleRecords(bundleRecords), []);
});

test("verifies hashes and persisted shapes", () => {
  const value = artifacts();
  assert.equal(parseJsonl(value.bundleText).length, 15000);
  assert.deepEqual(
    verifyPersistedArtifacts(value.datasetText, value.manifest, value.bundleText, value.bundleManifest),
    [],
  );
  assert.ok(
    verifyPersistedArtifacts(`${value.datasetText} `, value.manifest, value.bundleText, value.bundleManifest).some(
      (failure) => failure.includes("public manifest hash mismatch"),
    ),
  );
});
