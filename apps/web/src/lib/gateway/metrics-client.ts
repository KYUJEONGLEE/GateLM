import "server-only";

import type { IncomingHttpHeaders } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import type { GatewayMetricsModel, MetricsFamily, MetricsSample } from "@/lib/gateway/metrics-types";

const requiredMetricFamilies = [
  "gatelm_gateway_requests_total",
  "gatelm_gateway_request_duration_seconds",
  "gatelm_gateway_inflight_requests",
  "gatelm_provider_requests_total",
  "gatelm_provider_request_duration_seconds",
  "gatelm_cache_operations_total",
  "gatelm_rate_limit_decisions_total",
  "gatelm_rate_limit_decision_duration_seconds",
  "gatelm_masking_actions_total",
  "gatelm_log_writes_total",
  "gatelm_log_write_duration_seconds"
] as const;

const safeMetricLabels = new Set([
  "cache_status",
  "cache_type",
  "endpoint",
  "error_code",
  "http_status",
  "le",
  "masking_action",
  "method",
  "operation",
  "rate_limit_allowed",
  "selected_model",
  "selected_provider",
  "status"
]);

const forbiddenMetricLabels = new Set([
  "api_key",
  "api_key_id",
  "app_token",
  "app_token_id",
  "application_id",
  "authorization",
  "cache_key_hash",
  "credential",
  "end_user_id",
  "feature_id",
  "project_id",
  "prompt",
  "prompt_hash",
  "provider_key",
  "request_id",
  "secret",
  "tenant_id",
  "token",
  "trace_id"
]);

type GatewayMetricsHttpResponse = {
  body: string;
  headers: IncomingHttpHeaders;
  status: number;
};

type ParsedPrometheus = {
  families: MetricsFamily[];
  forbiddenLabelNames: string[];
};

export async function getGatewayMetricsModel(routeTenantId: string): Promise<GatewayMetricsModel> {
  const checkedAt = new Date().toISOString();
  const gatewayConfig = getLiveGatewayConfig();

  try {
    const response = await requestGatewayMetrics(gatewayConfig.baseUrl);
    const parsed = parsePrometheusMetrics(response.body);
    const presentFamilyCount = parsed.families.filter((family) => family.status === "present").length;
    const seriesCount = parsed.families.reduce((total, family) => total + family.sampleCount, 0);

    return {
      checkedAt,
      families: parsed.families,
      loadError:
        response.status >= 200 && response.status < 300
          ? null
          : `Gateway /metrics failed with HTTP ${response.status}.`,
      meta: {
        httpStatus: response.status
      },
      routeTenantId,
      summary: {
        forbiddenLabelNames: parsed.forbiddenLabelNames,
        missingFamilyCount: requiredMetricFamilies.length - presentFamilyCount,
        presentFamilyCount,
        seriesCount
      }
    };
  } catch {
    const families = buildEmptyFamilies();

    return {
      checkedAt,
      families,
      loadError: "Gateway unavailable.",
      meta: {
        httpStatus: null
      },
      routeTenantId,
      summary: {
        forbiddenLabelNames: [],
        missingFamilyCount: families.length,
        presentFamilyCount: 0,
        seriesCount: 0
      }
    };
  }
}

function requestGatewayMetrics(baseUrl: string): Promise<GatewayMetricsHttpResponse> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL("/metrics", `${baseUrl.replace(/\/+$/, "")}/`);
    const transport = endpoint.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(endpoint, { method: "GET" }, (response) => {
      const chunks: Buffer[] = [];

      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: response.headers,
          status: response.statusCode ?? 0
        });
      });
    });

    request.setTimeout(5000, () => {
      request.destroy(new Error("Gateway /metrics request timed out."));
    });
    request.on("error", reject);
    request.end();
  });
}

function parsePrometheusMetrics(output: string): ParsedPrometheus {
  const helpByFamily = new Map<string, string>();
  const typeByFamily = new Map<string, string>();
  const samplesByFamily = new Map<string, MetricsSample[]>();
  const forbiddenLabels = new Set<string>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("# HELP ")) {
      const [, metricName, help] = line.match(/^# HELP\s+(\S+)\s+(.+)$/) ?? [];
      const familyName = getRequiredFamilyName(metricName);

      if (familyName && help) {
        helpByFamily.set(familyName, help);
      }
      continue;
    }

    if (line.startsWith("# TYPE ")) {
      const [, metricName, metricType] = line.match(/^# TYPE\s+(\S+)\s+(\S+)$/) ?? [];
      const familyName = getRequiredFamilyName(metricName);

      if (familyName && metricType) {
        typeByFamily.set(familyName, metricType);
      }
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    const sample = parseSampleLine(line);
    if (!sample) {
      continue;
    }

    const familyName = getRequiredFamilyName(sample.metricName);
    if (!familyName) {
      continue;
    }

    for (const unsafeLabelName of sample.unsafeLabelNames) {
      forbiddenLabels.add(unsafeLabelName);
    }

    samplesByFamily.set(familyName, [...(samplesByFamily.get(familyName) ?? []), sample]);
  }

  return {
    families: requiredMetricFamilies.map((name) => {
      const samples = samplesByFamily.get(name) ?? [];

      return {
        help: helpByFamily.get(name) ?? null,
        name,
        sampleCount: samples.length,
        samples: samples.slice(0, 12),
        status: samples.length > 0 ? "present" : "missing",
        type: typeByFamily.get(name) ?? null
      };
    }),
    forbiddenLabelNames: Array.from(forbiddenLabels).sort()
  };
}

function buildEmptyFamilies(): MetricsFamily[] {
  return requiredMetricFamilies.map((name) => ({
    help: null,
    name,
    sampleCount: 0,
    samples: [],
    status: "missing",
    type: null
  }));
}

function parseSampleLine(line: string): MetricsSample | null {
  const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(.+)$/);

  if (!match) {
    return null;
  }

  const [, metricName, labelBlock, valueBlock] = match;
  const { labels, unsafeLabelNames } = parseLabels(labelBlock ?? "");

  return {
    labels,
    metricName,
    unsafeLabelNames,
    value: valueBlock.trim().split(/\s+/)[0] ?? "0"
  };
}

function parseLabels(labelBlock: string) {
  const labels: Record<string, string> = {};
  const unsafeLabelNames: string[] = [];
  const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g;

  for (const match of labelBlock.matchAll(labelPattern)) {
    const [, rawName, rawValue] = match;
    const labelName = rawName.toLowerCase();

    if (forbiddenMetricLabels.has(labelName)) {
      unsafeLabelNames.push(labelName);
      continue;
    }

    if (safeMetricLabels.has(labelName)) {
      labels[labelName] = unescapeLabelValue(rawValue);
    }
  }

  return {
    labels,
    unsafeLabelNames
  };
}

function unescapeLabelValue(value: string) {
  return value.replaceAll("\\n", "\n").replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

function getRequiredFamilyName(metricName: string | undefined) {
  if (!metricName) {
    return null;
  }

  if (isRequiredMetricFamily(metricName)) {
    return metricName;
  }

  for (const suffix of ["_bucket", "_sum", "_count"]) {
    if (metricName.endsWith(suffix)) {
      const familyName = metricName.slice(0, -suffix.length);

      if (isRequiredMetricFamily(familyName)) {
        return familyName;
      }
    }
  }

  return null;
}

function isRequiredMetricFamily(value: string): value is (typeof requiredMetricFamilies)[number] {
  return requiredMetricFamilies.includes(value as (typeof requiredMetricFamilies)[number]);
}
