import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_DATASET_PATH =
  "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl";
const REVIEW_DIRECTORY = "docs/v2.1.0/reviews";
const REVIEW_PATH = `${REVIEW_DIRECTORY}/difficulty-evaluation-training-pilot-500.ai-review.jsonl`;
const PROPOSED_LABELS_PATH = `${REVIEW_DIRECTORY}/difficulty-evaluation-training-pilot-500.ai-proposed-labels.jsonl`;
const HUMAN_QUEUE_PATH = `${REVIEW_DIRECTORY}/difficulty-evaluation-training-pilot-500.human-judgment.jsonl`;
const HUMAN_MARKDOWN_PATH = `${REVIEW_DIRECTORY}/difficulty-evaluation-training-pilot-500.human-judgment.md`;
const GPT_PACKET_PATH = `${REVIEW_DIRECTORY}/difficulty-evaluation-training-pilot-500.gpt-adjudication-packet.md`;
const MANIFEST_PATH = `${REVIEW_DIRECTORY}/difficulty-evaluation-training-pilot-500.ai-review-manifest.json`;

const SOURCE_DATASET_VERSION = "difficulty_eval_2026_07_13_pilot_500_v1";
const PROPOSED_DATASET_VERSION = "difficulty_eval_2026_07_13_pilot_500_ai_review_v1";
const REVIEW_TOOL_VERSION = "difficulty-pilot-ai-review.v1";
const CREATED_AT = "2026-07-14T00:00:00Z";

const CATEGORIES = ["general", "code", "translation", "summarization", "reasoning"];
const DIFFICULTIES = ["simple", "complex"];
const LANGUAGES = ["ko", "en", "mixed"];
const TASK_BUCKETS = ["count_1", "count_2", "count_3_plus"];
const CONSTRAINT_BUCKETS = ["count_0_to_1", "count_2", "count_3_plus"];
const SCOPE_BUCKETS = ["count_1", "count_2_to_3", "count_4_plus"];
const DEPENDENCY_BUCKETS = ["depth_0_to_1", "depth_2", "depth_3_plus"];
const REQUIRED_EVALUATION_SLICES = [
  "negation",
  "indirect_expression",
  "synonym",
  "short_complex",
  "long_simple",
  "payload_contamination",
  "korean",
  "english",
  "mixed_language",
  "category_confusion",
  "ood_terminology",
];

const SEMANTIC_LABELS = {
  general: new Set([
    "general_qa",
    "general_explanation",
    "general_extraction",
    "general_support",
    "general_transformation",
    "general_other",
  ]),
  code: new Set([
    "code_generation",
    "code_debugging",
    "code_refactoring",
    "code_review",
    "code_explanation",
    "code_design",
  ]),
  translation: new Set([
    "translation_direct",
    "translation_localization",
    "translation_style_preserving",
  ]),
  summarization: new Set([
    "summarization_direct",
    "summarization_key_points",
    "summarization_structured",
    "summarization_multi_source",
  ]),
  reasoning: new Set([
    "reasoning_comparison",
    "reasoning_planning",
    "reasoning_decision",
    "reasoning_constraint_solving",
    "reasoning_causal",
  ]),
};

function policy(taskBucket, constraintBucket, scopeBucket, dependencyBucket, expectedSemanticLabel) {
  return { taskBucket, constraintBucket, scopeBucket, dependencyBucket, expectedSemanticLabel };
}

const P = policy;
const TEMPLATE_POLICIES = {
  "general/simple": [
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "general_qa"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "general_qa"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "general_qa"),
    P("count_1", "count_3_plus", "count_1", "depth_0_to_1", "general_qa"),
    P("count_1", "count_2", "count_1", "depth_0_to_1", "general_qa"),
  ],
  "general/complex": [
    P("count_3_plus", "count_2", "count_1", "depth_3_plus", "general_support"),
    P("count_2", "count_2", "count_2_to_3", "depth_3_plus", "general_support"),
    P("count_3_plus", "count_0_to_1", "count_4_plus", "depth_3_plus", "general_support"),
    P("count_3_plus", "count_0_to_1", "count_2_to_3", "depth_3_plus", "general_support"),
    P("count_3_plus", "count_0_to_1", "count_1", "depth_3_plus", "general_support"),
  ],
  "code/simple": [
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "code_generation"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "code_generation"),
    P("count_2", "count_0_to_1", "count_1", "depth_0_to_1", "code_generation"),
    P("count_1", "count_3_plus", "count_1", "depth_0_to_1", "code_generation"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "code_generation"),
  ],
  "code/complex": [
    P("count_3_plus", "count_0_to_1", "count_1", "depth_3_plus", "code_debugging"),
    P("count_1", "count_3_plus", "count_1", "depth_3_plus", "code_refactoring"),
    P("count_3_plus", "count_2", "count_2_to_3", "depth_3_plus", "code_design"),
    P("count_2", "count_3_plus", "count_1", "depth_3_plus", "code_debugging"),
    P("count_3_plus", "count_0_to_1", "count_1", "depth_3_plus", "code_debugging"),
  ],
  "translation/simple": [
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "translation_direct"),
    P("count_1", "count_2", "count_1", "depth_0_to_1", "translation_direct"),
    P("count_1", "count_2", "count_1", "depth_0_to_1", "translation_direct"),
    P("count_1", "count_3_plus", "count_1", "depth_0_to_1", "translation_style_preserving"),
    P("count_1", "count_3_plus", "count_1", "depth_0_to_1", "translation_direct"),
  ],
  "translation/complex": [
    P("count_1", "count_3_plus", "count_1", "depth_2", "translation_style_preserving"),
    P("count_2", "count_2", "count_1", "depth_2", "translation_localization"),
    P("count_2", "count_3_plus", "count_1", "depth_2", "translation_style_preserving"),
    P("count_1", "count_3_plus", "count_1", "depth_2", "translation_localization"),
    P("count_3_plus", "count_3_plus", "count_2_to_3", "depth_2", "translation_localization"),
  ],
  "summarization/simple": [
    P("count_1", "count_2", "count_1", "depth_0_to_1", "summarization_key_points"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "summarization_key_points"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "summarization_direct"),
    P("count_1", "count_2", "count_1", "depth_0_to_1", "summarization_direct"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "summarization_direct"),
  ],
  "summarization/complex": [
    P("count_2", "count_3_plus", "count_2_to_3", "depth_3_plus", "summarization_multi_source"),
    P("count_1", "count_3_plus", "count_2_to_3", "depth_2", "summarization_multi_source"),
    P("count_3_plus", "count_2", "count_2_to_3", "depth_3_plus", "summarization_structured"),
    P("count_1", "count_3_plus", "count_2_to_3", "depth_2", "summarization_structured"),
    P("count_1", "count_3_plus", "count_2_to_3", "depth_2", "summarization_multi_source"),
  ],
  "reasoning/simple": [
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "reasoning_decision"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "reasoning_decision"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "reasoning_decision"),
    P("count_1", "count_2", "count_1", "depth_0_to_1", "reasoning_decision"),
    P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "reasoning_decision"),
  ],
  "reasoning/complex": [
    P("count_2", "count_2", "count_2_to_3", "depth_2", "reasoning_decision"),
    P("count_2", "count_0_to_1", "count_2_to_3", "depth_3_plus", "reasoning_planning"),
    P("count_3_plus", "count_0_to_1", "count_3_plus", "depth_3_plus", "reasoning_causal"),
    P("count_2", "count_3_plus", "count_2_to_3", "depth_2", "reasoning_constraint_solving"),
    P("count_3_plus", "count_3_plus", "count_2_to_3", "depth_3_plus", "reasoning_decision"),
  ],
};

const OVERRIDE_POLICIES = {
  "general/simple/taskcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "general_support"),
  "general/complex/taskcontrast": P("count_2", "count_0_to_1", "count_1", "depth_2", "general_support"),
  "general/simple/constraintcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "general_support"),
  "general/complex/constraintcontrast": P("count_1", "count_0_to_1", "count_2_to_3", "depth_2", "general_support"),
  "general/simple/categoryconfusion": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "general_support"),
  "general/complex/categoryconfusion": P("count_3_plus", "count_0_to_1", "count_2_to_3", "depth_3_plus", "general_support"),
  "general/simple/negativecontext": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "general_support"),
  "general/complex/negativecontext": P("count_3_plus", "count_0_to_1", "count_2_to_3", "depth_3_plus", "general_support"),

  "code/simple/taskcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "code_refactoring"),
  "code/complex/taskcontrast": P("count_2", "count_0_to_1", "count_2_to_3", "depth_2", "code_refactoring"),
  "code/simple/constraintcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "code_refactoring"),
  "code/complex/constraintcontrast": P("count_1", "count_0_to_1", "count_1", "depth_2", "code_refactoring"),
  "code/simple/categoryconfusion": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "code_generation"),
  "code/complex/categoryconfusion": P("count_3_plus", "count_0_to_1", "count_1", "depth_3_plus", "code_debugging"),
  "code/simple/negativecontext": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "code_generation"),
  "code/complex/negativecontext": P("count_1", "count_2", "count_1", "depth_3_plus", "code_refactoring"),

  "translation/simple/taskcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "translation_direct"),
  "translation/complex/taskcontrast": P("count_2", "count_0_to_1", "count_1", "depth_2", "translation_direct"),
  "translation/simple/constraintcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "translation_direct"),
  "translation/complex/constraintcontrast": P("count_1", "count_2", "count_1", "depth_0_to_1", "translation_style_preserving"),
  "translation/simple/categoryconfusion": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "translation_direct"),
  "translation/complex/categoryconfusion": P("count_2", "count_3_plus", "count_1", "depth_2", "translation_style_preserving"),
  "translation/simple/negativecontext": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "translation_direct"),
  "translation/complex/negativecontext": P("count_1", "count_3_plus", "count_2_to_3", "depth_2", "translation_localization"),

  "summarization/simple/taskcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "summarization_direct"),
  "summarization/complex/taskcontrast": P("count_2", "count_0_to_1", "count_1", "depth_2", "summarization_structured"),
  "summarization/simple/constraintcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "summarization_direct"),
  "summarization/complex/constraintcontrast": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "summarization_direct"),
  "summarization/simple/categoryconfusion": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "summarization_direct"),
  "summarization/complex/categoryconfusion": P("count_2", "count_3_plus", "count_2_to_3", "depth_2", "summarization_multi_source"),
  "summarization/simple/negativecontext": P("count_1", "count_0_to_1", "count_1", "depth_0_to_1", "summarization_direct"),
  "summarization/complex/negativecontext": P("count_1", "count_3_plus", "count_2_to_3", "depth_2", "summarization_multi_source"),

  "reasoning/simple/taskcontrast": P("count_1", "count_0_to_1", "count_2_to_3", "depth_0_to_1", "reasoning_decision"),
  "reasoning/complex/taskcontrast": P("count_2", "count_0_to_1", "count_2_to_3", "depth_2", "reasoning_decision"),
  "reasoning/simple/constraintcontrast": P("count_1", "count_0_to_1", "count_2_to_3", "depth_0_to_1", "reasoning_decision"),
  "reasoning/complex/constraintcontrast": P("count_1", "count_2", "count_2_to_3", "depth_2", "reasoning_decision"),
  "reasoning/simple/categoryconfusion": P("count_1", "count_0_to_1", "count_2_to_3", "depth_0_to_1", "reasoning_comparison"),
  "reasoning/complex/categoryconfusion": P("count_2", "count_3_plus", "count_2_to_3", "depth_3_plus", "reasoning_planning"),
  "reasoning/simple/negativecontext": P("count_1", "count_0_to_1", "count_2_to_3", "depth_0_to_1", "reasoning_comparison"),
  "reasoning/complex/negativecontext": P("count_2", "count_3_plus", "count_2_to_3", "depth_2", "reasoning_decision"),
};

const SUMMARY_COMPLEX_SCOPES = [
  "count_2_to_3",
  "count_4_plus",
  "count_4_plus",
  "count_2_to_3",
  "count_2_to_3",
  "count_4_plus",
  "count_2_to_3",
  "count_4_plus",
  "count_4_plus",
  "count_4_plus",
];

const REASONING_SIMPLE_SCOPES = [
  "count_2_to_3",
  "count_1",
  "count_1",
  "count_2_to_3",
  "count_1",
  "count_2_to_3",
  "count_2_to_3",
  "count_1",
  "count_1",
  "count_2_to_3",
];

const REASONING_COMPLEX_SCOPES = [
  "count_2_to_3",
  "count_4_plus",
  "count_2_to_3",
  "count_4_plus",
  "count_2_to_3",
  "count_4_plus",
  "count_2_to_3",
  "count_4_plus",
  "count_2_to_3",
  "count_2_to_3",
];

const PROMPT_REWRITES = new Map([
  [
    "difficulty_general_simple_boundary_threshold_f05_v08",
    "Even if the wording sounds technical, state where the billing history page is without further analysis.",
  ],
  [
    "difficulty_general_simple_boundary_threshold_f05_v09",
    "Even if the wording sounds technical, state what the yellow status icon means without further analysis.",
  ],
  [
    "difficulty_general_complex_core_clear_f01_v10",
    "Enterprise plan의 renewal 운영 절차를 prepare, execute, verify 단계로 나누고 owner와 done condition을 정해줘.",
  ],
  [
    "difficulty_general_complex_boundary_threshold_f05_v10",
    "Enterprise plan의 renewal 운영 절차를 one paragraph로 쓰되 prerequisite, fallback, completion check를 모두 포함해줘.",
  ],
]);

const PAIRED_OVERRIDE_FAMILIES = new Set([
  "general/taskcontrast",
  "general/constraintcontrast",
  "general/categoryconfusion",
  "general/negativecontext",
  "code/taskcontrast",
  "code/constraintcontrast",
  "translation/taskcontrast",
  "summarization/constraintcontrast",
  "reasoning/taskcontrast",
  "reasoning/constraintcontrast",
]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseJsonl(text) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function parseSampleId(sampleId) {
  const match = /^difficulty_(general|code|translation|summarization|reasoning)_(simple|complex)_(core|boundary)_(clear|taskcontrast|constraintcontrast|categoryconfusion|negativecontext|longsimple|shortcomplex|threshold)_(f\d{2})_(v\d{2})$/u.exec(
    sampleId,
  );
  if (!match) {
    throw new Error(`unsupported pilot sampleId ${sampleId}`);
  }
  return {
    category: match[1],
    difficulty: match[2],
    kind: match[3],
    profile: match[4],
    family: match[5],
    familyIndex: Number(match[5].slice(1)) - 1,
    variant: match[6],
    variantIndex: Number(match[6].slice(1)) - 1,
  };
}

function proposedPolicy(meta) {
  const override = OVERRIDE_POLICIES[`${meta.category}/${meta.difficulty}/${meta.profile}`];
  const base = override ?? TEMPLATE_POLICIES[`${meta.category}/${meta.difficulty}`]?.[meta.familyIndex];
  if (!base) {
    throw new Error(`missing label policy for ${JSON.stringify(meta)}`);
  }
  const result = { ...base };
  if (!override && meta.category === "summarization" && meta.difficulty === "complex") {
    result.scopeBucket = SUMMARY_COMPLEX_SCOPES[meta.variantIndex];
  }
  if (!override && meta.category === "reasoning" && meta.difficulty === "simple") {
    result.scopeBucket = REASONING_SIMPLE_SCOPES[meta.variantIndex];
  }
  if (!override && meta.category === "reasoning" && meta.difficulty === "complex") {
    result.scopeBucket = REASONING_COMPLEX_SCOPES[meta.variantIndex];
  }
  return result;
}

function promptFamily(meta) {
  const overrideProfiles = new Set([
    "taskcontrast",
    "constraintcontrast",
    "categoryconfusion",
    "negativecontext",
  ]);
  if (overrideProfiles.has(meta.profile)) {
    const pairKey = `${meta.category}/${meta.profile}`;
    return PAIRED_OVERRIDE_FAMILIES.has(pairKey)
      ? `pilot.${meta.category}.${meta.profile}`
      : `pilot.${meta.category}.${meta.difficulty}.${meta.profile}`;
  }
  return `pilot.${meta.category}.${meta.difficulty}.template.${meta.family}`;
}

function reviewDisposition(meta) {
  if (meta.profile === "threshold") {
    return {
      disposition: "needs_human_judgment",
      reasonCodes: ["difficulty_threshold"],
      humanQuestions: ["confirm_expected_difficulty", "confirm_semantic_bucket_targets"],
    };
  }
  if (meta.profile === "taskcontrast") {
    return {
      disposition: "needs_human_judgment",
      reasonCodes: ["single_added_task_boundary"],
      humanQuestions: [
        "confirm_added_task_crosses_difficulty_boundary",
        "confirm_prompt_family_pairing",
      ],
    };
  }
  if (meta.profile === "constraintcontrast") {
    return {
      disposition: "needs_human_judgment",
      reasonCodes: ["single_added_constraint_boundary"],
      humanQuestions: [
        "confirm_added_constraint_crosses_difficulty_boundary",
        "confirm_prompt_family_pairing",
      ],
    };
  }
  return {
    disposition: "ai_review_complete",
    reasonCodes: ["labels_consistent_with_review_policy"],
    humanQuestions: [],
  };
}

function evaluationSlices(meta, prompt) {
  const slices = [];
  const languageSlice = { ko: "korean", en: "english", mixed: "mixed_language" }[meta.language];
  slices.push(languageSlice);
  const runeLength = [...prompt].length;
  if (meta.difficulty === "simple" && runeLength > 120) slices.push("long_simple");
  if (meta.difficulty === "complex" && runeLength <= 120) slices.push("short_complex");
  if (/\b(?:without|do not|no longer|not needed)\b|없이|하지 말|필요 없|빼고|바꾸지 마|추가하지 말|가정하지 말/iu.test(prompt)) {
    slices.push("negation");
  }
  if (meta.profile === "categoryconfusion" || meta.profile === "negativecontext") {
    slices.push("category_confusion");
  }
  return [...new Set(slices)];
}

function reviewRecord(sourceRecord) {
  const meta = parseSampleId(sourceRecord.sampleId);
  if (
    sourceRecord.schemaVersion !== "gatelm.difficulty-evaluation-record.v1" ||
    sourceRecord.datasetVersion !== SOURCE_DATASET_VERSION ||
    sourceRecord.expectedCategory !== meta.category ||
    sourceRecord.expectedDifficulty !== meta.difficulty ||
    !LANGUAGES.includes(sourceRecord.language) ||
    sourceRecord.labelSource !== "synthetic_fixture" ||
    sourceRecord.consentType !== "synthetic" ||
    sourceRecord.source !== "synthetic_fixture"
  ) {
    throw new Error(`source metadata mismatch for ${sourceRecord.sampleId}`);
  }
  meta.language = sourceRecord.language;
  const labels = proposedPolicy(meta);
  const disposition = reviewDisposition(meta);
  const proposedPrompt = PROMPT_REWRITES.get(sourceRecord.sampleId) ?? sourceRecord.redactedPrompt;
  const promptRewritten = proposedPrompt !== sourceRecord.redactedPrompt;
  if (promptRewritten) {
    disposition.reasonCodes.push("prompt_template_artifact_corrected");
    disposition.humanQuestions.push("confirm_prompt_rewrite");
  }
  const proposedRecord = {
    schemaVersion: "gatelm.difficulty-label-record.v2",
    datasetVersion: PROPOSED_DATASET_VERSION,
    sampleId: sourceRecord.sampleId,
    redactedPrompt: proposedPrompt,
    expectedCategory: meta.category,
    expectedDifficulty: meta.difficulty,
    semanticInputStatus: "eligible",
    ...labels,
    promptFamily: promptFamily(meta),
    language: sourceRecord.language,
    expectedInstructionPayloadBoundary: {
      kind: "instruction_only",
      boundaryType: "none",
      confidence: "none",
      payloadBlockCount: "zero",
    },
    evaluationSlices: evaluationSlices(meta, proposedPrompt),
    labelSource: "synthetic_fixture",
    consentType: "synthetic",
    source: "synthetic_fixture",
    redactionVersion: sourceRecord.redactionVersion,
    createdAt: CREATED_AT,
    labelConfidence: disposition.disposition === "needs_human_judgment" ? 0.65 : 0.86,
    reviewStatus: "pending",
    reviewerCount: 0,
    reviewerNote: "AI-assisted label proposal; final human review pending.",
  };
  return {
    schemaVersion: "gatelm.difficulty-ai-review-suggestion.v1",
    reviewToolVersion: REVIEW_TOOL_VERSION,
    sourceDatasetVersion: SOURCE_DATASET_VERSION,
    sourceSampleId: sourceRecord.sampleId,
    sourceRecordSha256: sha256(`${JSON.stringify(sourceRecord)}\n`),
    disposition: disposition.disposition,
    reasonCodes: disposition.reasonCodes,
    humanQuestions: disposition.humanQuestions,
    changes: {
      schemaProjectedToV2: true,
      promptRewritten,
      categoryChanged: sourceRecord.expectedCategory !== proposedRecord.expectedCategory,
      difficultyChanged: sourceRecord.expectedDifficulty !== proposedRecord.expectedDifficulty,
      familyReassigned: true,
    },
    proposedRecord,
  };
}

function validateProposedRecord(record) {
  if (
    record.schemaVersion !== "gatelm.difficulty-label-record.v2" ||
    record.datasetVersion !== PROPOSED_DATASET_VERSION ||
    !CATEGORIES.includes(record.expectedCategory) ||
    !DIFFICULTIES.includes(record.expectedDifficulty) ||
    record.semanticInputStatus !== "eligible" ||
    !TASK_BUCKETS.includes(record.taskBucket) ||
    !CONSTRAINT_BUCKETS.includes(record.constraintBucket) ||
    !SCOPE_BUCKETS.includes(record.scopeBucket) ||
    !DEPENDENCY_BUCKETS.includes(record.dependencyBucket) ||
    !SEMANTIC_LABELS[record.expectedCategory].has(record.expectedSemanticLabel) ||
    !/^[a-z0-9][a-z0-9._:-]+$/u.test(record.promptFamily) ||
    !LANGUAGES.includes(record.language)
  ) {
    throw new Error(`invalid proposed labels for ${record.sampleId}`);
  }
  if (
    record.expectedInstructionPayloadBoundary.kind !== "instruction_only" ||
    record.expectedInstructionPayloadBoundary.boundaryType !== "none" ||
    record.expectedInstructionPayloadBoundary.confidence !== "none" ||
    record.expectedInstructionPayloadBoundary.payloadBlockCount !== "zero"
  ) {
    throw new Error(`invalid proposed boundary for ${record.sampleId}`);
  }
  const languageSlice = { ko: "korean", en: "english", mixed: "mixed_language" }[record.language];
  if (!record.evaluationSlices.includes(languageSlice)) {
    throw new Error(`missing language slice for ${record.sampleId}`);
  }
  const length = [...record.redactedPrompt].length;
  if (
    record.evaluationSlices.includes("long_simple") !==
      (record.expectedDifficulty === "simple" && length > 120) ||
    record.evaluationSlices.includes("short_complex") !==
      (record.expectedDifficulty === "complex" && length <= 120)
  ) {
    throw new Error(`length slice mismatch for ${record.sampleId}`);
  }
  if (
    record.labelSource !== "synthetic_fixture" ||
    record.consentType !== "synthetic" ||
    record.source !== "synthetic_fixture" ||
    record.reviewStatus !== "pending" ||
    record.reviewerCount !== 0
  ) {
    throw new Error(`AI proposal must remain non-human and pending for ${record.sampleId}`);
  }
}

function countBy(items, select) {
  const counts = {};
  for (const item of items) {
    const key = select(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function markdownFor(queue, manifest) {
  const lines = [
    "# Difficulty Pilot 500 — Human Judgment Queue",
    "",
    "> AI 보조 전수 검수 결과입니다. 이 문서는 사람 승인을 대신하지 않으며 원본 500건은 계속 `trainingEligible=false`입니다.",
    "",
    `- 원본: \`${SOURCE_DATASET_PATH}\``,
    `- 원본 SHA-256: \`${manifest.sourceDatasetSha256}\``,
    `- 전수 검수: ${manifest.counts.reviewedRecords}건`,
    `- 사람 판단 큐: ${manifest.counts.humanJudgmentQueueRecords}건`,
    `- AI 검수 완료(최종 사람 승인 대기): ${manifest.counts.aiReviewCompleteRecords}건`,
    `- 명백한 prompt template 수정 제안: ${manifest.counts.promptRewriteSuggestions}건`,
    `- 누락된 필수 slice: ${manifest.coverage.missingRequiredSlices.map((value) => `\`${value}\``).join(", ")}`,
    "",
    "## 판단 방법",
    "",
    "각 항목에서 category·difficulty·네 bucket·prompt family와 문장 수정안을 확인합니다. 수락해도 전체 데이터셋은 별도의 최종 사람 승인 전까지 학습에 사용할 수 없습니다.",
    "",
  ];
  queue.forEach((suggestion, index) => {
    const record = suggestion.proposedRecord;
    lines.push(
      `## ${index + 1}. \`${suggestion.sourceSampleId}\``,
      "",
      `- 판단 사유: ${suggestion.reasonCodes.map((value) => `\`${value}\``).join(", ")}`,
      `- 확인 질문: ${suggestion.humanQuestions.map((value) => `\`${value}\``).join(", ")}`,
      `- 제안 label: \`${record.expectedCategory}/${record.expectedDifficulty}\`, \`${record.expectedSemanticLabel}\``,
      `- 제안 bucket: \`${record.taskBucket}\`, \`${record.constraintBucket}\`, \`${record.scopeBucket}\`, \`${record.dependencyBucket}\``,
      `- 제안 family: \`${record.promptFamily}\``,
      `- prompt 수정 제안: ${suggestion.changes.promptRewritten ? "있음" : "없음"}`,
      "",
      `> ${record.redactedPrompt.replaceAll("\n", "  \n> ")}`,
      "",
      "- [ ] 제안 수락",
      "- [ ] 수정 필요",
      "",
    );
  });
  return `${lines.join("\n")}\n`;
}

function gptPacketFor(queue, sourceRecords) {
  const sourceById = new Map(sourceRecords.map((record) => [record.sampleId, record]));
  const inputLines = queue.map((suggestion) => {
    const source = sourceById.get(suggestion.sourceSampleId);
    const proposed = suggestion.proposedRecord;
    return JSON.stringify({
      sampleId: suggestion.sourceSampleId,
      sourcePrompt: source.redactedPrompt,
      proposedPrompt: proposed.redactedPrompt,
      language: proposed.language,
      reviewReasonCodes: suggestion.reasonCodes,
      proposed: {
        expectedCategory: proposed.expectedCategory,
        expectedDifficulty: proposed.expectedDifficulty,
        semanticInputStatus: proposed.semanticInputStatus,
        taskBucket: proposed.taskBucket,
        constraintBucket: proposed.constraintBucket,
        scopeBucket: proposed.scopeBucket,
        dependencyBucket: proposed.dependencyBucket,
        expectedSemanticLabel: proposed.expectedSemanticLabel,
        promptFamily: proposed.promptFamily,
        expectedInstructionPayloadBoundary: proposed.expectedInstructionPayloadBoundary,
        evaluationSlices: proposed.evaluationSlices,
      },
    });
  });
  return `# GateLM Difficulty Pilot — GPT Adjudication Packet

## GPT에게 전달할 작업 지시

당신은 GateLM difficulty dataset의 독립 adjudicator다. 아래 120개 synthetic prompt를 **모두** 검토하고, 기존 제안값을 정답으로 가정하지 말고 label guide에 따라 다시 판정하라. 어떤 항목도 생략하거나 합치지 마라.

이 작업은 AI 재검수이며 사람 검수나 최종 승인을 의미하지 않는다. 출력에 \`human_review\`, \`approved\`, reviewer identity를 만들지 마라.

판정 순서:

1. primary requested output으로 category를 하나 선택한다.
2. category 내부 primary intent로 semantic label을 하나 선택한다.
3. 의미 있는 instruction만 기준으로 task, constraint, scope, dependency bucket을 센다.
4. 길이가 아니라 독립 작업·제약·source 종합·의존 깊이로 simple/complex를 결정한다.
5. 같은 primary category와 semantic label의 paraphrase·언어 변형·simple/complex contrast는 같은 promptFamily로 묶는다.
6. 문장이 부자연스럽거나 template 결합 오류가 있으면 promptAction과 replacementPrompt로 교정한다.

## 허용 값

- expectedCategory: \`general | code | translation | summarization | reasoning\`
- expectedDifficulty: \`simple | complex\`
- semanticInputStatus: \`eligible | empty_instruction\`
- taskBucket: \`count_1 | count_2 | count_3_plus | not_applicable\`
- constraintBucket: \`count_0_to_1 | count_2 | count_3_plus | not_applicable\`
- scopeBucket: \`count_1 | count_2_to_3 | count_4_plus | not_applicable\`
- dependencyBucket: \`depth_0_to_1 | depth_2 | depth_3_plus | not_applicable\`
- boundary kind: \`instruction_only | explicit_separation | ambiguous_separation | payload_only\`
- evaluationSlices: \`negation | indirect_expression | synonym | short_complex | long_simple | payload_contamination | korean | english | mixed_language | category_confusion | ood_terminology\`

Category별 semantic label:

- general: \`general_qa | general_explanation | general_extraction | general_support | general_transformation | general_other\`
- code: \`code_generation | code_debugging | code_refactoring | code_review | code_explanation | code_design\`
- translation: \`translation_direct | translation_localization | translation_style_preserving\`
- summarization: \`summarization_direct | summarization_key_points | summarization_structured | summarization_multi_source\`
- reasoning: \`reasoning_comparison | reasoning_planning | reasoning_decision | reasoning_constraint_solving | reasoning_causal\`

## 출력 형식

응답은 설명, Markdown, code fence 없이 **JSONL 120줄만** 반환하라. 입력 순서를 유지하고 각 sampleId를 정확히 한 번 사용하라.

각 줄의 형태:

    {"schemaVersion":"gatelm.difficulty-gpt-adjudication.v1","sampleId":"...","decision":"accept|correct","expectedCategory":"...","expectedDifficulty":"...","semanticInputStatus":"eligible|empty_instruction","taskBucket":"...","constraintBucket":"...","scopeBucket":"...","dependencyBucket":"...","expectedSemanticLabel":"...","promptFamily":"...","expectedInstructionPayloadBoundary":{"kind":"...","boundaryType":"...","confidence":"...","payloadBlockCount":"..."},"evaluationSlices":["..."],"promptAction":"keep_source|accept_proposed_rewrite|replace","replacementPrompt":null,"confidence":0.0,"rationaleCodes":["accepted_as_proposed|difficulty_changed|semantic_label_changed|bucket_changed|family_changed|boundary_changed|slice_changed|prompt_rewrite_changed|insufficient_context"]}

추가 규칙:

- \`decision=accept\`는 proposed 전체를 수락할 때만 사용한다.
- 하나라도 바꾸면 \`decision=correct\`와 해당 rationaleCodes를 사용한다.
- \`replacementPrompt\`는 promptAction이 \`replace\`일 때만 문자열이고, 그 외에는 null이다.
- 확신이 낮아도 항목을 생략하지 말고 최선의 판정과 confidence를 반환한다.
- short_complex는 complex이면서 Unicode code point 길이 120 이하, long_simple은 simple이면서 120 초과일 때만 포함한다.
- language slice는 language와 일치해야 한다.

## 검토할 120개 입력

<!-- BEGIN_REVIEW_ITEMS_JSONL -->
${inputLines.join("\n")}
<!-- END_REVIEW_ITEMS_JSONL -->
`;
}

export function buildReviewArtifacts(sourceText) {
  const sourceRecords = parseJsonl(sourceText);
  if (sourceRecords.length !== 500) {
    throw new Error(`expected 500 source records, got ${sourceRecords.length}`);
  }
  const suggestions = sourceRecords.map(reviewRecord);
  const sourceIds = new Set(sourceRecords.map((record) => record.sampleId));
  if (sourceIds.size !== 500 || new Set(suggestions.map((item) => item.sourceSampleId)).size !== 500) {
    throw new Error("review must map one-to-one to 500 unique source records");
  }
  for (const suggestion of suggestions) validateProposedRecord(suggestion.proposedRecord);

  const families = new Map();
  for (const suggestion of suggestions) {
    const record = suggestion.proposedRecord;
    const key = record.promptFamily;
    const signature = `${record.expectedCategory}/${record.expectedSemanticLabel}`;
    const previous = families.get(key);
    if (previous && previous !== signature) {
      throw new Error(`family ${key} mixes semantic labels: ${previous} vs ${signature}`);
    }
    families.set(key, signature);
  }

  const humanQueue = suggestions.filter((item) => item.disposition === "needs_human_judgment");
  const reviewText = `${suggestions.map((item) => JSON.stringify(item)).join("\n")}\n`;
  const proposedLabelsText = `${suggestions
    .map((item) => JSON.stringify(item.proposedRecord))
    .join("\n")}\n`;
  const humanQueueText = `${humanQueue.map((item) => JSON.stringify(item)).join("\n")}\n`;
  const sliceRecordCounts = Object.fromEntries(
    REQUIRED_EVALUATION_SLICES.map((slice) => [
      slice,
      suggestions.filter((item) => item.proposedRecord.evaluationSlices.includes(slice)).length,
    ]),
  );
  const missingRequiredSlices = REQUIRED_EVALUATION_SLICES.filter(
    (slice) => sliceRecordCounts[slice] === 0,
  );
  const manifest = {
    schemaVersion: "gatelm.difficulty-ai-review-manifest.v1",
    reviewToolVersion: REVIEW_TOOL_VERSION,
    status: "ai_review_complete_human_approval_pending",
    sourceDatasetPath: SOURCE_DATASET_PATH,
    sourceDatasetVersion: SOURCE_DATASET_VERSION,
    sourceDatasetSha256: sha256(sourceText),
    proposedDatasetVersion: PROPOSED_DATASET_VERSION,
    trainingEligible: false,
    humanReviewClaimed: false,
    counts: {
      reviewedRecords: suggestions.length,
      aiReviewCompleteRecords: suggestions.length - humanQueue.length,
      humanJudgmentQueueRecords: humanQueue.length,
      finalHumanApprovalPendingRecords: suggestions.length,
      promptRewriteSuggestions: suggestions.filter((item) => item.changes.promptRewritten).length,
      proposedFamilies: families.size,
      humanReviewedRecords: 0,
      approvedRecords: 0,
    },
    byCategory: Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        {
          reviewed: suggestions.filter((item) => item.proposedRecord.expectedCategory === category).length,
          humanJudgment: humanQueue.filter((item) => item.proposedRecord.expectedCategory === category).length,
        },
      ]),
    ),
    byReasonCode: countBy(humanQueue.flatMap((item) => item.reasonCodes), (value) => value),
    coverage: {
      requiredSliceRecordCounts: sliceRecordCounts,
      missingRequiredSlices,
    },
    datasetReadinessBlockers: [
      "final_human_approval_pending",
      "human_judgment_queue_pending",
      "minimum_family_policy_decision_required",
      ...(missingRequiredSlices.length > 0 ? ["required_slice_coverage_missing"] : []),
    ],
    artifacts: {
      fullReview: { path: REVIEW_PATH, sha256: sha256(reviewText) },
      proposedLabels: { path: PROPOSED_LABELS_PATH, sha256: sha256(proposedLabelsText) },
      humanJudgmentQueue: { path: HUMAN_QUEUE_PATH, sha256: sha256(humanQueueText) },
      humanReadableQueue: { path: HUMAN_MARKDOWN_PATH },
    },
    createdAt: CREATED_AT,
  };
  const markdownText = markdownFor(humanQueue, manifest);
  const gptPacketText = gptPacketFor(humanQueue, sourceRecords);
  manifest.artifacts.humanReadableQueue.sha256 = sha256(markdownText);
  manifest.artifacts.gptAdjudicationPacket = {
    path: GPT_PACKET_PATH,
    sha256: sha256(gptPacketText),
  };

  if (
    manifest.counts.reviewedRecords !== 500 ||
    manifest.counts.humanJudgmentQueueRecords !== 120 ||
    manifest.counts.aiReviewCompleteRecords !== 380 ||
    manifest.counts.promptRewriteSuggestions !== 4 ||
    manifest.byReasonCode.difficulty_threshold !== 100 ||
    manifest.byReasonCode.single_added_task_boundary !== 10 ||
    manifest.byReasonCode.single_added_constraint_boundary !== 10
  ) {
    throw new Error(`unexpected review distribution: ${JSON.stringify(manifest.counts)}`);
  }
  return {
    suggestions,
    humanQueue,
    manifest,
    files: {
      [REVIEW_PATH]: reviewText,
      [PROPOSED_LABELS_PATH]: proposedLabelsText,
      [HUMAN_QUEUE_PATH]: humanQueueText,
      [HUMAN_MARKDOWN_PATH]: markdownText,
      [GPT_PACKET_PATH]: gptPacketText,
      [MANIFEST_PATH]: `${JSON.stringify(manifest, null, 2)}\n`,
    },
  };
}

function writeOrCheck(files, check) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.resolve(relativePath);
    if (check) {
      const current = readFileSync(absolutePath, "utf8");
      if (current !== content) {
        throw new Error(`generated review artifact is stale: ${relativePath}`);
      }
      continue;
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
}

function main() {
  const check = process.argv.includes("--check");
  const sourceText = readFileSync(path.resolve(SOURCE_DATASET_PATH), "utf8");
  const result = buildReviewArtifacts(sourceText);
  writeOrCheck(result.files, check);
  const verb = check ? "verified" : "wrote";
  console.log(`${verb} ${result.manifest.counts.reviewedRecords} AI review suggestions`);
  console.log(`${verb} ${result.manifest.counts.humanJudgmentQueueRecords} human-judgment items`);
  console.log("human_review and approved remain at 0 until a person completes the queue");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main();
}
