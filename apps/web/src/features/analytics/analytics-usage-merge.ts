import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import type {
  TenantChatCostSeries
} from "@/lib/control-plane/tenant-chat-observability-client";
import type {
  AnalyticsLatencyDistributionPoint,
  LiveAnalyticsRange
} from "@/lib/gateway/live-analytics-performance";
import type { Locale } from "@/lib/i18n/locale";

export const TENANT_CHAT_USAGE_SOURCE_ID = "surface:tenant_chat";

const analyticsBucketLabelFormatters = new Map<string, Intl.DateTimeFormat>();

export type AnalyticsRequestVolumePoint = {
  bucket: string;
  label: string;
  requests: number;
};

export type AnalyticsUsageSourceRow = {
  id: string;
  label: string;
  value: number;
};

export type AnalyticsUsageEvidence = {
  requestVolume: AnalyticsRequestVolumePoint[];
  sourceMix: AnalyticsUsageSourceRow[];
};

type UsageOverview = Pick<DashboardOverview, "costByProject" | "totalRequests">;

export function buildAnalyticsUsageEvidence(input: {
  locale: Locale;
  projectApplicationOverview?: UsageOverview;
  projectRequestVolume?: AnalyticsLatencyDistributionPoint[];
  range: LiveAnalyticsRange;
  tenantChatOverview?: UsageOverview;
  tenantChatSeries?: TenantChatCostSeries;
}): AnalyticsUsageEvidence {
  const sourceMix: AnalyticsUsageSourceRow[] = (input.projectApplicationOverview?.costByProject ?? [])
    .filter((row) => row.requestCount > 0)
    .map((row) => ({
      id: row.projectId,
      label: row.projectId,
      value: row.requestCount
    }));

  if ((input.tenantChatOverview?.totalRequests ?? 0) > 0) {
    sourceMix.push({
      id: TENANT_CHAT_USAGE_SOURCE_ID,
      label: "Tenant Chat",
      value: input.tenantChatOverview?.totalRequests ?? 0
    });
  }

  return {
    requestVolume: mergeAnalyticsRequestVolume({
      locale: input.locale,
      projectPoints: input.projectRequestVolume,
      range: input.range,
      tenantPoints: input.tenantChatSeries?.points
    }),
    sourceMix: sourceMix.sort(
      (left, right) => right.value - left.value || left.label.localeCompare(right.label)
    )
  };
}

export function mergeAnalyticsRequestVolume(input: {
  locale: Locale;
  projectPoints?: AnalyticsLatencyDistributionPoint[];
  range: LiveAnalyticsRange;
  tenantPoints?: TenantChatCostSeries["points"];
}): AnalyticsRequestVolumePoint[] {
  const buckets = new Map<string, AnalyticsRequestVolumePoint>();

  for (const point of input.projectPoints ?? []) {
    const bucket = normalizeBucket(point.bucket);
    buckets.set(bucket, {
      bucket,
      label: point.label || formatBucketLabel(bucket, input.range, input.locale),
      requests: Math.max(0, point.requests)
    });
  }

  for (const point of input.tenantPoints ?? []) {
    const bucket = normalizeBucket(point.periodStart);
    const existing = buckets.get(bucket);
    buckets.set(bucket, {
      bucket,
      label: existing?.label ?? formatBucketLabel(bucket, input.range, input.locale),
      requests: (existing?.requests ?? 0) + Math.max(0, point.requestCount)
    });
  }

  return [...buckets.values()].sort((left, right) => left.bucket.localeCompare(right.bucket));
}

export function tenantChatBucketForAnalyticsRange(
  range: LiveAnalyticsRange
): TenantChatCostSeries["bucket"] {
  if (range === "15m") return "1m";
  if (range === "1h") return "5m";
  if (range === "1d") return "1h";
  return "1d";
}

function normalizeBucket(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function formatBucketLabel(value: string, range: LiveAnalyticsRange, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return analyticsBucketLabelFormatter(range, locale).format(date);
}

function analyticsBucketLabelFormatter(range: LiveAnalyticsRange, locale: Locale) {
  const key = `${locale}:${range}`;
  const cached = analyticsBucketLabelFormatters.get(key);
  if (cached) {
    return cached;
  }

  const language = locale === "ko" ? "ko-KR" : "en-US";
  const formatter = new Intl.DateTimeFormat(
    language,
    range === "1w"
      ? { day: "numeric", month: "numeric", timeZone: "UTC" }
      : {
          hour: "2-digit",
          minute: range === "1d" ? undefined : "2-digit",
          timeZone: "UTC"
        }
  );
  analyticsBucketLabelFormatters.set(key, formatter);
  return formatter;
}
