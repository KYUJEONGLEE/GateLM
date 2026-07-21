import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildOutputSchema,
  buildPacket,
  selectionReasons,
} from "../generate-gpt-risk-sensitive-slice-review-packet.mjs";

const datasetText = readFileSync("docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.jsonl", "utf8");
let cached;
const packet = () => (cached ??= buildPacket(datasetText));

test("selects the complete deduplicated risk-sensitive slice union", () => {
  const built = packet();
  assert.equal(built.manifest.records, 7974);
  assert.equal(built.privateManifest.selection_counts.false_simple_risk, 6697);
  assert.equal(built.privateManifest.selection_counts.false_complex_risk, 1277);
  assert.equal(new Set(built.privateManifest.mapping.map((row) => row.item_id)).size, 7974);
});

test("keeps current labels, metadata, selection reasons, and original IDs out of reviewer inputs", () => {
  const built = packet();
  const inputRows = [...built.files.entries()].filter(([name]) => name.replaceAll("\\", "/").startsWith("inputs/")).flatMap(([name, text]) => text.trim().split(/\r?\n/u).map((line) => ({ name, row: JSON.parse(line) })));
  assert.equal(inputRows.length, 7974);
  for (const { row } of inputRows) {
    assert.deepEqual(Object.keys(row).sort(), ["batch_id", "item_id", "prompt", "review_group_id", "reviewer_id", "schema_version"]);
    assert.equal("label" in row, false);
    assert.equal("task_type" in row, false);
    assert.equal("language" in row, false);
    assert.match(row.item_id, /^re_[a-f0-9]{24}$/u);
  }
});

test("keeps every group atomic and each batch within limits", () => {
  const built = packet();
  const batchByGroup = new Map();
  for (const batch of built.manifest.batch_index) {
    assert.ok(batch.records <= 50);
    assert.ok(batch.prompt_characters <= 45000);
    const rows = built.files.get(batch.input_file.replaceAll("/", pathSeparator())).trim().split(/\r?\n/u).map(JSON.parse);
    for (const row of rows) {
      const prior = batchByGroup.get(row.review_group_id);
      assert.ok(prior === undefined || prior === batch.batch_id);
      batchByGroup.set(row.review_group_id, batch.batch_id);
    }
  }
});

test("schema forces every non-high-confidence or human-request result to Complex", () => {
  const schema = buildOutputSchema();
  assert.equal(schema.properties.axis_decisions.required.length, 7);
  assert.equal(schema.allOf.length, 3);
  assert.equal(schema.allOf[1].then.properties.difficulty.const, "complex");
  assert.equal(schema.allOf[2].then.properties.difficulty.const, "complex");
});

test("selection only targets the requested risk directions", () => {
  assert.deepEqual(selectionReasons({ label: "simple", task_type: "general_query", language: "ko", length_bucket: "medium", service_domain: "corporate_operations" }), ["simple_in_undercomplex_task_slice"]);
  assert.deepEqual(selectionReasons({ label: "complex", task_type: "math_problem", language: "ko", length_bucket: "short", service_domain: "research" }), ["complex_in_math_slice", "complex_in_research_slice"]);
  assert.deepEqual(selectionReasons({ label: "complex", task_type: "general_query", language: "en", length_bucket: "short", service_domain: "corporate_operations" }), []);
});

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
