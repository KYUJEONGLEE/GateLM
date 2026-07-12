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

  const runId = `run_${Date.now().toString(36)}_${randomSuffix()}`;
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

function normalizeBaseUrl(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function randomSuffix() {
  return Math.floor(Math.random() * 1000000).toString(36);
}
