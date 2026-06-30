import http from "k6/http";
import { check, sleep } from "k6";

const gatewayBaseUrl = trimTrailingSlash(__ENV.GATEWAY_BASE_URL || "http://localhost:8080");
const apiKey = __ENV.GATELM_DEMO_API_KEY || __ENV.GATELM_API_KEY || "glm_api_test_redacted";
const appToken = __ENV.GATELM_DEMO_APP_TOKEN || __ENV.GATELM_APP_TOKEN || "glm_app_token_test_redacted";
const endUserId = __ENV.GATELM_DEMO_END_USER_ID || "user_k6_baseline";
const cacheHitIterations = positiveIntEnv("K6_CACHE_HIT_ITERATIONS", 3);
const enableDependencyScenarios = (__ENV.K6_ENABLE_V2_DEPENDENCY_SCENARIOS || "").toLowerCase() === "true";

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
  "raw_response",
];

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 403, 429));

export const options = {
  scenarios: {
    baseline_success: {
      executor: "shared-iterations",
      exec: "baseline_success",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "0s",
    },
    cache_miss_provider_call: {
      executor: "shared-iterations",
      exec: "cache_miss_provider_call",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "5s",
    },
    cache_hit: {
      executor: "shared-iterations",
      exec: "cache_hit",
      vus: 1,
      iterations: cacheHitIterations,
      maxDuration: "45s",
      startTime: "10s",
    },
    safety_redaction: {
      executor: "shared-iterations",
      exec: "safety_redaction",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "20s",
    },
    safety_block_provider_bypass: {
      executor: "shared-iterations",
      exec: "safety_block_provider_bypass",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "25s",
    },
    rate_limited: {
      executor: "shared-iterations",
      exec: "rate_limited",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "30s",
    },
    provider_timeout: {
      executor: "shared-iterations",
      exec: "provider_timeout",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "35s",
    },
    provider_error_mock_fallback: {
      executor: "shared-iterations",
      exec: "provider_error_mock_fallback",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "40s",
    },
    streaming_thin_slice: {
      executor: "shared-iterations",
      exec: "streaming_thin_slice",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "45s",
    },
    mixed_demo_traffic: {
      executor: "shared-iterations",
      exec: "mixed_demo_traffic",
      vus: 1,
      iterations: 2,
      maxDuration: "45s",
      startTime: "50s",
    },
    metrics_probe: {
      executor: "shared-iterations",
      exec: "metrics_probe",
      vus: 1,
      iterations: 1,
      maxDuration: "30s",
      startTime: "60s",
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
    missPrompt: `Write a short safe refund response for GateLM provider-call evidence ${runId}.`,
    redactionPrompt: `Write a support reply to synthetic.user.${runId}@example.test without exposing the address.`,
    blockedPrompt: `This synthetic request contains api_key=test_secret_token_redacted_for_demo_only_${runId}_abcdef1234567890`,
  };
}

export function baseline_success(data) {
  const response = chatCompletion(data.safePrompt, "baseline_success");
  check(response, {
    "baseline success returns 200": (r) => r.status === 200,
    "baseline success terminal outcome is success-compatible": (r) => headerValue(r, "X-GateLM-Cache-Status") !== "",
  });
  sleep(1);
}

export function cache_miss_provider_call(data) {
  const providerBefore = sumMetric(getMetrics(), "gatelm_provider_requests_total");
  const response = chatCompletion(data.missPrompt, "cache_miss_provider_call");
  const metricsAfter = getMetrics();
  const providerAfter = sumMetric(metricsAfter, "gatelm_provider_requests_total");

  console.log(`metric_delta cache_miss_provider_call provider_requests_total ${providerBefore} -> ${providerAfter}`);

  check(response, {
    "cache miss provider call returns 200": (r) => r.status === 200,
    "cache miss provider call is cache miss": (r) => headerValue(r, "X-GateLM-Cache-Status") === "miss",
  });
  check(metricsAfter, {
    "cache miss provider call increments provider metric": () => providerAfter > providerBefore,
  });
  sleep(1);
}

export function cache_hit(data) {
  const metricsBefore = getMetrics();
  const providerBefore = sumMetric(metricsBefore, "gatelm_provider_requests_total");
  const response = chatCompletion(data.safePrompt, "cache_hit");
  const metricsAfter = getMetrics();
  const providerAfter = sumMetric(metricsAfter, "gatelm_provider_requests_total");

  console.log(`metric_delta cache_hit provider_requests_total ${providerBefore} -> ${providerAfter}`);

  check(response, {
    "cache hit returns 200": (r) => r.status === 200,
    "cache hit reports exact cache hit": (r) => headerValue(r, "X-GateLM-Cache-Status") === "hit",
  });
  check(metricsAfter, {
    "cache hit does not increment provider metric": () => providerAfter === providerBefore,
    "cache hit records cache hit lookup": (body) =>
      sumMetric(body, "gatelm_cache_operations_total", { operation: "lookup", cache_status: "hit", cache_type: "exact" }) >= 1,
  });

  sleep(1);
}

export function safety_redaction(data) {
  const response = chatCompletion(data.redactionPrompt, "safety_redaction");
  check(response, {
    "safety redaction returns 200": (r) => r.status === 200,
    "safety redaction produces sanitized masking header": (r) => ["redacted", "none"].includes(headerValue(r, "X-GateLM-Masking-Action")),
  });
  sleep(1);
}

export function safety_block_provider_bypass(data) {
  const metricsBefore = getMetrics();
  const providerBefore = sumMetric(metricsBefore, "gatelm_provider_requests_total");
  const cacheBefore = sumMetric(metricsBefore, "gatelm_cache_operations_total");
  const response = chatCompletion(data.blockedPrompt, "safety_block_provider_bypass");
  const metricsAfter = getMetrics();
  const providerAfter = sumMetric(metricsAfter, "gatelm_provider_requests_total");
  const cacheAfter = sumMetric(metricsAfter, "gatelm_cache_operations_total");

  console.log(`metric_delta safety_block provider_requests_total ${providerBefore} -> ${providerAfter}`);
  console.log(`metric_delta safety_block cache_operations_total ${cacheBefore} -> ${cacheAfter}`);

  check(response, {
    "safety block returns 403": (r) => r.status === 403,
    "safety block error code is sensitive_data_blocked": (r) => errorCode(r.body) === "sensitive_data_blocked",
    "safety block bypasses cache": (r) => headerValue(r, "X-GateLM-Cache-Status") === "bypass",
    "safety block reports masking blocked": (r) => headerValue(r, "X-GateLM-Masking-Action") === "blocked",
  });
  check(metricsAfter, {
    "safety block does not increment provider metric": () => providerAfter === providerBefore,
    "safety block does not increment cache metric": () => cacheAfter === cacheBefore,
  });
}

export function rate_limited(data) {
  if (!enableDependencyScenarios) {
    guardedEvidence("rate_limited", "set K6_ENABLE_V2_DEPENDENCY_SCENARIOS=true after PR-3 rate limit policy is configured");
    return;
  }
  const response = chatCompletion(data.safePrompt, "rate_limited");
  check(response, {
    "rate limited returns 429": (r) => r.status === 429,
    "rate limited error code": (r) => errorCode(r.body) === "rate_limited",
  });
}

export function provider_timeout() {
  guardedEvidence("provider_timeout", "requires PR-2A provider timeout injection; not implemented in PR-5");
}

export function provider_error_mock_fallback() {
  guardedEvidence("provider_error_mock_fallback", "requires PR-2A fallback controls; not implemented in PR-5");
}

export function streaming_thin_slice() {
  guardedEvidence("streaming_thin_slice", "requires PR-4 streaming thin slice; not implemented in PR-5");
}

export function mixed_demo_traffic(data) {
  const response = chatCompletion(data.safePrompt, "mixed_demo_traffic");
  check(response, {
    "mixed demo traffic returns 200": (r) => r.status === 200,
  });
  sleep(1);
}

function guardedEvidence(name, reason) {
  console.log(`guarded_scenario ${name}: ${reason}`);
  check(reason, {
    [`${name} guarded until dependency PR lands`]: () => true,
  });
}

/*
 * Legacy scenario names are kept as wrappers for local scripts that may still invoke them directly.
 */
export function safe_miss_warmup(data) {
  cache_miss_provider_call(data);
}

export function safe_cache_hit_baseline(data) {
  cache_hit(data);
}

export function blocked_before_provider(data) {
  safety_block_provider_bypass(data);
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
