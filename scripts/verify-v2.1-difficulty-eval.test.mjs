import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyDifficultyEvaluationDataset } from "./verify-v2.1-difficulty-eval.mjs";
import { verifyCategoryEvaluationDataset } from "./verify-v2.1-category-eval.mjs";

const schemaRelativePath = "docs/v2.1.0/schemas/difficulty-evaluation-record.schema.json";
const fixtureRelativePath = "docs/v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl";

test("difficulty verifier accepts a valid difficulty-only evaluation record", () => {
  withDataset(
    difficultySchema(),
    [difficultyRecord()],
    ({ rootDir }) => {
      assert.deepEqual(verifyDifficultyEvaluationDataset({ rootDir }), []);
    },
  );
});

test("difficulty schema allows exactly simple and complex labels", () => {
  const schema = difficultySchema();
  schema.properties.expectedDifficulty.enum = ["simple", "complex", "moderate"];

  withDataset(schema, [difficultyRecord({ expectedDifficulty: "moderate" })], ({ rootDir }) => {
    const failures = verifyDifficultyEvaluationDataset({ rootDir });
    assert.ok(
      failures.some((failure) => failure.includes("expectedDifficulty") && failure.includes("simple,complex")),
      `expanded difficulty taxonomy was accepted: ${JSON.stringify(failures)}`,
    );
  });
});

test("difficulty schema is closed and requires the difficulty label", () => {
  const schema = difficultySchema();
  schema.additionalProperties = true;
  schema.required = schema.required.filter((field) => field !== "expectedDifficulty");

  withDataset(schema, [difficultyRecord()], ({ rootDir }) => {
    const failures = verifyDifficultyEvaluationDataset({ rootDir });
    assert.ok(
      failures.some((failure) => failure.includes("additionalProperties must be false")),
      `open difficulty schema was accepted: ${JSON.stringify(failures)}`,
    );
    assert.ok(
      failures.some((failure) => failure.includes("must require expectedDifficulty")),
      `optional difficulty label was accepted: ${JSON.stringify(failures)}`,
    );
  });
});

test("difficulty records reject secret-shaped text even in redactedPrompt", () => {
  withDataset(
    difficultySchema(),
    [difficultyRecord({ redactedPrompt: "Bearer abcdefghijklmnopqrstuvwxyz" })],
    ({ rootDir }) => {
      const failures = verifyDifficultyEvaluationDataset({ rootDir });
      assert.ok(
        failures.some((failure) => failure.includes("forbidden secret-shaped string")),
        `secret-shaped prompt was accepted: ${JSON.stringify(failures)}`,
      );
    },
  );
});

test("synthetic difficulty fixtures require synthetic provenance labels", () => {
  withDataset(
    difficultySchema(),
    [
      difficultyRecord({
        source: "synthetic_fixture",
        consentType: "internal_manual_review",
        labelSource: "human_review",
      }),
    ],
    ({ rootDir }) => {
      const failures = verifyDifficultyEvaluationDataset({ rootDir });
      assert.ok(
        failures.some((failure) => failure.includes("synthetic_fixture must use consentType=synthetic")),
        `invalid consent provenance was accepted: ${JSON.stringify(failures)}`,
      );
      assert.ok(
        failures.some((failure) => failure.includes("synthetic_fixture must use labelSource=synthetic_fixture")),
        `invalid label provenance was accepted: ${JSON.stringify(failures)}`,
      );
    },
  );
});

test("difficulty schema has an identity distinct from the category record", () => {
  const schema = difficultySchema();
  schema.properties.schemaVersion.const = "gatelm.category-evaluation-record.v2";

  withDataset(
    schema,
    [difficultyRecord({ schemaVersion: "gatelm.category-evaluation-record.v2" })],
    ({ rootDir }) => {
      const failures = verifyDifficultyEvaluationDataset({ rootDir });
      assert.ok(
        failures.some((failure) => failure.includes("gatelm.difficulty-evaluation-record.v1")),
        `category schema identity was accepted: ${JSON.stringify(failures)}`,
      );
    },
  );
});

test("difficulty schema requires the four evaluation dimensions", () => {
  const schema = difficultySchema();
  schema.required = schema.required.filter(
    (field) => !["redactedPrompt", "expectedCategory", "language"].includes(field),
  );

  withDataset(schema, [difficultyRecord()], ({ rootDir }) => {
    const failures = verifyDifficultyEvaluationDataset({ rootDir });
    for (const field of ["redactedPrompt", "expectedCategory", "language"]) {
      assert.ok(
        failures.some((failure) => failure.includes(`must require ${field}`)),
        `optional ${field} was accepted: ${JSON.stringify(failures)}`,
      );
    }
  });
});

test("difficulty records reject a missing expectedDifficulty field", () => {
  const record = difficultyRecord();
  delete record.expectedDifficulty;

  withDataset(difficultySchema(), [record], ({ rootDir }) => {
    const failures = verifyDifficultyEvaluationDataset({ rootDir });
    assert.ok(failures.some((failure) => failure.includes("missing required property expectedDifficulty")));
  });
});

test("difficulty records reject labels outside simple and complex", () => {
  withDataset(difficultySchema(), [difficultyRecord({ expectedDifficulty: "moderate" })], ({ rootDir }) => {
    const failures = verifyDifficultyEvaluationDataset({ rootDir });
    assert.ok(failures.some((failure) => failure.includes("expectedDifficulty") && failure.includes("simple")));
  });
});

test("difficulty records reject undeclared fields", () => {
  withDataset(difficultySchema(), [difficultyRecord({ categoryDiagnostics: {} })], ({ rootDir }) => {
    const failures = verifyDifficultyEvaluationDataset({ rootDir });
    assert.ok(failures.some((failure) => failure.includes("unexpected property categoryDiagnostics")));
  });
});

test("category-only records reject expectedDifficulty", () => {
  withCategoryDataset({ expectedDifficulty: "simple" }, ({ rootDir }) => {
    const failures = verifyCategoryEvaluationDataset({ rootDir });
    assert.ok(failures.some((failure) => failure.includes("unexpected property expectedDifficulty")));
  });
});

function withDataset(schema, records, assertion) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-difficulty-eval-"));
  try {
    const schemaPath = path.join(rootDir, ...schemaRelativePath.split("/"));
    const fixturePath = path.join(rootDir, ...fixtureRelativePath.split("/"));
    mkdirSync(path.dirname(schemaPath), { recursive: true });
    mkdirSync(path.dirname(fixturePath), { recursive: true });
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
    writeFileSync(fixturePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    assertion({ rootDir });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function withCategoryDataset(extraFields, assertion) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "gatelm-category-separation-"));
  try {
    const schemaDir = path.join(rootDir, "docs", "v2.1.0", "schemas");
    const fixtureDir = path.join(rootDir, "docs", "v2.1.0", "fixtures");
    mkdirSync(schemaDir, { recursive: true });
    mkdirSync(fixtureDir, { recursive: true });

    const schema = categorySchema();
    writeFileSync(
      path.join(schemaDir, "category-evaluation-record.schema.json"),
      `${JSON.stringify(schema, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(schemaDir, "category-evaluation-record.v1.schema.json"),
      `${JSON.stringify(schema, null, 2)}\n`,
      "utf8",
    );

    const record = {
      schemaVersion: "gatelm.category-evaluation-record.v2",
      sampleId: "category_sample_001",
      redactedPrompt: "safe synthetic prompt",
      expectedCategory: "general",
      labelSource: "synthetic_fixture",
      consentType: "synthetic",
      source: "synthetic_fixture",
      ...extraFields,
    };
    for (const fixtureName of [
      "category-evaluation-dataset.fixture.jsonl",
      "category-evaluation-challenge.fixture.jsonl",
      "category-evaluation-ambiguous.fixture.jsonl",
    ]) {
      writeFileSync(path.join(fixtureDir, fixtureName), `${JSON.stringify(record)}\n`, "utf8");
    }
    assertion({ rootDir });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function difficultyRecord(overrides = {}) {
  return {
    schemaVersion: "gatelm.difficulty-evaluation-record.v1",
    datasetVersion: "difficulty_eval_test_v1",
    sampleId: "difficulty_sample_001",
    redactedPrompt: "Explain this safe synthetic example.",
    expectedCategory: "general",
    expectedDifficulty: "simple",
    labelSource: "synthetic_fixture",
    consentType: "synthetic",
    source: "synthetic_fixture",
    language: "en",
    redactionVersion: "rule_based_redaction_v1",
    createdAt: "2026-07-13T00:00:00Z",
    ...overrides,
  };
}

function difficultySchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://gatelm.local/docs/v2.1.0/schemas/difficulty-evaluation-record.schema.json",
    title: "GateLM Difficulty Evaluation Record",
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { type: "string", const: "gatelm.difficulty-evaluation-record.v1" },
      datasetVersion: { type: "string", minLength: 1, maxLength: 120 },
      sampleId: { type: "string", minLength: 1, maxLength: 160, pattern: "^[a-zA-Z0-9._:-]+$" },
      redactedPrompt: { type: "string", minLength: 0, maxLength: 65536 },
      expectedCategory: {
        type: "string",
        enum: ["general", "code", "translation", "summarization", "reasoning"],
      },
      expectedDifficulty: { type: "string", enum: ["simple", "complex"] },
      labelSource: { type: "string", enum: ["human_review", "synthetic_fixture"] },
      consentType: { type: "string", enum: ["synthetic", "internal_manual_review"] },
      source: { type: "string", enum: ["synthetic_fixture", "manual_seed"] },
      language: { type: "string", enum: ["en", "ko", "mixed", "unknown"] },
      redactionVersion: { type: "string", minLength: 1, maxLength: 120 },
      createdAt: { type: "string", format: "date-time" },
    },
    required: [
      "schemaVersion",
      "datasetVersion",
      "sampleId",
      "redactedPrompt",
      "expectedCategory",
      "expectedDifficulty",
      "labelSource",
      "consentType",
      "source",
      "language",
      "redactionVersion",
      "createdAt",
    ],
  };
}

function categorySchema() {
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
      expectedCategory: {
        type: "string",
        enum: ["general", "code", "translation", "summarization", "reasoning"],
      },
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
