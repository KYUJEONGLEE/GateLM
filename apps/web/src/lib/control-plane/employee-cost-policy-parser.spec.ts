import { expect, test } from "@playwright/test";

import {
  parseEmployeeCostPoliciesResponse,
  parseEmployeeCostPolicy
} from "./employee-cost-policy-parser";
import type {
  EmployeeCostPoliciesResponse,
  EmployeeCostPolicy,
  EmployeeCostPolicyState
} from "./employee-cost-policy-types";

const tenantId = "00000000-0000-4000-8000-000000000001";
const employeeId = "00000000-0000-4000-8000-000000000101";

test("parses pending-ledger employee cost policies without turning unknown exposure into zero", () => {
  const response = buildPendingResponse();

  expect(parseEmployeeCostPoliciesResponse(response, tenantId)).toEqual(response);
  expect(response.data[0]).toMatchObject({
    enforcementReady: false,
    exposureSource: "confirmed_read_model",
    rolloutMode: "off",
    daily: {
      reservedCostMicroUsd: null,
      state: "pending_ledger",
      unconfirmedCostMicroUsd: null
    }
  });
});

test("parses an authoritative employee cost policy and its exposure amounts", () => {
  const response = buildAuthoritativeResponse();

  expect(parseEmployeeCostPoliciesResponse(response, tenantId)).toEqual(response);
  expect(parseEmployeeCostPolicy(response.data[0]?.policy, tenantId, employeeId)).toEqual(
    response.data[0]?.policy
  );
});

test("parses authoritative shadow exposure without claiming enforcement readiness", () => {
  const response = buildAuthoritativeResponse();
  response.data[0]!.enforcementReady = false;
  response.data[0]!.rolloutMode = "shadow";

  expect(parseEmployeeCostPoliciesResponse(response, tenantId)).toEqual(response);
});

test("validates authoritative state from confirmed, reserved, and unconfirmed exposure", () => {
  const normal = buildAuthoritativeResponse();
  normal.data[0]!.daily.reservedCostMicroUsd = 2_999_999;
  normal.data[0]!.daily.state = "normal";
  expect(parseEmployeeCostPoliciesResponse(normal, tenantId)).not.toBeNull();

  const exceeded = buildAuthoritativeResponse();
  exceeded.data[0]!.daily.reservedCostMicroUsd = 4_000_000;
  exceeded.data[0]!.daily.state = "exceeded";
  expect(parseEmployeeCostPoliciesResponse(exceeded, tenantId)).not.toBeNull();

  const mismatched = buildAuthoritativeResponse();
  mismatched.data[0]!.daily.state = "normal";
  expect(parseEmployeeCostPoliciesResponse(mismatched, tenantId)).toBeNull();

  const unsafeExposure = buildAuthoritativeResponse();
  unsafeExposure.data[0]!.daily.confirmedCostMicroUsd = Number.MAX_SAFE_INTEGER;
  unsafeExposure.data[0]!.daily.reservedCostMicroUsd = 1;
  expect(parseEmployeeCostPoliciesResponse(unsafeExposure, tenantId)).toBeNull();
});

test("rejects inconsistent enforcement readiness and exposure sources", () => {
  const wrongSource = buildPendingResponse();
  wrongSource.data[0]!.exposureSource = "authoritative_ledger";
  expect(parseEmployeeCostPoliciesResponse(wrongSource, tenantId)).toBeNull();

  const zeroedPendingExposure = buildPendingResponse();
  zeroedPendingExposure.data[0]!.daily.reservedCostMicroUsd = 0;
  expect(parseEmployeeCostPoliciesResponse(zeroedPendingExposure, tenantId)).toBeNull();

  const pendingAuthoritativeState = buildAuthoritativeResponse();
  pendingAuthoritativeState.data[0]!.daily.state = "pending_ledger";
  expect(parseEmployeeCostPoliciesResponse(pendingAuthoritativeState, tenantId)).toBeNull();

  const shadowClaimsEnforcement = buildAuthoritativeResponse();
  shadowClaimsEnforcement.data[0]!.rolloutMode = "shadow";
  expect(parseEmployeeCostPoliciesResponse(shadowClaimsEnforcement, tenantId)).toBeNull();
});

test("rejects unsafe costs, invalid limits, identities, and timezone data", () => {
  const unsafeCost = buildPendingResponse();
  unsafeCost.data[0]!.daily.confirmedCostMicroUsd = Number.MAX_SAFE_INTEGER + 1;
  expect(parseEmployeeCostPoliciesResponse(unsafeCost, tenantId)).toBeNull();

  const zeroEnabledLimit = buildPendingResponse();
  zeroEnabledLimit.data[0]!.policy.daily.limitMicroUsd = 0;
  expect(parseEmployeeCostPoliciesResponse(zeroEnabledLimit, tenantId)).toBeNull();

  const mismatchedEmployee = buildPendingResponse();
  mismatchedEmployee.data[0]!.policy.employeeId = "00000000-0000-4000-8000-000000000102";
  expect(parseEmployeeCostPoliciesResponse(mismatchedEmployee, tenantId)).toBeNull();

  const invalidTimezone = buildPendingResponse();
  invalidTimezone.data[0]!.policy.periodTimezone = "Mars/Olympus_Mons";
  expect(parseEmployeeCostPoliciesResponse(invalidTimezone, tenantId)).toBeNull();
});

test("rejects malformed pagination and duplicate employee rows", () => {
  const missingCursor = buildPendingResponse();
  missingCursor.pagination = { hasMore: true, limit: 100, nextCursor: null };
  expect(parseEmployeeCostPoliciesResponse(missingCursor, tenantId)).toBeNull();

  const duplicated = buildPendingResponse();
  duplicated.data.push(structuredClone(duplicated.data[0]!));
  expect(parseEmployeeCostPoliciesResponse(duplicated, tenantId)).toBeNull();
});

function buildPendingResponse(): EmployeeCostPoliciesResponse {
  return {
    data: [
      {
        daily: period("pending_ledger", null),
        employeeId,
        enforcementReady: false,
        exposureSource: "confirmed_read_model",
        policy: policy(),
        rolloutMode: "off",
        weekly: period("not_configured", null)
      }
    ],
    pagination: { hasMore: false, limit: 100, nextCursor: null }
  };
}

function buildAuthoritativeResponse(): EmployeeCostPoliciesResponse {
  return {
    data: [
      {
        daily: period("warning", 3_000_000),
        employeeId,
        enforcementReady: true,
        exposureSource: "authoritative_ledger",
        policy: policy(),
        rolloutMode: "enforce",
        weekly: period("not_configured", 0)
      }
    ],
    pagination: { hasMore: false, limit: 100, nextCursor: null }
  };
}

function policy(): EmployeeCostPolicy {
  return {
    createdAt: "2026-07-15T00:00:00.000Z",
    currency: "USD",
    daily: { enabled: true, limitMicroUsd: 5_000_000 },
    employeeId,
    enforcementMode: "restrict_high_cost",
    periodTimezone: "Asia/Seoul",
    tenantId,
    updatedAt: "2026-07-15T00:00:00.000Z",
    updatedBy: "admin-fixture",
    version: 1,
    warningThresholdPercent: 80,
    weekly: { enabled: false, limitMicroUsd: 25_000_000 }
  };
}

function period(
  state: EmployeeCostPolicyState,
  exposure: number | null
): EmployeeCostPoliciesResponse["data"][number]["daily"] {
  return {
    confirmedCostMicroUsd: 1_000_000,
    periodEnd: "2026-07-16T15:00:00.000Z",
    periodStart: "2026-07-15T15:00:00.000Z",
    periodTimezone: "Asia/Seoul",
    reservedCostMicroUsd: exposure,
    resetAt: "2026-07-16T15:00:00.000Z",
    state,
    unconfirmedCostMicroUsd: exposure === null ? null : 0
  };
}
