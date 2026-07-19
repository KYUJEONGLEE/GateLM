import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const allowedGatewayBaseUrls = new Set([
  "http://127.0.0.1:18080",
  "http://localhost:18080",
  "http://gateway-core:8080",
]);

const gatewayBaseUrl = normalizeBaseUrl(
  __ENV.GATEWAY_BASE_URL || "http://127.0.0.1:18080",
);
const remoteTargetMode = String(__ENV.GATELM_K6_REMOTE_TARGET_MODE || "")
  .trim()
  .toLowerCase();
const allowedRemoteBaseUrl = normalizeBaseUrl(
  __ENV.GATELM_K6_ALLOWED_REMOTE_BASE_URL || "",
);
const apiKey = requiredEnv("GATELM_DEMO_API_KEY");
const appToken = requiredEnv("GATELM_DEMO_APP_TOKEN");
const edgePrivateIp = String(__ENV.GATELM_LOADGEN_EDGE_PRIVATE_IP || "").trim();
const tlsInsecure = String(__ENV.GATELM_LOADGEN_TLS_INSECURE || "false") === "true";
const gatewayCount = positiveIntEnv("GATELM_LOADGEN_GATEWAY_COUNT", 1);
const expectedUpstreams = String(__ENV.GATELM_LOADGEN_EXPECTED_UPSTREAMS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const trackGatewayUpstreams = expectedUpstreams.length > 0;
const gatewayOneResponses = new Counter("gatelm_gateway_1_responses");
const gatewayTwoResponses = new Counter("gatelm_gateway_2_responses");
const gatewayUnknownResponses = new Counter("gatelm_gateway_unknown_responses");
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

if (
  !allowedGatewayBaseUrls.has(gatewayBaseUrl) &&
  !isExplicitPrivateMockTarget(gatewayBaseUrl)
) {
  throw new Error(
    "This load script only allows an explicitly approved isolated Mock Gateway endpoint.",
  );
}

if (maxVUs < preAllocatedVUs) {
  throw new Error(
    "GATELM_K6_MAX_VUS must be greater than or equal to GATELM_K6_PRE_ALLOCATED_VUS.",
  );
}

if (![1, 2].includes(gatewayCount)) {
  throw new Error("Gateway count must be one or two replicas.");
}
if (trackGatewayUpstreams && expectedUpstreams.length !== gatewayCount) {
  throw new Error("Gateway count and expected upstream list must describe one or two replicas.");
}
if (edgePrivateIp && !isPrivateIpv4(edgePrivateIp)) {
  throw new Error("GATELM_LOADGEN_EDGE_PRIVATE_IP must be an RFC1918 IPv4 address.");
}
if (gatewayBaseUrl.startsWith("https://") && !edgePrivateIp) {
  throw new Error("An HTTPS production-clone target requires a private Edge address mapping.");
}

export const options = {
  hosts: edgePrivateIp
    ? { [new URL(gatewayBaseUrl).hostname]: edgePrivateIp }
    : {},
  insecureSkipTLSVerify: tlsInsecure,
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
    metadata.providerCalled !== true ||
    !isMockModelRef(metadata.modelRef)
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
  const upstream = headerValue(response, "X-GateLM-Perf-Upstream");
  recordUpstream(upstream);

  check(response, {
    "load request returns 200": (value) => value.status === 200,
    "load request calls provider": () => metadata.providerCalled === true,
    "load request uses Mock modelRef": () => isMockModelRef(metadata.modelRef),
    "load request is a cache miss": (value) =>
      headerValue(value, "X-GateLM-Cache-Status") === "miss",
    "load request identifies an expected Gateway replica": () =>
      !trackGatewayUpstreams || expectedUpstreams.includes(upstream),
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
    gatewayResponses: {
      replica1: metricValue(data, "gatelm_gateway_1_responses", "count"),
      replica2: metricValue(data, "gatelm_gateway_2_responses", "count"),
      unknown: metricValue(data, "gatelm_gateway_unknown_responses", "count"),
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
    `  Gateway responses replica1/replica2/unknown: ${summary.gatewayResponses.replica1} / ${summary.gatewayResponses.replica2} / ${summary.gatewayResponses.unknown}`,
    "",
  ].join("\n");
}

function renderEvidenceEnv(summary) {
  return [
    "GATELM_EVIDENCE_SCHEMA=gatelm.gateway-load-k6-summary.v1",
    `GATELM_EVIDENCE_RUN_ID=${summary.runId}`,
    `GATELM_EVIDENCE_TARGET_RPS=${summary.targetRps}`,
    `GATELM_EVIDENCE_DURATION=${summary.duration}`,
    `GATELM_EVIDENCE_PRE_ALLOCATED_VUS=${summary.preAllocatedVUs}`,
    `GATELM_EVIDENCE_MAX_VUS=${summary.maxVUs}`,
    `GATELM_EVIDENCE_LOAD_ITERATIONS=${summary.loadIterations}`,
    `GATELM_EVIDENCE_DROPPED_ITERATIONS=${summary.droppedIterations}`,
    `GATELM_EVIDENCE_CHECKS_PASSED=${summary.checksPassed}`,
    `GATELM_EVIDENCE_CHECKS_FAILED=${summary.checksFailed}`,
    `GATELM_EVIDENCE_HTTP_FAILED_RATE=${summary.httpRequestFailedRate}`,
    `GATELM_EVIDENCE_HTTP_DURATION_P95_MS=${summary.httpRequestDurationMs.p95}`,
    `GATELM_EVIDENCE_HTTP_DURATION_P99_MS=${summary.httpRequestDurationMs.p99}`,
    `GATELM_EVIDENCE_HTTP_DURATION_MAX_MS=${summary.httpRequestDurationMs.max}`,
    `GATELM_EVIDENCE_GATEWAY_1_RESPONSES=${summary.gatewayResponses.replica1}`,
    `GATELM_EVIDENCE_GATEWAY_2_RESPONSES=${summary.gatewayResponses.replica2}`,
    `GATELM_EVIDENCE_GATEWAY_UNKNOWN_RESPONSES=${summary.gatewayResponses.unknown}`,
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

function isMockModelRef(value) {
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

function recordUpstream(value) {
  if (!trackGatewayUpstreams) {
    return;
  }
  if (value === expectedUpstreams[0]) {
    gatewayOneResponses.add(1);
  } else if (gatewayCount === 2 && value === expectedUpstreams[1]) {
    gatewayTwoResponses.add(1);
  } else {
    gatewayUnknownResponses.add(1);
  }
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

function isExplicitPrivateMockTarget(value) {
  if (
    remoteTargetMode !== "private_mock" ||
    allowedRemoteBaseUrl === "" ||
    value !== allowedRemoteBaseUrl
  ) {
    return false;
  }

  const httpsMatch = value.match(
    /^https:\/\/([^/:?#]+)(?::([0-9]{1,5}))?$/,
  );
  if (httpsMatch) {
    return isValidHostname(httpsMatch[1]) && isValidPort(httpsMatch[2]);
  }

  const httpMatch = value.match(
    /^http:\/\/([0-9]{1,3}(?:\.[0-9]{1,3}){3})(?::([0-9]{1,5}))?$/,
  );
  return Boolean(
    httpMatch && isPrivateIpv4(httpMatch[1]) && isValidPort(httpMatch[2]),
  );
}

function isValidHostname(value) {
  if (
    !value ||
    value.length > 253 ||
    value.startsWith(".") ||
    value.endsWith(".")
  ) {
    return false;
  }
  return value
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
    );
}

function isValidPort(value) {
  if (value === undefined) {
    return true;
  }
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isPrivateIpv4(value) {
  const octets = value.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function randomSuffix() {
  return Math.floor(Math.random() * 1000000).toString(36);
}
