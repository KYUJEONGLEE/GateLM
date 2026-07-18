import { expect, test } from "@playwright/test";

import { buildAnalyticsCacheEvidence } from "./analytics-cache-merge";

test("merges Project/Application and Tenant Chat cache ratios from additive counters", () => {
  const evidence = buildAnalyticsCacheEvidence({
    projectApplicationOverview: cacheOverview({
      cacheEligibleRequests: 20,
      cacheHitRequests: 10,
      savedCostMicroUsd: 4000,
      totalRequests: 30
    }),
    tenantChatOverview: cacheOverview({
      cacheEligibleRequests: 100,
      cacheHitRequests: 90,
      savedCostMicroUsd: 0,
      totalRequests: 110
    })
  });

  expect(evidence).toMatchObject({
    bypassRequests: 20,
    eligibleRequests: 120,
    hitRate: 100 / 120,
    hitRequests: 100,
    missRequests: 20,
    savedCostMicroUsd: 4000,
    totalRequests: 140
  });
  expect(evidence?.sources).toEqual([
    {
      eligibleRequests: 20,
      hitRate: 0.5,
      hitRequests: 10,
      id: "project_application",
      label: "Project/Application",
      savedCostMicroUsd: 4000,
      totalRequests: 30
    },
    {
      eligibleRequests: 100,
      hitRate: 0.9,
      hitRequests: 90,
      id: "tenant_chat",
      label: "Tenant Chat",
      savedCostMicroUsd: null,
      totalRequests: 110
    }
  ]);
});

test("does not present Tenant Chat missing savings as zero", () => {
  const evidence = buildAnalyticsCacheEvidence({
    tenantChatOverview: cacheOverview({
      cacheEligibleRequests: 8,
      cacheHitRequests: 2,
      savedCostMicroUsd: 0,
      totalRequests: 10
    })
  });

  expect(evidence?.savedCostMicroUsd).toBeNull();
  expect(evidence?.sources[0]?.savedCostMicroUsd).toBeNull();
});

test("keeps a present zero-traffic surface visible and handles zero eligibility", () => {
  const evidence = buildAnalyticsCacheEvidence({
    projectApplicationOverview: cacheOverview({
      cacheEligibleRequests: 0,
      cacheHitRequests: 0,
      savedCostMicroUsd: 0,
      totalRequests: 0
    }),
    tenantChatOverview: cacheOverview({
      cacheEligibleRequests: 0,
      cacheHitRequests: 0,
      savedCostMicroUsd: 0,
      totalRequests: 4
    })
  });

  expect(evidence?.hitRate).toBe(0);
  expect(evidence?.bypassRequests).toBe(4);
  expect(evidence?.sources).toHaveLength(2);
});

function cacheOverview(input: {
  cacheEligibleRequests: number;
  cacheHitRequests: number;
  savedCostMicroUsd: number;
  totalRequests: number;
}) {
  return input;
}
