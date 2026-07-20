import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const assignmentSeed = 2026071802;
const policyVersion = "difficulty-independent-ood-codex-adjudication.2026-07-20.v1";
const queuePath =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/reviewer-a/priority/02-core-label-conflicts.jsonl";
const candidatePath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl";
const outputDir =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/codex-adjudication";
const outputPath = `${outputDir}/difficulty-independent-ood-5000.codex-core-adjudication.jsonl`;
const humanQueuePath = `${outputDir}/difficulty-independent-ood-5000.codex-residual-human-review-queue.jsonl`;
const policyPath = `${outputDir}/ADJUDICATION-POLICY.md`;
const reportPath = `${outputDir}/ADJUDICATION-REPORT.md`;
const manifestPath = `${outputDir}/MANIFEST.json`;

const rendererIds = [
  "direct",
  "question",
  "indirect_need",
  "chat",
  "email",
  "ticket",
  "bullets",
  "acceptance",
  "yaml",
  "table",
  "code_fence_payload",
  "blockquote_payload",
  "begin_end_payload",
  "role_tags",
  "inline_cue",
  "multiple_sources",
  "slash_compact",
  "long_context",
  "parenthetical",
  "condition_first",
  "output_first",
  "negated_distractor",
  "synonym",
  "category_noise",
  "ood_term",
  "rough_note",
  "voice_memo",
  "handoff",
  "two_turn",
  "form",
  "json_like",
  "dependency_compact",
  "ultra_compact",
  "before_after",
  "meeting_note",
  "mobile_chat",
  "formal_policy",
  "ordered_steps",
  "fragments",
  "rhetorical",
  "unordered_note",
  "scope_first",
  "term_and_noise",
  "polite_indirect",
];

const profiles = {
  bounded: [
    { tasks: 1, constraints: 0, scopes: 1, sources: 1, dependencyDepth: 0, workflow: "bounded_lookup" },
    { tasks: 1, constraints: 1, scopes: 2, sources: 1, dependencyDepth: 1, workflow: "bounded_transform" },
    { tasks: 2, constraints: 0, scopes: 1, sources: 1, dependencyDepth: 0, workflow: "independent_pair" },
    { tasks: 1, constraints: 1, scopes: 1, sources: 2, dependencyDepth: 1, workflow: "bounded_compare" },
    { tasks: 2, constraints: 1, scopes: 2, sources: 1, dependencyDepth: 1, workflow: "independent_pair" },
  ],
  interlocked: [
    { tasks: 2, constraints: 2, scopes: 3, sources: 2, dependencyDepth: 2, workflow: "cross_source_reconciliation" },
    { tasks: 1, constraints: 3, scopes: 4, sources: 2, dependencyDepth: 2, workflow: "constraint_interlock" },
    { tasks: 3, constraints: 1, scopes: 4, sources: 3, dependencyDepth: 3, workflow: "contingent_workflow" },
    { tasks: 2, constraints: 3, scopes: 5, sources: 4, dependencyDepth: 3, workflow: "cross_source_reconciliation" },
    { tasks: 3, constraints: 2, scopes: 3, sources: 2, dependencyDepth: 2, workflow: "contingent_decision" },
  ],
};

const constraintVisible = new Set([
  "question",
  "bullets",
  "acceptance",
  "yaml",
  "inline_cue",
  "slash_compact",
  "parenthetical",
  "condition_first",
  "synonym",
  "voice_memo",
  "handoff",
  "json_like",
  "dependency_compact",
  "ultra_compact",
  "before_after",
  "meeting_note",
  "formal_policy",
  "ordered_steps",
  "fragments",
  "unordered_note",
  "scope_first",
]);

const outputConstraintVisible = new Set([
  "direct",
  "chat",
  "email",
  "ticket",
  "bullets",
  "acceptance",
  "yaml",
  "table",
  "code_fence_payload",
  "begin_end_payload",
  "role_tags",
  "multiple_sources",
  "slash_compact",
  "long_context",
  "parenthetical",
  "output_first",
  "negated_distractor",
  "category_noise",
  "ood_term",
  "rough_note",
  "handoff",
  "two_turn",
  "form",
  "json_like",
  "dependency_compact",
  "before_after",
  "meeting_note",
  "mobile_chat",
  "formal_policy",
  "ordered_steps",
  "fragments",
  "rhetorical",
  "unordered_note",
  "term_and_noise",
]);

const outputOnlyRenderers = new Set(["indirect_need", "synonym", "polite_indirect"]);
const coreFields = [
  "expectedCategory",
  "expectedDifficulty",
  "semanticInputStatus",
  "expectedSemanticLabel",
];
const structureFields = ["taskBucket", "constraintBucket", "scopeBucket", "dependencyBucket"];
const allAdjudicatedFields = [...coreFields, ...structureFields];

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const parseJsonl = (text) => text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const jsonl = (rows) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

function countBy(values, selector) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const key = selector(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

function categoryAndLocalIndex(promptFamily) {
  const match = /^independent2\.(general|code|translation|summarization|reasoning)\.[a-z_]+\.scenario\.f(\d{3})$/.exec(
    promptFamily,
  );
  if (!match) throw new Error(`unexpected prompt family: ${promptFamily}`);
  const familyNumber = Number(match[2]);
  if (familyNumber < 1 || familyNumber > 200) throw new Error(`invalid family number: ${promptFamily}`);
  return {
    category: match[1],
    structuralMode: familyNumber <= 100 ? "bounded" : "interlocked",
    localIndex: familyNumber <= 100 ? familyNumber - 1 : familyNumber - 101,
  };
}

function variantIndexFor(sampleId, promptFamily) {
  for (let variantIndex = 0; variantIndex < 5; variantIndex += 1) {
    const candidate = `ood2_${sha256(`${promptFamily}:${variantIndex}:${assignmentSeed}`).slice(0, 18)}`;
    if (candidate === sampleId) return variantIndex;
  }
  throw new Error(`sampleId does not match the Dataset 2 generator: ${sampleId}`);
}

function rendererFor(category, structuralMode, localIndex, variantIndex) {
  const categoryIndex = ["general", "code", "translation", "summarization", "reasoning"].indexOf(category);
  const familyOrdinal = categoryIndex * 200 + (structuralMode === "interlocked" ? 100 : 0) + localIndex;
  const used = new Set();
  let selected = -1;
  for (let currentVariant = 0; currentVariant <= variantIndex; currentVariant += 1) {
    let rendererIndex;
    if (currentVariant === 0 && structuralMode === "bounded" && localIndex % 4 === 0) {
      rendererIndex = rendererIds.indexOf("long_context");
    } else if (currentVariant === 0 && structuralMode === "interlocked" && localIndex % 4 === 0) {
      rendererIndex = rendererIds.indexOf("ultra_compact");
    } else {
      rendererIndex = (familyOrdinal * 17 + currentVariant * 11 + categoryIndex * 7) % rendererIds.length;
    }
    while (used.has(rendererIndex)) rendererIndex = (rendererIndex + 1) % rendererIds.length;
    used.add(rendererIndex);
    selected = rendererIndex;
  }
  return rendererIds[selected];
}

function bucketTask(count) {
  return count <= 1 ? "count_1" : count === 2 ? "count_2" : "count_3_plus";
}

function bucketConstraint(count) {
  return count <= 1 ? "count_0_to_1" : count === 2 ? "count_2" : "count_3_plus";
}

function bucketScope(count) {
  return count <= 1 ? "count_1" : count <= 3 ? "count_2_to_3" : "count_4_plus";
}

function bucketDependency(depth) {
  return depth <= 1 ? "depth_0_to_1" : depth === 2 ? "depth_2" : "depth_3_plus";
}

function surfaceFacts(row) {
  const family = categoryAndLocalIndex(row.promptFamily);
  const variantIndex = variantIndexFor(row.sampleId, row.promptFamily);
  const rendererId = rendererFor(family.category, family.structuralMode, family.localIndex, variantIndex);
  const profile = profiles[family.structuralMode][family.localIndex % profiles[family.structuralMode].length];

  let taskCount = outputOnlyRenderers.has(rendererId) ? 1 : profile.tasks;
  const taskEvidence = outputOnlyRenderers.has(rendererId)
    ? ["primary deliverable is the only surfaced operation"]
    : [`${profile.tasks} requested operation${profile.tasks === 1 ? "" : "s"} are surfaced`];
  if (rendererId === "ordered_steps") {
    taskCount = profile.tasks + 2;
    taskEvidence.push("source inspection and constraint verification are separately requested actions");
  } else if (rendererId === "dependency_compact") {
    taskCount = profile.tasks + 1;
    taskEvidence.push("source reconciliation is an additional requested action");
  } else if (rendererId === "two_turn") {
    taskCount = profile.tasks + 1;
    taskEvidence.push("the setting review is a separately requested prerequisite action");
  }

  let scenarioConstraintCount = constraintVisible.has(rendererId) ? profile.constraints : 0;
  if (row.language === "mixed" && (rendererId === "bullets" || rendererId === "yaml")) {
    scenarioConstraintCount = 0;
  }
  let additionalConstraintCount = outputConstraintVisible.has(rendererId) ? 1 : 0;
  const constraintEvidence = [];
  if (scenarioConstraintCount > 0) {
    constraintEvidence.push(`${scenarioConstraintCount} explicit scenario constraint${scenarioConstraintCount === 1 ? "" : "s"}`);
  }
  if (additionalConstraintCount > 0) constraintEvidence.push("one separately stated output-form restriction");
  if (rendererId === "long_context") {
    additionalConstraintCount += 1;
    constraintEvidence.push("one no-assumption restriction");
  }
  if (["negated_distractor", "category_noise", "rhetorical"].includes(rendererId)) {
    additionalConstraintCount += 1;
    constraintEvidence.push("one explicit prohibited/deselected operation");
  }
  const constraintCount = scenarioConstraintCount + additionalConstraintCount;
  if (constraintEvidence.length === 0) constraintEvidence.push("no independently enforceable constraint is surfaced");

  let scopeCount = 1;
  const scopeEvidence = [];
  if (rendererId === "multiple_sources") {
    scopeCount = 2;
    scopeEvidence.push("two explicitly separated source blocks must both be used");
  } else if (rendererId === "form") {
    scopeCount = profile.scopes;
    scopeEvidence.push(`${profile.scopes} explicit scope segment${profile.scopes === 1 ? "" : "s"}`);
  } else if (rendererId === "scope_first") {
    scopeCount = Math.max(profile.scopes, profile.sources);
    scopeEvidence.push(`${profile.scopes} explicit segments and ${profile.sources} named source${profile.sources === 1 ? "" : "s"}`);
  } else if (["ordered_steps", "dependency_compact"].includes(rendererId)) {
    scopeCount = profile.sources;
    scopeEvidence.push(`${profile.sources} named source${profile.sources === 1 ? "" : "s"}`);
  } else {
    scopeEvidence.push(scopeCount === 1 ? "one processing target/source block" : "multiple explicit source blocks");
  }

  let dependencyDepth = 1;
  const dependencyEvidence = ["no result-consuming chain longer than one step is surfaced"];
  if (rendererId === "ordered_steps") {
    dependencyDepth = 3;
    dependencyEvidence.splice(0, 1, "inspect, perform, and verify are an explicit ordered chain");
  } else if (rendererId === "dependency_compact") {
    dependencyDepth = Math.max(2, Math.min(3, profile.tasks + 1));
    dependencyEvidence.splice(0, 1, "reconciliation feeds the arrow-linked requested operations");
  } else if (rendererId === "ultra_compact" && profile.tasks >= 2) {
    dependencyDepth = Math.min(3, profile.tasks);
    dependencyEvidence.splice(0, 1, "arrow notation makes the surfaced operations sequential");
  } else if (rendererId === "two_turn") {
    dependencyDepth = 2;
    dependencyEvidence.splice(0, 1, "the final operation explicitly uses the preceding setting review");
  } else if (rendererId === "condition_first" && family.structuralMode === "interlocked") {
    dependencyDepth = profile.dependencyDepth;
    dependencyEvidence.splice(0, 1, "the prompt explicitly requires reconciliation before a staged conclusion");
  }

  const usesMultipleSources =
    rendererId === "multiple_sources" ||
    (["scope_first", "ordered_steps", "dependency_compact"].includes(rendererId) && profile.sources >= 2);
  const hasMultiFactorDecisionEvidence = /(대안 A|Option A|A\d+\/2h\/M)/.test(row.redactedPrompt);

  return {
    rendererId,
    workflow: profile.workflow,
    structuralMode: family.structuralMode,
    variantIndex,
    taskCount,
    constraintCount,
    scopeCount,
    dependencyDepth,
    usesMultipleSources,
    hasMultiFactorDecisionEvidence,
    evidence: {
      task: taskEvidence,
      constraint: constraintEvidence,
      scope: scopeEvidence,
      dependency: dependencyEvidence,
    },
  };
}

function resolvePrimaryLabels(row) {
  const provisional = row.provisionalLabels;
  const reviewer = row.reviewerALabels;
  let expectedCategory = provisional.expectedCategory;
  let expectedSemanticLabel = provisional.expectedSemanticLabel;
  const reasons = [];

  if (provisional.expectedCategory === reviewer.expectedCategory) {
    expectedCategory = provisional.expectedCategory;
    reasons.push("both passes agree on the primary category");
  } else if (provisional.expectedCategory === "summarization" && reviewer.expectedCategory === "reasoning") {
    expectedCategory = "summarization";
    reasons.push("the requested output extracts or structures supplied notes rather than creating a new plan or decision");
  } else {
    throw new Error(`unhandled category transition for ${row.sampleId}`);
  }

  if (provisional.expectedSemanticLabel === reviewer.expectedSemanticLabel) {
    expectedSemanticLabel = provisional.expectedSemanticLabel;
    reasons.push("both passes agree on the category-internal intent");
  } else {
    const transition = `${provisional.expectedSemanticLabel}>${reviewer.expectedSemanticLabel}`;
    const provisionalWins = new Set([
      "summarization_structured>reasoning_planning",
      "summarization_key_points>reasoning_planning",
      "summarization_direct>reasoning_planning",
      "translation_localization>translation_direct",
      "translation_style_preserving>translation_direct",
      "translation_direct>translation_localization",
      "general_other>general_qa",
      "general_support>general_other",
      "reasoning_comparison>reasoning_decision",
    ]);
    if (!provisionalWins.has(transition)) throw new Error(`unhandled semantic transition ${transition} for ${row.sampleId}`);
    expectedSemanticLabel = provisional.expectedSemanticLabel;
    reasons.push("the explicit deliverable wording supports the provisional intent; Reviewer A broadened or flattened it");
  }

  return { expectedCategory, expectedSemanticLabel, reasons };
}

function decideDifficulty(category, semanticLabel, facts) {
  const complexReasons = [];
  const boundaryReasons = [];

  if (facts.dependencyDepth >= 2) complexReasons.push("a later requested action consumes a prior result");
  if (facts.usesMultipleSources) complexReasons.push("multiple named sources must be jointly processed");
  if (facts.constraintCount >= 2) complexReasons.push("two or more independent constraints must be satisfied together");
  if (facts.scopeCount >= 4) complexReasons.push("four or more explicit targets/source scopes are in play");

  if (semanticLabel === "summarization_multi_source") {
    complexReasons.push("the primary deliverable explicitly requires comparison/synthesis across notes");
  }
  if (semanticLabel === "summarization_structured") {
    complexReasons.push("the primary deliverable requires a multi-facet decisions/evidence/follow-up structure");
  }
  if (semanticLabel === "reasoning_comparison") {
    complexReasons.push("the primary deliverable is trade-off comparison");
  }
  if (semanticLabel === "reasoning_decision" && (facts.hasMultiFactorDecisionEvidence || facts.taskCount >= 2)) {
    complexReasons.push("the supplied alternatives require a multi-factor choice and conclusion");
  }

  if (category === "general" && facts.taskCount >= 2) {
    complexReasons.push("the general-category request contains multiple requested operations");
  }
  if (category === "summarization" && facts.taskCount >= 2) {
    complexReasons.push("the summary request contains multiple independently requested facets");
  }
  if (category === "translation" && facts.taskCount >= 2) {
    complexReasons.push("translation is combined with an additional adaptation/preservation operation");
  }
  if (category === "code") {
    if (facts.taskCount >= 3) complexReasons.push("three or more engineering operations are requested");
    if (facts.taskCount >= 2 && facts.scopeCount >= 2) {
      complexReasons.push("multiple engineering operations span multiple explicit scopes");
    }
    if (
      facts.taskCount === 2 &&
      facts.constraintCount <= 1 &&
      facts.scopeCount === 1 &&
      facts.dependencyDepth <= 1 &&
      ["code_debugging", "code_refactoring", "code_explanation"].includes(semanticLabel)
    ) {
      boundaryReasons.push("two independent but bounded engineering operations remain within one scope");
    }
  }

  if (complexReasons.length > 0) {
    const semanticOnly =
      facts.taskCount === 1 &&
      facts.constraintCount <= 1 &&
      facts.scopeCount === 1 &&
      facts.dependencyDepth <= 1 &&
      complexReasons.every((reason) => reason.startsWith("the primary") || reason.startsWith("the supplied"));
    return {
      expectedDifficulty: "complex",
      confidence: semanticOnly ? 0.9 : 0.96,
      reasons: [...new Set(complexReasons)],
      boundaryReasons,
    };
  }

  if (
    category === "translation" &&
    ["translation_localization", "translation_style_preserving"].includes(semanticLabel)
  ) {
    boundaryReasons.push("one bounded localization/style condition does not meet the contract's several-constraint threshold");
  }
  if (semanticLabel === "reasoning_decision" && !facts.hasMultiFactorDecisionEvidence && facts.taskCount === 1) {
    boundaryReasons.push("the surfaced input asks for one short choice without multiple decision factors");
  }
  return {
    expectedDifficulty: "simple",
    confidence: boundaryReasons.length > 0 ? 0.86 : 0.94,
    reasons: ["the visible request is bounded, single-stage, and lacks multi-source synthesis or several independent constraints"],
    boundaryReasons,
  };
}

function agreementFor(labels, comparisonLabels, fields) {
  return fields.every((field) => JSON.stringify(labels[field]) === JSON.stringify(comparisonLabels[field]));
}

function decisionSource(labels, provisional, reviewer, fields) {
  const provisionalAll = agreementFor(labels, provisional, fields);
  const reviewerAll = agreementFor(labels, reviewer, fields);
  if (provisionalAll && reviewerAll) return "consensus";
  if (provisionalAll) return "provisional";
  if (reviewerAll) return "reviewer_a";
  const everyFieldCovered = fields.every(
    (field) => labels[field] === provisional[field] || labels[field] === reviewer[field],
  );
  return everyFieldCovered ? "mixed" : "neither";
}

export function adjudicateRow(row) {
  const facts = surfaceFacts(row);
  const primary = resolvePrimaryLabels(row);
  const difficulty = decideDifficulty(primary.expectedCategory, primary.expectedSemanticLabel, facts);
  const codexLabels = {
    expectedCategory: primary.expectedCategory,
    expectedDifficulty: difficulty.expectedDifficulty,
    semanticInputStatus: "eligible",
    taskBucket: bucketTask(facts.taskCount),
    constraintBucket: bucketConstraint(facts.constraintCount),
    scopeBucket: bucketScope(facts.scopeCount),
    dependencyBucket: bucketDependency(facts.dependencyDepth),
    expectedSemanticLabel: primary.expectedSemanticLabel,
  };
  const fieldComparison = Object.fromEntries(
    allAdjudicatedFields.map((field) => [
      field,
      {
        codex: codexLabels[field],
        provisional: row.provisionalLabels[field],
        reviewerA: row.reviewerALabels[field],
        selectedSource:
          codexLabels[field] === row.provisionalLabels[field] && codexLabels[field] === row.reviewerALabels[field]
            ? "consensus"
            : codexLabels[field] === row.provisionalLabels[field]
              ? "provisional"
              : codexLabels[field] === row.reviewerALabels[field]
                ? "reviewer_a"
                : "neither",
      },
    ]),
  );
  const coreDecisionSource = decisionSource(codexLabels, row.provisionalLabels, row.reviewerALabels, coreFields);
  const structureDecisionSource = decisionSource(codexLabels, row.provisionalLabels, row.reviewerALabels, structureFields);
  const overallDecisionSource = decisionSource(codexLabels, row.provisionalLabels, row.reviewerALabels, allAdjudicatedFields);
  const confidence = Math.min(
    difficulty.confidence,
    coreDecisionSource === "neither" ? 0.88 : 1,
    facts.rendererId === "ultra_compact" ? 0.92 : 1,
  );
  const humanReviewReasons = [];
  if (confidence < 0.9) humanReviewReasons.push("policy_boundary_confidence_below_0_90");
  if (coreDecisionSource === "neither") humanReviewReasons.push("codex_core_decision_differs_from_both_input_label_sets");
  if (difficulty.boundaryReasons.length > 0) humanReviewReasons.push("category_difficulty_boundary");

  return {
    schemaVersion: "gatelm.difficulty-independent-ood-codex-adjudication.v1",
    datasetVersion: row.datasetVersion,
    adjudicationPolicyVersion: policyVersion,
    sampleId: row.sampleId,
    promptFamily: row.promptFamily,
    language: row.language,
    redactedPrompt: row.redactedPrompt,
    surfaceFacts: facts,
    codexLabels,
    comparison: {
      coreDecisionSource,
      structureDecisionSource,
      overallDecisionSource,
      fields: fieldComparison,
    },
    confidence,
    needsHumanReview: humanReviewReasons.length > 0,
    humanReviewReasons,
    rationale: [...primary.reasons, ...difficulty.reasons, ...difficulty.boundaryReasons],
    approvalState: "codex_proposed_not_human_approved",
  };
}

function buildPolicyMarkdown() {
  return `# Dataset 2 Codex Core Adjudication Policy v1

문서 상태: 1,353개 core conflict에 적용한 고정 AI 보조 판정 규칙이다. 사람 검토나 training 승인이 아니다.

## 계수 규칙

1. Task는 독립적으로 요청된 행동을 센다. 최종 산출물의 형식 표기는 별도 task가 아니다. 명시적인 inspect/reconcile/verify 단계는 task다.
2. Constraint는 명시된 must/must-not, 보존·금지 조건과 task와 별도로 제시된 출력 형식 제한을 한 번씩 센다. 단순 배경은 세지 않는다.
3. Scope는 실제 처리 대상과 명시적으로 분리되거나 이름 붙은 source를 센다. 긴 단일 source는 하나다.
4. Dependency는 뒤 행동이 앞 행동의 결과를 사용할 때만 깊이를 올린다. 문장 순서, bullet, 출력 형식은 dependency가 아니다.
5. Category와 semantic label은 primary requested output으로 정한다. 제공된 노트에서 결정·근거·후속 조치를 구조화하는 작업은 새 계획 생성이 아니라 summarization이다.
6. Difficulty는 category별 active contract를 적용한다. 길이나 bucket 합만으로 정하지 않는다.

## Difficulty 적용

- 다단계 결과 의존, 명시적인 multi-source 공동 처리, 독립 제약 2개 이상, scope 4개 이상은 complex evidence다.
- general의 복수 작업, translation의 번역+추가 적응 작업, summarization의 복수 facet은 complex evidence다.
- summarization_multi_source, summarization_structured, reasoning_comparison과 이 corpus의 multi-factor reasoning_decision은 산출물 자체가 complex evidence다.
- 한 scope 안의 bounded code debug/refactor/explanation 보조 작업은 다른 구조 근거가 없으면 simple일 수 있다.
- localization/style-preserving 조건 하나만 있는 bounded translation은 여러 보존 제약이 결합된 경우가 아니므로 simple 경계 사례로 둔다.

## 객관성 제한

Codex는 Dataset 2 생성과 이전 비교 과정에 참여했으므로 독립 인간 reviewer가 아니다. 결과는 \`codex_proposed_not_human_approved\`로만 기록한다. confidence 0.90 미만, category difficulty 경계 및 두 입력 label 어느 쪽과도 일치하지 않는 구조 판정은 residual human-review queue로 보낸다.
`;
}

function buildReport(rows, queueRows) {
  const changedCore = rows.filter((row) => row.comparison.coreDecisionSource !== "consensus");
  const difficultyTransitions = countBy(
    rows,
    (row) => `${row.comparison.fields.expectedDifficulty.provisional}->${row.codexLabels.expectedDifficulty}`,
  );
  const sourceCounts = countBy(rows, (row) => row.comparison.overallDecisionSource);
  const coreSourceCounts = countBy(rows, (row) => row.comparison.coreDecisionSource);
  const structureSourceCounts = countBy(rows, (row) => row.comparison.structureDecisionSource);
  const categoryCounts = countBy(rows, (row) => row.codexLabels.expectedCategory);
  const difficultyCounts = countBy(rows, (row) => row.codexLabels.expectedDifficulty);
  const rendererCounts = countBy(rows, (row) => row.surfaceFacts.rendererId);
  const fieldSourceCounts = Object.fromEntries(
    allAdjudicatedFields.map((field) => [field, countBy(rows, (row) => row.comparison.fields[field].selectedSource)]),
  );

  const table = (counts) =>
    Object.entries(counts)
      .map(([key, value]) => `| ${key} | ${value.toLocaleString("en-US")} |`)
      .join("\n");

  return `# Dataset 2 Codex Core Adjudication Report

판정 정책: \`${policyVersion}\`

## 결과

- 전수 판정: ${rows.length.toLocaleString("en-US")} / 1,353
- core decision이 provisional과 일치: ${(coreSourceCounts.provisional ?? 0).toLocaleString("en-US")}
- core decision이 Reviewer A와 일치: ${(coreSourceCounts.reviewer_a ?? 0).toLocaleString("en-US")}
- core decision이 두 결과를 혼합: ${(coreSourceCounts.mixed ?? 0).toLocaleString("en-US")}
- core decision이 양쪽과 모두 일치: ${(coreSourceCounts.consensus ?? 0).toLocaleString("en-US")}
- residual human-review queue: ${queueRows.length.toLocaleString("en-US")}
- 사람 승인 상태: 미승인. 모든 결과는 Codex proposed 상태다.

## Core 선택 출처

| 선택 | 건수 |
|---|---:|
${table(coreSourceCounts)}

## 전체 8개 판정 선택 출처

| 선택 | 건수 |
|---|---:|
${table(sourceCounts)}

## 구조 판정 선택 출처

| 선택 | 건수 |
|---|---:|
${table(structureSourceCounts)}

## Field별 선택 출처

| Field | Consensus | Provisional | Reviewer A | Neither |
|---|---:|---:|---:|---:|
${allAdjudicatedFields
  .map((field) => {
    const counts = fieldSourceCounts[field];
    return `| ${field} | ${counts.consensus ?? 0} | ${counts.provisional ?? 0} | ${counts.reviewer_a ?? 0} | ${counts.neither ?? 0} |`;
  })
  .join("\n")}

## 최종 difficulty

| Difficulty | 건수 |
|---|---:|
${table(difficultyCounts)}

## Provisional 대비 difficulty 변화

| 변화 | 건수 |
|---|---:|
${table(difficultyTransitions)}

## Category 분포

| Category | 건수 |
|---|---:|
${table(categoryCounts)}

## Renderer coverage

${Object.keys(rendererCounts).length}개 renderer의 core conflict를 모두 처리했다. Core conflict 중 실제 core decision이 필요한 record는 ${changedCore.length.toLocaleString("en-US")}건이다.

## 사용 제한

이 결과만으로 candidate record를 \`human_review\`, \`approved\` 또는 training-eligible로 승격하지 않는다. residual queue 검토와 별도의 층화 무작위 감사가 끝나기 전에는 provisional dataset을 덮어쓰지 않는다.
`;
}

export function buildAdjudicationArtifacts(queueText, candidateText) {
  const queueRows = parseJsonl(queueText);
  const candidateRows = parseJsonl(candidateText);
  if (queueRows.length !== 1353) throw new Error(`expected 1,353 core conflicts, found ${queueRows.length}`);
  if (candidateRows.length !== 5000) throw new Error(`expected 5,000 candidate records, found ${candidateRows.length}`);
  const candidateIds = new Set(candidateRows.map((row) => row.sampleId));
  if (candidateIds.size !== 5000) throw new Error("candidate sampleId values are not unique");
  for (const row of queueRows) {
    if (!candidateIds.has(row.sampleId)) throw new Error(`queue sample missing from candidate: ${row.sampleId}`);
  }

  const rows = queueRows.map(adjudicateRow);
  if (new Set(rows.map((row) => row.sampleId)).size !== rows.length) throw new Error("adjudication sampleId values are not unique");
  const residualRows = rows.filter((row) => row.needsHumanReview);
  const outputText = jsonl(rows);
  const residualText = jsonl(residualRows);
  const policyText = buildPolicyMarkdown();
  const reportText = buildReport(rows, residualRows);
  const manifest = {
    schemaVersion: "gatelm.difficulty-independent-ood-codex-adjudication-manifest.v1",
    datasetVersion: queueRows[0].datasetVersion,
    adjudicationPolicyVersion: policyVersion,
    generatedAt: "2026-07-20T00:00:00Z",
    source: {
      coreConflictQueue: queuePath,
      coreConflictQueueSha256: sha256(queueText),
      candidateDataset: candidatePath,
      candidateDatasetSha256: sha256(candidateText),
    },
    counts: {
      adjudicatedRecords: rows.length,
      uniqueSampleIds: new Set(rows.map((row) => row.sampleId)).size,
      residualHumanReviewRecords: residualRows.length,
      humanApprovedRecords: 0,
      trainingEligibleRecords: 0,
      coreDecisionSource: countBy(rows, (row) => row.comparison.coreDecisionSource),
      structureDecisionSource: countBy(rows, (row) => row.comparison.structureDecisionSource),
      overallDecisionSource: countBy(rows, (row) => row.comparison.overallDecisionSource),
      fieldDecisionSource: Object.fromEntries(
        allAdjudicatedFields.map((field) => [field, countBy(rows, (row) => row.comparison.fields[field].selectedSource)]),
      ),
    },
    outputs: {
      adjudication: { path: outputPath, sha256: sha256(outputText) },
      residualHumanReviewQueue: { path: humanQueuePath, sha256: sha256(residualText) },
      policy: { path: policyPath, sha256: sha256(policyText) },
      report: { path: reportPath, sha256: sha256(reportText) },
    },
    approvalState: "codex_proposed_not_human_approved",
  };
  return {
    rows,
    residualRows,
    artifacts: {
      [outputPath]: outputText,
      [humanQueuePath]: residualText,
      [policyPath]: policyText,
      [reportPath]: reportText,
      [manifestPath]: `${JSON.stringify(manifest, null, 2)}\n`,
    },
    manifest,
  };
}

function writeArtifacts(artifacts, checkOnly) {
  const drift = [];
  for (const [relativePath, content] of Object.entries(artifacts)) {
    const absolutePath = path.join(rootDir, relativePath);
    if (checkOnly) {
      if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== content) drift.push(relativePath);
    } else {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, "utf8");
    }
  }
  if (drift.length > 0) throw new Error(`generated adjudication artifact drift:\n${drift.join("\n")}`);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const queueText = readFileSync(path.join(rootDir, queuePath), "utf8");
  const candidateText = readFileSync(path.join(rootDir, candidatePath), "utf8");
  const result = buildAdjudicationArtifacts(queueText, candidateText);
  writeArtifacts(result.artifacts, checkOnly);
  console.log(
    `${checkOnly ? "verified" : "generated"} Codex core adjudication: ` +
      `${result.rows.length} records, ${result.residualRows.length} residual human-review records`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
