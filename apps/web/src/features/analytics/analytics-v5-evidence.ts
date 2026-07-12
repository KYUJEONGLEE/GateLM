import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";

export type AnalyticsV5ProjectUsage = {
  projectId: string;
  costMicroUsd: number;
  requestCount: number;
};

export type AnalyticsV5ModelSeries = {
  id: string;
  label: string;
  total: number;
  values: number[];
};

export type AnalyticsV5Evidence = {
  projectUsage: AnalyticsV5ProjectUsage[];
  highQualityRate: number;
  highQualityRequests: number;
  latency: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
  modelTraffic: {
    bucketStarts: string[];
    series: AnalyticsV5ModelSeries[];
  };
  recordCount: number;
};

const bucketCountByRange: Record<LiveAnalyticsRange, number> = {
  "15m": 15,
  "1h": 12,
  "1d": 24,
  "1w": 7
};

const MAX_MODEL_SERIES = 5;
const MAX_PROJECT_ROWS = 5;

export function buildAnalyticsV5Evidence(
  records: InvocationLogRecord[],
  input: { from: string; range: LiveAnalyticsRange; to: string }
): AnalyticsV5Evidence {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  const bucketCount = bucketCountByRange[input.range];
  const intervalMs = Math.max(1, (toMs - fromMs) / bucketCount);
  const usableRecords = records.filter((record) => {
    const createdAt = Date.parse(record.createdAt);
    return Number.isFinite(createdAt) && createdAt >= fromMs && createdAt < toMs;
  });
  const modelTotals = new Map<string, number>();
  const projectTotals = new Map<string, AnalyticsV5ProjectUsage>();
  const latencyValues: number[] = [];
  let highQualityRequests = 0;
  let routedRequests = 0;

  usableRecords.forEach((record) => {
    const model = normalizedModel(record);
    if (model) {
      modelTotals.set(model, (modelTotals.get(model) ?? 0) + 1);
      routedRequests += 1;
    }

    if (isHighQualityRoute(record.routingReason)) {
      highQualityRequests += 1;
    }

    if (Number.isFinite(record.latencyMs) && record.latencyMs >= 0) {
      latencyValues.push(record.latencyMs);
    }

    const projectId = record.projectId?.trim();
    if (projectId) {
      const current = projectTotals.get(projectId) ?? {
        projectId,
        costMicroUsd: 0,
        requestCount: 0
      };
      current.requestCount += 1;
      current.costMicroUsd += Math.max(0, record.costMicroUsd || 0);
      projectTotals.set(projectId, current);
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

    const createdAt = Date.parse(record.createdAt);
    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((createdAt - fromMs) / intervalMs)));
    const seriesName = visibleModelNames.includes(model) ? model : includesOther ? "Other" : model;
    const values = valuesBySeries.get(seriesName);
    if (values) {
      values[bucketIndex] += 1;
    }
  });

  latencyValues.sort((left, right) => left - right);

  return {
    projectUsage: [...projectTotals.values()]
      .sort((left, right) => right.requestCount - left.requestCount)
      .slice(0, MAX_PROJECT_ROWS),
    highQualityRate: routedRequests > 0 ? Math.min(1, highQualityRequests / routedRequests) : 0,
    highQualityRequests,
    latency: {
      p50Ms: percentile(latencyValues, 0.5),
      p95Ms: percentile(latencyValues, 0.95),
      p99Ms: percentile(latencyValues, 0.99)
    },
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
    recordCount: usableRecords.length
  };
}

function normalizedModel(record: InvocationLogRecord) {
  return record.selectedModel?.trim() || record.requestedModel?.trim() || null;
}

function isHighQualityRoute(value: string | null | undefined) {
  const reason = value?.trim().toLowerCase() ?? "";
  return reason.includes("high_quality") && !reason.includes("downgraded_from_high_quality");
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1);
  return values[Math.max(0, index)] ?? 0;
}
