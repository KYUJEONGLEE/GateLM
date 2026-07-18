import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";

export type AnalyticsV5ModelBucket = {
  model: string;
  periodStart: string;
  provider: string;
  requestCount: number;
  surface?: "project_application" | "tenant_chat";
};

export type AnalyticsV5PolicyImpactEvidence = {
  avoidedProviderCallRequests: number;
  coverage: Array<{
    knownRequestCount: number;
    metric: string;
    status: "complete" | "partial" | "unavailable";
    surface: "project_application" | "tenant_chat";
    unknownRequestCount: number;
  }>;
  dataAsOf: string | null;
  dataState: "live" | "partial" | "unavailable";
  highPerformanceEligibleRequests: number;
  highPerformanceRequests: number;
  knownSavedCostMicroUsd: number;
  modelMix: Array<{
    model: string;
    provider: string;
    requestCount: number;
    surface: "project_application" | "tenant_chat";
  }>;
  policyOutcomes: Array<{
    outcome: string;
    requestCount: number;
    surface: "project_application" | "tenant_chat";
  }>;
  protectedRequests: number;
  routingRoles: Array<{
    requestCount: number;
    role: string;
    scheme: "difficulty" | "route_tier";
    surface: "project_application" | "tenant_chat";
  }>;
  savedCostMicroUsd: number | null;
  totalCostMicroUsd: number;
  totalRequests: number;
  usageSources: Array<{
    costMicroUsd: number;
    projectId: string | null;
    requestCount: number;
    surface: "project_application" | "tenant_chat";
  }>;
};

export type AnalyticsV5ModelSeries = {
  id: string;
  label: string;
  total: number;
  values: number[];
};

export type AnalyticsV5Evidence = {
  modelTraffic: {
    bucketStarts: string[];
    series: AnalyticsV5ModelSeries[];
  };
  policyImpact?: AnalyticsV5PolicyImpactEvidence;
};

const bucketCountByRange: Record<LiveAnalyticsRange, number> = {
  "15m": 15,
  "1h": 12,
  "1d": 24,
  "1w": 7
};

const MAX_MODEL_SERIES = 5;

export function buildAnalyticsV5Evidence(
  records: AnalyticsV5ModelBucket[],
  input: { from: string; range: LiveAnalyticsRange; to: string },
  policyImpact?: AnalyticsV5PolicyImpactEvidence
): AnalyticsV5Evidence {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  const bucketCount = bucketCountByRange[input.range];
  const intervalMs = Math.max(1, (toMs - fromMs) / bucketCount);
  const usableRecords = records.filter((record) => {
    const periodStart = Date.parse(record.periodStart);
    return record.requestCount > 0 && Number.isFinite(periodStart) && periodStart >= fromMs && periodStart < toMs;
  });
  const modelTotals = new Map<string, number>();

  usableRecords.forEach((record) => {
    const model = normalizedModel(record);
    if (model) {
      modelTotals.set(model, (modelTotals.get(model) ?? 0) + record.requestCount);
    }
  });

  const rankedModels = [...modelTotals.entries()]
    .sort((left, right) => right[1] - left[1]);
  const visibleModelNames = rankedModels.length > MAX_MODEL_SERIES
    ? rankedModels.slice(0, MAX_MODEL_SERIES - 1).map(([model]) => model)
    : rankedModels.map(([model]) => model);
  const includesOther = rankedModels.length > MAX_MODEL_SERIES;
  const seriesNames = includesOther ? [...visibleModelNames, "Other"] : visibleModelNames;
  const valuesBySeries = new Map(seriesNames.map((model) => [model, Array(bucketCount).fill(0) as number[]]));

  usableRecords.forEach((record) => {
    const model = normalizedModel(record);
    if (!model) {
      return;
    }

    const periodStart = Date.parse(record.periodStart);
    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((periodStart - fromMs) / intervalMs)));
    const seriesName = visibleModelNames.includes(model) ? model : includesOther ? "Other" : model;
    const values = valuesBySeries.get(seriesName);
    if (values) {
      values[bucketIndex] += record.requestCount;
    }
  });

  return {
    modelTraffic: {
      bucketStarts: Array.from({ length: bucketCount }, (_, index) =>
        new Date(fromMs + intervalMs * index).toISOString()),
      series: seriesNames.map((model) => ({
        id: model,
        label: model,
        total: valuesBySeries.get(model)?.reduce((sum, value) => sum + value, 0) ?? 0,
        values: valuesBySeries.get(model) ?? []
      }))
    },
    ...(policyImpact ? { policyImpact } : {})
  };
}

function normalizedModel(record: AnalyticsV5ModelBucket) {
  const model = record.model.trim();
  return model ? formatModelDisplayName(model) : null;
}
