import { expect, test } from "@playwright/test";

import { normalizeGatewayTtft } from "./gateway-ttft";

test("keeps unobserved Gateway TTFT percentiles nullable", () => {
  const ttft = normalizeGatewayTtft({
    scope: "project_application",
    averageMs: null,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    eligibleStreamRequests: 5,
    observedRequests: 0,
    coverageRate: null
  });

  expect(ttft).toEqual({
    scope: "project_application",
    averageMs: null,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    eligibleStreamRequests: 5,
    observedRequests: 0,
    coverageRate: null
  });
});

test("rejects invalid TTFT measurements without manufacturing zero latency", () => {
  const ttft = normalizeGatewayTtft({
    scope: "project_application",
    averageMs: -1,
    p50Ms: Number.NaN,
    p95Ms: 320,
    p99Ms: 640,
    eligibleStreamRequests: 10.9,
    observedRequests: 8.2,
    coverageRate: 1.2
  });

  expect(ttft).toEqual({
    scope: "project_application",
    averageMs: null,
    p50Ms: null,
    p95Ms: 320,
    p99Ms: 640,
    eligibleStreamRequests: 10,
    observedRequests: 8,
    coverageRate: null
  });
});
