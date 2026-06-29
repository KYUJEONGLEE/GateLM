import http from "k6/http";
import { check, sleep } from "k6";

const gatewayBaseUrl = trimTrailingSlash(__ENV.GATEWAY_BASE_URL || "http://localhost:8080");
const apiKey = __ENV.GATELM_DEMO_API_KEY || __ENV.GATELM_API_KEY || "glm_api_test_redacted";
const appToken = __ENV.GATELM_DEMO_APP_TOKEN || __ENV.GATELM_APP_TOKEN || "glm_app_token_test_redacted";
const endUserId = __ENV.GATELM_DEMO_END_USER_ID || "user_k6_baseline";
const cacheHitIterations = positiveIntEnv("K6_CACHE_HIT_ITERATIONS", 3);

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
  "gatelm_log_write_duration_seconds",
];

const forbiddenMetricLabels = [
  "request_id",
  "trace_id",
  "tenant_id",
  "project_id",
  "application_id",
  "api_key_id",
  "app_token_id",
  "end_user_id",
  "feature_id",
  "prompt",
  "prompt_hash",
  "request_body_hash",
  "cache_key_hash",
  "provider_key",
  "authorization",
  "raw_error_detail",
];

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 403));

export const options = {
  scenarios: {
    safe_miss_warmup: {
      executor: "shared-iterations",
      exec: "safe_miss_warmup",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "0s",
    },
    safe_cache_hit_baseline: {
      executor: "shared-iterations",
      exec: "safe_cache_hit_baseline",
      vus: 1,
      iterations: cacheHitIterations,
      maxDuration: "45s",
      startTime: "5s",
    },
    blocked_before_provider: {
      executor: "shared-iterations",
      exec: "blocked_before_provider",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "15s",
    },
    metrics_probe: {
      executor: "shared-iterations",
      exec: "metrics_probe",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "20s",
    },
  },
  thresholds: {
    checks: ["rate==1.0"],
    http_req_failed: ["rate==0"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"],
};

export function setup() {
  const health = http.get(`${gatewayBaseUrl}/healthz`, {
    tags: { name: "GET /healthz" },
  });
  if (health.status !== 200) {
    throw new Error(`Gateway health check failed at ${gatewayBaseUrl}/healthz with HTTP ${health.status}`);
  }

  const fallbackRunId = `run_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000000).toString(36)}`;
  const runId = (__ENV.GATELM_K6_RUN_ID || fallbackRunId).replace(/[^A-Za-z0-9_]/g, "_");
  const metricsBefore = getMetrics();

  return {
    runId,
    metricsBefore,
    safePrompt: `Write a short safe refund response for GateLM k6 baseline ${runId}.`,
    blockedPrompt: `This synthetic request contains api_key=test_secret_token_redacted_for_demo_only_${runId}_abcdef1234567890`,
  };
}

export function safe_miss_warmup(data) {
  const providerBefore = sumMetric(data.metricsBefore, "gatelm_provider_requests_total");
  const response = chatCompletion(data.safePrompt, "k6-safe-miss-warmup");
  const metricsAfter = getMetrics();
  const providerAfter = sumMetric(metricsAfter, "gatelm_provider_requests_total");

  console.log(`metric_delta safe_miss provider_requests_total ${providerBefore} -> ${providerAfter}`);

  check(response, {
    "safe warm-up returns 200": (r) => r.status === 200,
    "safe warm-up is cache miss": (r) => headerValue(r, "X-GateLM-Cache-Status") === "miss",
    "safe warm-up has no masking": (r) => headerValue(r, "X-GateLM-Masking-Action") === "none",
  });
  check(metricsAfter, {
    "safe warm-up increments provider metric": () => providerAfter > providerBefore,
    "safe warm-up records success request metric": (body) =>
      sumMetric(body, "gatelm_gateway_requests_total", { status: "success", http_status: "200" }) >= 1,
    "safe warm-up records cache miss lookup": (body) =>
      sumMetric(body, "gatelm_cache_operations_total", { operation: "lookup", cache_status: "miss", cache_type: "exact" }) >= 1,
  });

  sleep(1);
}

export function safe_cache_hit_baseline(data) {
  const metricsBefore = getMetrics();
  const providerBefore = sumMetric(metricsBefore, "gatelm_provider_requests_total");
  const response = chatCompletion(data.safePrompt, "k6-safe-cache-hit");
  const metricsAfter = getMetrics();
  const providerAfter = sumMetric(metricsAfter, "gatelm_provider_requests_total");

  console.log(`metric_delta cache_hit provider_requests_total ${providerBefore} -> ${providerAfter}`);

  check(response, {
    "cache baseline returns 200": (r) => r.status === 200,
    "cache baseline is cache hit": (r) => headerValue(r, "X-GateLM-Cache-Status") === "hit",
  });
  check(metricsAfter, {
    "cache hit does not increment provider metric": () => providerAfter === providerBefore,
    "cache hit records success request metric": (body) =>
      sumMetric(body, "gatelm_gateway_requests_total", { status: "success", http_status: "200" }) >= 1,
    "cache hit records cache hit lookup": (body) =>
      sumMetric(body, "gatelm_cache_operations_total", { operation: "lookup", cache_status: "hit", cache_type: "exact" }) >= 1,
  });

  sleep(1);
}

export function blocked_before_provider(data) {
  const metricsBefore = getMetrics();
  const providerBefore = sumMetric(metricsBefore, "gatelm_provider_requests_total");
  const cacheBefore = sumMetric(metricsBefore, "gatelm_cache_operations_total");
  const response = chatCompletion(data.blockedPrompt, "k6-blocked-before-provider");
  const metricsAfter = getMetrics();
  const providerAfter = sumMetric(metricsAfter, "gatelm_provider_requests_total");
  const cacheAfter = sumMetric(metricsAfter, "gatelm_cache_operations_total");

  console.log(`metric_delta blocked provider_requests_total ${providerBefore} -> ${providerAfter}`);
  console.log(`metric_delta blocked cache_operations_total ${cacheBefore} -> ${cacheAfter}`);

  check(response, {
    "blocked request returns 403": (r) => r.status === 403,
    "blocked request error code is sensitive_data_blocked": (r) => errorCode(r.body) === "sensitive_data_blocked",
    "blocked request bypasses cache": (r) => headerValue(r, "X-GateLM-Cache-Status") === "bypass",
    "blocked request reports masking blocked": (r) => headerValue(r, "X-GateLM-Masking-Action") === "blocked",
  });
  check(metricsAfter, {
    "blocked request does not increment provider metric": () => providerAfter === providerBefore,
    "blocked request does not increment cache metric": () => cacheAfter === cacheBefore,
    "blocked request records blocked gateway metric": (body) =>
      sumMetric(body, "gatelm_gateway_requests_total", { status: "blocked", http_status: "403", error_code: "sensitive_data_blocked" }) >= 1,
    "blocked request records masking metric": (body) =>
      sumMetric(body, "gatelm_masking_actions_total", { masking_action: "blocked" }) >= 1,
  });
}

export function metrics_probe() {
  const response = http.get(`${gatewayBaseUrl}/metrics`, {
    tags: { name: "GET /metrics" },
  });
  const body = response.body || "";

  check(response, {
    "metrics probe returns 200": (r) => r.status === 200,
    "metrics content type is prometheus text": (r) => (r.headers["Content-Type"] || "").includes("text/plain"),
  });
  check(body, {
    "metrics exposes required families": (text) => requiredMetricFamilies.every((name) => text.includes(`# TYPE ${name}`)),
    "metrics has no forbidden labels": (text) => !hasForbiddenMetricLabel(text),
    "metrics records provider request": (text) => sumMetric(text, "gatelm_provider_requests_total") >= 1,
    "metrics records cache operations": (text) => sumMetric(text, "gatelm_cache_operations_total") >= 2,
    "metrics records log writes": (text) => sumMetric(text, "gatelm_log_writes_total") >= 1,
  });
}

function chatCompletion(prompt, featureId) {
  const payload = JSON.stringify({
    model: "auto",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
    max_tokens: 128,
    stream: false,
  });

  return http.post(`${gatewayBaseUrl}/v1/chat/completions`, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-GateLM-App-Token": appToken,
      "X-GateLM-End-User-Id": endUserId,
      "X-GateLM-Feature-Id": featureId,
    },
    tags: { name: "POST /v1/chat/completions" },
  });
}

function getMetrics() {
  const response = http.get(`${gatewayBaseUrl}/metrics`, {
    tags: { name: "GET /metrics" },
  });
  check(response, {
    "metrics endpoint returns 200": (r) => r.status === 200,
  });
  return response.body || "";
}

function sumMetric(body, metricName, labelMatchers = {}) {
  const pattern = new RegExp(`^${escapeRegex(metricName)}(\\{[^}]*\\})?\\s+([-+0-9.eE]+)$`);
  let total = 0;
  for (const rawLine of String(body || "").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = line.match(pattern);
    if (!match) {
      continue;
    }
    const labels = match[1] || "";
    if (!labelsMatch(labels, labelMatchers)) {
      continue;
    }
    const value = Number(match[2]);
    if (!Number.isNaN(value)) {
      total += value;
    }
  }
  return total;
}

function labelsMatch(labels, matchers) {
  for (const [name, value] of Object.entries(matchers)) {
    const escapedValue = escapeLabelNeedle(String(value));
    const pattern = "[{,]\\s*" +
      escapeRegex(name) +
      "\\s*=\\s*\"" +
      escapeRegex(escapedValue) +
      "\"\\s*[,}]";
    const regex = new RegExp(pattern);
    if (!regex.test(labels)) {
      return false;
    }
  }
  return true;
}

function hasForbiddenMetricLabel(body) {
  return forbiddenMetricLabels.some((label) => String(body || "").includes(`${label}="`));
}

function headerValue(response, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers || {})) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return "";
}

function errorCode(body) {
  try {
    const parsed = JSON.parse(body || "{}");
    return parsed && parsed.error ? parsed.error.code || "" : "";
  } catch (_) {
    return "";
  }
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function positiveIntEnv(name, fallback) {
  const value = Number(__ENV[name]);
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeLabelNeedle(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
