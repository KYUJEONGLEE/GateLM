import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  approvalPaths,
  validateApproval,
  verifyCanonicalApproval,
} from "./verify-v2.1-difficulty-live-shadow-owner-approval.mjs";

function canonicalInputs() {
  return {
    artifactBytes: readFileSync(approvalPaths.artifact),
    promotionReport: JSON.parse(readFileSync(approvalPaths.promotionReport, "utf8")),
    approval: JSON.parse(readFileSync(approvalPaths.approval, "utf8")),
    runbook: readFileSync(approvalPaths.runbook, "utf8"),
  };
}

test("accepts owner guardrails without promoting failed holdout evidence", () => {
  const approval = verifyCanonicalApproval();
  assert.equal(approval.scope.authoritativeRouting, "rule_based");
  assert.equal(approval.scope.productRoutingPromotionApproved, false);
  assert.equal(approval.ownerApprovedMemoryGuardrails.containerHardLimitBytes, 2 * 1024 ** 3);
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
