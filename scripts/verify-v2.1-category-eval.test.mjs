import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyCategoryEvaluationDataset } from "./verify-v2.1-category-eval.mjs";

const fixtureNames = [
  "category-evaluation-dataset.fixture.jsonl",
  "category-evaluation-challenge.fixture.jsonl",
  "category-evaluation-ambiguous.fixture.jsonl",
];

const activeCategories = ["general", "code", "translation", "summarization", "reasoning"];

test("검증기는 모든 active category evaluation fixture를 검사한다", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-category-eval-"));
  try {
    const schemaDir = path.join(rootDir, "docs", "v2.1.0", "schemas");
    const fixtureDir = path.join(rootDir, "docs", "v2.1.0", "fixtures");
    mkdirSync(schemaDir, { recursive: true });
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(
      path.join(schemaDir, "category-evaluation-record.schema.json"),
      JSON.stringify(categoryOnlySchema()),
      "utf8",
    );

    const validRecord = categoryOnlyRecord("sample_valid");
    for (const fixtureName of fixtureNames) {
      writeFileSync(path.join(fixtureDir, fixtureName), `${JSON.stringify(validRecord)}\n`, "utf8");
    }
    writeFileSync(
      path.join(fixtureDir, "category-evaluation-challenge.fixture.jsonl"),
      `${JSON.stringify({ ...categoryOnlyRecord("sample_invalid"), expectedTier: "balanced" })}\n`,
      "utf8",
    );

    const failures = verifyCategoryEvaluationDataset({ rootDir });

    assert.ok(
      failures.some(
        (failure) =>
          failure.includes("category-evaluation-challenge.fixture.jsonl") &&
          failure.includes("expectedTier"),
      ),
      `challenge fixture violation was not reported: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("canonical schema는 v2 category-only 계약이어야 한다", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-category-eval-schema-"));
  try {
    const schemaDir = path.join(rootDir, "docs", "v2.1.0", "schemas");
    const fixtureDir = path.join(rootDir, "docs", "v2.1.0", "fixtures");
    mkdirSync(schemaDir, { recursive: true });
    mkdirSync(fixtureDir, { recursive: true });

    const v1Schema = categoryOnlySchema();
    v1Schema.properties.schemaVersion.const = "gatelm.category-evaluation-record.v1";
    v1Schema.properties.expectedTier = {
      type: "string",
      enum: ["low_cost", "balanced", "high_quality"],
    };
    v1Schema.required.push("expectedTier");
    writeFileSync(
      path.join(schemaDir, "category-evaluation-record.schema.json"),
      JSON.stringify(v1Schema),
      "utf8",
    );

    const v1Record = {
      ...categoryOnlyRecord("sample_v1"),
      schemaVersion: "gatelm.category-evaluation-record.v1",
      expectedTier: "balanced",
    };
    for (const fixtureName of fixtureNames) {
      writeFileSync(path.join(fixtureDir, fixtureName), `${JSON.stringify(v1Record)}\n`, "utf8");
    }

    const failures = verifyCategoryEvaluationDataset({ rootDir });

    assert.ok(
      failures.some(
        (failure) => failure.includes("gatelm.category-evaluation-record.v2") || failure.includes("expectedTier"),
      ),
      `v1 canonical schema was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("canonical category taxonomy is exactly the five active routing categories", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-category-taxonomy-"));
  try {
    const schemaDir = path.join(rootDir, "docs", "v2.1.0", "schemas");
    const fixtureDir = path.join(rootDir, "docs", "v2.1.0", "fixtures");
    mkdirSync(schemaDir, { recursive: true });
    mkdirSync(fixtureDir, { recursive: true });

    const legacySchema = categoryOnlySchema();
    legacySchema.properties.expectedCategory.enum = [
      ...activeCategories,
      "extraction_json",
      "support_refund",
      "unknown",
    ];
    writeFileSync(
      path.join(schemaDir, "category-evaluation-record.schema.json"),
      JSON.stringify(legacySchema),
      "utf8",
    );
    for (const fixtureName of fixtureNames) {
      writeFileSync(
        path.join(fixtureDir, fixtureName),
        `${JSON.stringify(categoryOnlyRecord("sample_general"))}\n`,
        "utf8",
      );
    }

    const failures = verifyCategoryEvaluationDataset({ rootDir });

    assert.ok(
      failures.some((failure) => failure.includes("exactly five active categories")),
      `legacy category taxonomy was accepted: ${JSON.stringify(failures)}`,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

function categoryOnlyRecord(sampleId) {
  return {
    schemaVersion: "gatelm.category-evaluation-record.v2",
    sampleId,
    redactedPrompt: "safe synthetic prompt",
    expectedCategory: "general",
    labelSource: "synthetic_fixture",
    consentType: "synthetic",
    source: "synthetic_fixture",
  };
}

function categoryOnlySchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://gatelm.local/docs/v2.1.0/schemas/category-evaluation-record.schema.json",
    title: "GateLM Category Evaluation Record",
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: "gatelm.category-evaluation-record.v2" },
      sampleId: { type: "string", minLength: 1 },
      redactedPrompt: { type: "string", maxLength: 65536 },
      expectedCategory: { type: "string", enum: activeCategories },
      labelSource: { type: "string", enum: ["synthetic_fixture"] },
      consentType: { type: "string", enum: ["synthetic"] },
      source: { type: "string", enum: ["synthetic_fixture"] },
    },
    required: [
      "schemaVersion",
      "sampleId",
      "redactedPrompt",
      "expectedCategory",
      "labelSource",
      "consentType",
      "source",
    ],
    allOf: [
      {
        if: { properties: { source: { const: "synthetic_fixture" } }, required: ["source"] },
        then: {
          properties: {
            consentType: { const: "synthetic" },
            labelSource: { const: "synthetic_fixture" },
          },
        },
      },
    ],
  };
}
