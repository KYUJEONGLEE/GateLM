import http from "k6/http";
import { check } from "k6";

const allowedGatewayBaseUrls = new Set([
  "http://127.0.0.1:18080",
  "http://localhost:18080",
  "http://gateway-core:8080",
]);

const gatewayBaseUrl = normalizeBaseUrl(
  __ENV.GATEWAY_BASE_URL || "http://127.0.0.1:18080",
);
const apiKey = requiredEnv("GATELM_DEMO_API_KEY");
const appToken = requiredEnv("GATELM_DEMO_APP_TOKEN");
const targetRps = positiveIntEnv("GATELM_K6_TARGET_RPS", 1);
const duration = durationEnv("GATELM_K6_DURATION", "2m");
const preAllocatedVUs = positiveIntEnv(
  "GATELM_K6_PRE_ALLOCATED_VUS",
  Math.max(2, targetRps),
);
const maxVUs = positiveIntEnv(
  "GATELM_K6_MAX_VUS",
  Math.max(preAllocatedVUs, targetRps * 2),
);
const runId = optionalIdentifierEnv(
  "GATELM_K6_RUN_ID",
  `run_${Date.now().toString(36)}_${randomSuffix()}`,
);
const evidenceBasename = optionalIdentifierEnv(
  "GATELM_K6_EVIDENCE_BASENAME",
  "",
);

if (!allowedGatewayBaseUrls.has(gatewayBaseUrl)) {
  throw new Error(
    "This load script only allows the isolated Mock Gateway endpoints.",
  );
}

if (maxVUs < preAllocatedVUs) {
  throw new Error(
    "GATELM_K6_MAX_VUS must be greater than or equal to GATELM_K6_PRE_ALLOCATED_VUS.",
  );
}

export const options = {
  scenarios: {
    cache_miss_load: {
      executor: "constant-arrival-rate",
      rate: targetRps,
      timeUnit: "1s",
      duration,
      preAllocatedVUs,
      maxVUs,
      gracefulStop: "10s",
      tags: { traffic_profile: "cache_miss" },
    },
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
    "dropped_iterations{scenario:cache_miss_load}": ["count==0"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  const ready = http.get(`${gatewayBaseUrl}/readyz`, {
    tags: { name: "GET /readyz", phase: "preflight" },
  });
  if (ready.status !== 200 || safeJson(ready.body).status !== "ready") {
    throw new Error(`Mock Gateway readiness check failed with HTTP ${ready.status}.`);
  }

  const requestId = `request_perf_preflight_${runId}`;
  const response = chatCompletion(
    `GateLM synthetic Mock load preflight ${runId}.`,
    requestId,
    "preflight",
  );
  const metadata = safeJson(response.body).gate_lm || {};

  if (
    response.status !== 200 ||
    metadata.selectedProvider !== "mock" ||
    metadata.providerCalled !== true ||
    !isMockModel(metadata.selectedModel)
  ) {
    throw new Error("Mock routing preflight failed; load execution was blocked.");
  }

  return { runId };
}

export default function (data) {
  const requestId = `request_perf_load_${data.runId}_${__VU}_${__ITER}`;
  const response = chatCompletion(
    `GateLM synthetic cache-miss load ${requestId}.`,
    requestId,
    "load",
  );
  const metadata = safeJson(response.body).gate_lm || {};

  check(response, {
    "load request returns 200": (value) => value.status === 200,
    "load request uses Mock provider": () => metadata.selectedProvider === "mock",
    "load request calls provider": () => metadata.providerCalled === true,
    "load request uses Mock model": () => isMockModel(metadata.selectedModel),
    "load request is a cache miss": (value) =>
      headerValue(value, "X-GateLM-Cache-Status") === "miss",
  });
}

export function handleSummary(data) {
  const summary = buildEvidenceSummary(data);
  const outputs = {
    stdout: renderEvidenceSummary(summary),
  };
  if (evidenceBasename) {
    outputs[`/reports/${evidenceBasename}.k6-summary.json`] =
      `${JSON.stringify(summary, null, 2)}\n`;
    outputs[`/reports/${evidenceBasename}.k6-summary.env`] =
      renderEvidenceEnv(summary);
  }
  return outputs;
}

function buildEvidenceSummary(data) {
  return {
    schemaVersion: "gatelm.gateway-load-k6-summary.v1",
    runId,
    targetRps,
    duration,
    preAllocatedVUs,
    maxVUs,
    loadIterations: metricValue(data, "iterations", "count"),
    droppedIterations: metricValue(data, "dropped_iterations", "count"),
    checksPassed: metricValue(data, "checks", "passes"),
    checksFailed: metricValue(data, "checks", "fails"),
    httpRequestFailedRate: metricValue(data, "http_req_failed", "rate"),
    httpRequestDurationMs: {
      p95: metricValue(data, "http_req_duration", "p(95)"),
      p99: metricValue(data, "http_req_duration", "p(99)"),
      max: metricValue(data, "http_req_duration", "max"),
    },
  };
}

function renderEvidenceSummary(summary) {
  return [
    "",
    "GateLM cache-miss load evidence",
    `  run id: ${summary.runId}`,
    `  completed load requests: ${summary.loadIterations}`,
    `  dropped iterations: ${summary.droppedIterations}`,
    `  failed checks: ${summary.checksFailed}`,
    `  HTTP failure rate: ${summary.httpRequestFailedRate}`,
    `  HTTP duration p95/p99: ${summary.httpRequestDurationMs.p95}ms / ${summary.httpRequestDurationMs.p99}ms`,
    "",
  ].join("\n");
}

function renderEvidenceEnv(summary) {
  return [
    "GATELM_EVIDENCE_SCHEMA=gatelm.gateway-load-k6-summary.v1",
    `GATELM_EVIDENCE_RUN_ID=${summary.runId}`,
    `GATELM_EVIDENCE_LOAD_ITERATIONS=${summary.loadIterations}`,
    `GATELM_EVIDENCE_DROPPED_ITERATIONS=${summary.droppedIterations}`,
    `GATELM_EVIDENCE_CHECKS_PASSED=${summary.checksPassed}`,
    `GATELM_EVIDENCE_CHECKS_FAILED=${summary.checksFailed}`,
    `GATELM_EVIDENCE_HTTP_FAILED_RATE=${summary.httpRequestFailedRate}`,
    `GATELM_EVIDENCE_HTTP_DURATION_P95_MS=${summary.httpRequestDurationMs.p95}`,
    `GATELM_EVIDENCE_HTTP_DURATION_P99_MS=${summary.httpRequestDurationMs.p99}`,
    `GATELM_EVIDENCE_HTTP_DURATION_MAX_MS=${summary.httpRequestDurationMs.max}`,
    "",
  ].join("\n");
}

function metricValue(data, metricName, valueName) {
  const value = data.metrics?.[metricName]?.values?.[valueName];
  return Number.isFinite(value) ? value : 0;
}

function chatCompletion(prompt, requestId, phase) {
  return http.post(
    `${gatewayBaseUrl}/v1/chat/completions`,
    JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 16,
      stream: false,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-GateLM-App-Token": appToken,
        "X-GateLM-End-User-Id": "perf_load_synthetic",
        "X-GateLM-Feature-Id": "perf_cache_miss_load",
        "X-GateLM-Request-Id": requestId,
      },
      tags: { name: "POST /v1/chat/completions", phase },
    },
  );
}

function safeJson(body) {
  try {
    return JSON.parse(body || "{}");
  } catch (_) {
    return {};
  }
}

function isMockModel(value) {
  const catalogModel = typeof value === "string" ? value.split(":").pop() : "";
  return catalogModel.startsWith("mock-");
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

function requiredEnv(name) {
  const value = String(__ENV[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function positiveIntEnv(name, fallback) {
  const raw = String(__ENV[name] || fallback).trim();
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function durationEnv(name, fallback) {
  const value = String(__ENV[name] || fallback).trim();
  if (!/^\d+(ms|s|m|h)$/.test(value) || value.startsWith("0")) {
    throw new Error(`${name} must be a positive k6 duration such as 30s or 2m.`);
  }
  return value;
}

function optionalIdentifierEnv(name, fallback) {
  const value = String(__ENV[name] || fallback).trim();
  if (!value) {
    return "";
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) {
    throw new Error(
      `${name} must be 1-80 ASCII letters, digits, underscores, or hyphens.`,
    );
  }
  return value;
}

function normalizeBaseUrl(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function randomSuffix() {
  return Math.floor(Math.random() * 1000000).toString(36);
}
