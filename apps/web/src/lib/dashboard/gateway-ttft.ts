import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";

export type GatewayTtftPayload = {
  scope: "project_application";
  averageMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  eligibleStreamRequests: number;
  observedRequests: number;
  coverageRate: number | null;
};

type GatewayTtft = NonNullable<DashboardOverview["gatewayTtft"]>;

export function normalizeGatewayTtft(
  value: GatewayTtftPayload | undefined
): GatewayTtft | undefined {
  if (!value || value.scope !== "project_application") {
    return undefined;
  }

  return {
    scope: value.scope,
    averageMs: nullableNonNegativeNumber(value.averageMs),
    p50Ms: nullableNonNegativeNumber(value.p50Ms),
    p95Ms: nullableNonNegativeNumber(value.p95Ms),
    p99Ms: nullableNonNegativeNumber(value.p99Ms),
    eligibleStreamRequests: nonNegativeInteger(value.eligibleStreamRequests),
    observedRequests: nonNegativeInteger(value.observedRequests),
    coverageRate: nullableRate(value.coverageRate)
  };
}

function nullableNonNegativeNumber(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nullableRate(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function nonNegativeInteger(value: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}
