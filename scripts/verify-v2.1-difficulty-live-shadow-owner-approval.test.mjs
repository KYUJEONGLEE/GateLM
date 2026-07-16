import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  approvalPaths,
  validateApproval,
  verifyCanonicalApproval,
} from "./verify-v2.1-difficulty-live-shadow-owner-approval.mjs";

function canonicalInputs() {
  const supersessionBytes = readFileSync(approvalPaths.supersession);
  return {
    artifactBytes: readFileSync(approvalPaths.artifact),
    promotionReport: JSON.parse(readFileSync(approvalPaths.promotionReport, "utf8")),
    approvalBytes: readFileSync(approvalPaths.approval),
    approval: JSON.parse(readFileSync(approvalPaths.approval, "utf8")),
    supersessionBytes,
    supersession: JSON.parse(supersessionBytes.toString("utf8")),
    baselineWaiver: JSON.parse(readFileSync(approvalPaths.baselineWaiver, "utf8")),
    runbook: readFileSync(approvalPaths.runbook, "utf8"),
    semanticModel: readFileSync(approvalPaths.semanticModel, "utf8"),
    gatewayConfig: readFileSync(approvalPaths.gatewayConfig, "utf8"),
  };
}

test("keeps historical owner approval narrow after 106D runtime promotion", () => {
  const { approval, supersession, baselineWaiver } = verifyCanonicalApproval();
  assert.equal(approval.scope.authoritativeRouting, "rule_based");
  assert.equal(approval.scope.productRoutingPromotionApproved, false);
  assert.equal(approval.ownerApprovedMemoryGuardrails.containerHardLimitBytes, 2 * 1024 ** 3);
  assert.equal(supersession.decisionBoundary.compatible, false);
  assert.equal(supersession.enforcement.currentLiveShadowEnabled, false);
  assert.equal(baselineWaiver.status, "owner_approved_one_time_baseline_e2e_shadow_waiver");
  assert.equal(baselineWaiver.qualityEvidence.observedAccuracy, 0.7);
  assert.equal(baselineWaiver.qualityEvidence.promotionGatePassed, false);
  assert.equal(baselineWaiver.scope.authoritativeRouting, "rule_based");
  assert.equal(baselineWaiver.scope.futureArtifactAccuracyGateRequired, true);
});

test("rejects applying historical owner approval to the current decision boundary", () => {
  const input = canonicalInputs();
  input.supersession.decisionBoundary.compatible = true;
  assert.throws(() => validateApproval(input), /boundary supersession drifted/);
});

test("rejects artifact identity drift", () => {
  const input = canonicalInputs();
  input.approval.artifact.bundleHash = "sha256:changed";
  assert.throws(() => validateApproval(input), /bundleHash drifted/);
});

test("rejects an attempt to turn owner shadow approval into product promotion", () => {
  const input = canonicalInputs();
  input.approval.scope.productRoutingPromotionApproved = true;
  assert.throws(() => validateApproval(input), /scope widened/);
});

test("rejects memory guardrail drift", () => {
  const input = canonicalInputs();
  input.approval.ownerApprovedMemoryGuardrails.containerHardLimitBytes -= 1;
  assert.throws(() => validateApproval(input), /memory guardrails drifted/);
});

test("rejects concrete scope identifiers", () => {
  const input = canonicalInputs();
  input.approval.tenantId = "forbidden";
  assert.throws(() => validateApproval(input), /forbidden key/);
});

test("rejects reusing the baseline waiver for a future artifact", () => {
  const input = canonicalInputs();
  input.baselineWaiver.waiver.reusableForOtherArtifacts = true;
  assert.throws(() => validateApproval(input), /waiver widened or drifted/);
});
