import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceDir =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/chatgpt-review-kit/results/codex-adjudication";
const adjudicationPath = `${sourceDir}/difficulty-independent-ood-5000.codex-core-adjudication.jsonl`;
const residualPath = `${sourceDir}/difficulty-independent-ood-5000.codex-residual-human-review-queue.jsonl`;
const candidatePath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl";
const outputDir = `${sourceDir}/owner-policy-resolution`;
const approvalPath = `${outputDir}/OWNER-POLICY-APPROVAL.json`;
const resolved191Path = `${outputDir}/difficulty-independent-ood-5000.owner-policy-resolved-191.jsonl`;
const resolved1353Path = `${outputDir}/difficulty-independent-ood-5000.resolved-core-decisions-1353.jsonl`;
const reportPath = `${outputDir}/OWNER-POLICY-RESOLUTION-REPORT.md`;
const manifestPath = `${outputDir}/MANIFEST.json`;
const approvalVersion = "difficulty-independent-ood-owner-group-policy.2026-07-20.v1";

const policies = [
  {
    policyId: "structured_summary_multifacet_complex",
    question: "결정·근거·후속 조치 구조화는 complex인가",
    decision: "yes",
    finalDifficulty: "complex",
    semanticLabels: ["summarization_structured"],
    expectedCount: 113,
  },
  {
    policyId: "single_localization_or_style_constraint_simple",
    question: "현지화·말투 보존 조건 하나뿐인 bounded 번역은 simple인가",
    decision: "yes",
    finalDifficulty: "simple",
    semanticLabels: ["translation_localization", "translation_style_preserving"],
    expectedCount: 42,
  },
  {
    policyId: "single_scope_bounded_two_action_code_simple",
    question: "한 scope의 독립적인 bounded code 작업 두 개는 simple인가",
    decision: "yes",
    finalDifficulty: "simple",
    semanticLabels: ["code_debugging", "code_refactoring", "code_explanation"],
    expectedCount: 27,
  },
  {
    policyId: "single_choice_without_multi_factor_evidence_simple",
    question: "판단 요소가 드러나지 않은 단일 선택 요청은 simple인가",
    decision: "yes",
    finalDifficulty: "simple",
    semanticLabels: ["reasoning_decision"],
    expectedCount: 9,
  },
];

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const parseJsonl = (text) => text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const jsonl = (rows) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

function policyFor(row) {
  const matches = policies.filter(
    (policy) =>
      policy.semanticLabels.includes(row.codexLabels.expectedSemanticLabel) &&
      policy.finalDifficulty === row.codexLabels.expectedDifficulty,
  );
  if (matches.length !== 1) {
    throw new Error(`expected one owner policy for ${row.sampleId}, found ${matches.length}`);
  }
  return matches[0];
}

function countBy(values, selector) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const key = selector(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

export function buildOwnerPolicyResolutionArtifacts(adjudicationText, residualText, candidateText) {
  const adjudications = parseJsonl(adjudicationText);
  const residuals = parseJsonl(residualText);
  const candidates = parseJsonl(candidateText);
  if (adjudications.length !== 1353) throw new Error(`expected 1,353 adjudications, found ${adjudications.length}`);
  if (residuals.length !== 191) throw new Error(`expected 191 residual records, found ${residuals.length}`);
  if (candidates.length !== 5000) throw new Error(`expected 5,000 candidate records, found ${candidates.length}`);
  if (!residuals.every((row) => row.needsHumanReview)) throw new Error("residual input contains a non-residual row");

  const residualIds = new Set(residuals.map((row) => row.sampleId));
  if (residualIds.size !== residuals.length) throw new Error("residual sampleId values are not unique");
  const adjudicationById = new Map(adjudications.map((row) => [row.sampleId, row]));
  for (const residual of residuals) {
    if (!adjudicationById.has(residual.sampleId)) throw new Error(`residual not found in adjudication: ${residual.sampleId}`);
  }

  const resolved191 = residuals.map((row) => {
    const policy = policyFor(row);
    return {
      schemaVersion: "gatelm.difficulty-independent-ood-owner-policy-resolution.v1",
      datasetVersion: row.datasetVersion,
      approvalVersion,
      sampleId: row.sampleId,
      promptFamily: row.promptFamily,
      policyId: policy.policyId,
      ownerPolicyDecision: "approve_codex_label",
      finalCoreLabels: row.codexLabels,
      previousResidualReasons: row.humanReviewReasons,
      groupPolicyApproved: true,
      recordLevelHumanReview: false,
      humanApprovedLabelClaimed: false,
      trainingEligibilityChanged: false,
    };
  });

  for (const policy of policies) {
    const count = resolved191.filter((row) => row.policyId === policy.policyId).length;
    if (count !== policy.expectedCount) {
      throw new Error(`${policy.policyId} expected ${policy.expectedCount} records, found ${count}`);
    }
  }

  const resolved1353 = adjudications.map((row) => {
    const resolved = residualIds.has(row.sampleId);
    const policy = resolved ? policyFor(row) : null;
    return {
      schemaVersion: "gatelm.difficulty-independent-ood-resolved-core-decision.v1",
      datasetVersion: row.datasetVersion,
      sampleId: row.sampleId,
      promptFamily: row.promptFamily,
      finalCoreLabels: row.codexLabels,
      resolutionStatus: resolved ? "resolved_by_owner_group_policy" : "codex_adjudicated_no_residual",
      ownerPolicyId: policy?.policyId ?? null,
      recordLevelHumanReview: false,
      humanApprovedLabelClaimed: false,
      trainingEligibilityChanged: false,
    };
  });

  const resolved191Text = jsonl(resolved191);
  const resolved1353Text = jsonl(resolved1353);
  const approval = {
    schemaVersion: "gatelm.difficulty-independent-ood-owner-group-policy-approval.v1",
    datasetVersion: adjudications[0].datasetVersion,
    approvalVersion,
    approvedAt: "2026-07-20T00:00:00+09:00",
    approvedByRole: "dataset_owner",
    approvalEvidence: "The dataset owner explicitly answered yes to each of the four enumerated policy questions in the current task.",
    approvalScope: "group_policy_only",
    policies,
    appliesTo: {
      residualRecords: 191,
      sourceAdjudicationSha256: sha256(adjudicationText),
      sourceResidualQueueSha256: sha256(residualText),
      candidateDatasetSha256: sha256(candidateText),
    },
    claims: {
      unresolvedCoreResidualRecords: 0,
      recordLevelHumanReview: false,
      humanApprovedLabelClaimed: false,
      trainingEligibilityChanged: false,
    },
  };
  const approvalText = `${JSON.stringify(approval, null, 2)}\n`;
  const reportText = `# Dataset 2 Owner Group-Policy Resolution

Owner가 네 개의 경계 정책에 모두 동의하여 Codex core adjudication의 residual 191건을 그룹 정책으로 해소했다.

| Policy | 적용 건수 | 최종 difficulty |
|---|---:|---|
${policies.map((policy) => `| \`${policy.policyId}\` | ${policy.expectedCount} | \`${policy.finalDifficulty}\` |`).join("\n")}

- Core adjudication records: 1,353
- Owner group-policy resolved records: 191
- Unresolved core residual records: 0
- Record-level human-reviewed records claimed: 0
- Human-approved labels claimed: 0
- Training eligibility changes: 0

이 승인은 191개 row를 각각 사람이 읽었다는 뜻이 아니다. Owner가 네 가지 counting/difficulty 경계 규칙을 승인했고 해당 그룹에 동일하게 적용했다는 뜻이다. Candidate 5,000건과 기존 review evidence는 변경하지 않는다.
`;
  const manifest = {
    schemaVersion: "gatelm.difficulty-independent-ood-owner-policy-resolution-manifest.v1",
    datasetVersion: adjudications[0].datasetVersion,
    approvalVersion,
    counts: {
      coreAdjudicationRecords: adjudications.length,
      ownerGroupPolicyResolvedRecords: resolved191.length,
      unresolvedCoreResidualRecords: 0,
      recordLevelHumanReviewedRecords: 0,
      humanApprovedLabelRecords: 0,
      trainingEligibleRecords: 0,
      policyResolution: countBy(resolved191, (row) => row.policyId),
    },
    source: {
      adjudication: { path: adjudicationPath, sha256: sha256(adjudicationText) },
      residualQueue: { path: residualPath, sha256: sha256(residualText) },
      candidateDataset: { path: candidatePath, sha256: sha256(candidateText) },
    },
    outputs: {
      approval: { path: approvalPath, sha256: sha256(approvalText) },
      resolvedResiduals: { path: resolved191Path, sha256: sha256(resolved191Text) },
      resolvedCoreDecisions: { path: resolved1353Path, sha256: sha256(resolved1353Text) },
      report: { path: reportPath, sha256: sha256(reportText) },
    },
  };

  return {
    approval,
    resolved191,
    resolved1353,
    manifest,
    artifacts: {
      [approvalPath]: approvalText,
      [resolved191Path]: resolved191Text,
      [resolved1353Path]: resolved1353Text,
      [reportPath]: reportText,
      [manifestPath]: `${JSON.stringify(manifest, null, 2)}\n`,
    },
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
  if (drift.length > 0) throw new Error(`generated owner-policy artifact drift:\n${drift.join("\n")}`);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const result = buildOwnerPolicyResolutionArtifacts(
    readFileSync(path.join(rootDir, adjudicationPath), "utf8"),
    readFileSync(path.join(rootDir, residualPath), "utf8"),
    readFileSync(path.join(rootDir, candidatePath), "utf8"),
  );
  writeArtifacts(result.artifacts, checkOnly);
  console.log(
    `${checkOnly ? "verified" : "generated"} owner group-policy resolution: ` +
      `${result.resolved191.length} resolved residuals, 0 unresolved core residuals`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

