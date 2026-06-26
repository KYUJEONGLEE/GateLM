import http from "k6/http";
import { check } from "k6";
import { Rate } from "k6/metrics";

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 403));

const baseUrl = (__ENV.GATEWAY_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const apiKey = __ENV.GATELM_API_KEY || "glm_api_test_redacted";
const appToken = __ENV.GATELM_APP_TOKEN || "glm_app_token_test_redacted";
const mode = (__ENV.LOAD_MODE || "cache-miss").toLowerCase();
const rps = Number(__ENV.RPS || "5");
const duration = __ENV.DURATION || "1m";
const preAllocatedVUs = Number(__ENV.PRE_ALLOCATED_VUS || "10");
const maxVUs = Number(__ENV.MAX_VUS || "50");

const requestIdRate = new Rate("gateway_request_id");
const expectedStatusRate = new Rate("gateway_expected_status");
const cacheHitRate = new Rate("gateway_cache_hit");
const cacheMissRate = new Rate("gateway_cache_miss");
const blockedRate = new Rate("gateway_blocked");

export const options = {
  scenarios: {
    gateway_baseline: {
      executor: "constant-arrival-rate",
      rate: rps,
      timeUnit: "1s",
      duration,
      preAllocatedVUs,
      maxVUs,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    gateway_expected_status: ["rate>0.99"],
    gateway_request_id: ["rate>0.99"],
  },
};

function headers(featureId) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-GateLM-App-Token": appToken,
    "X-GateLM-End-User-Id": "user_demo_001",
    "X-GateLM-Feature-Id": featureId,
  };
}

function getHeader(response, name) {
  const target = name.toLowerCase();
  for (const key in response.headers) {
    if (key.toLowerCase() === target) {
      return response.headers[key];
    }
  }
  return "";
}

function chatBody(prompt, selectedModel = "auto") {
  return JSON.stringify({
    model: selectedModel,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 128,
    stream: false,
  });
}

function alphaId(value) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let remaining = value;
  let output = "";

  do {
    output = alphabet[remaining % alphabet.length] + output;
    remaining = Math.floor(remaining / alphabet.length);
  } while (remaining > 0);

  return output;
}

function randomAlphaId(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let output = "";

  for (let i = 0; i < length; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return output;
}

function scenarioForIteration() {
  if (mode === "mixed") {
    const slot = Math.random();
    if (slot < 0.4) {
      return cacheHitScenario();
    }
    if (slot < 0.8) {
      return cacheMissScenario();
    }
    return blockedScenario();
  }

  if (mode === "cache-hit") {
    return cacheHitScenario();
  }
  if (mode === "blocked") {
    return blockedScenario();
  }
  return cacheMissScenario();
}

function cacheHitScenario() {
  return {
    name: "cache-hit",
    expectedStatus: 200,
    featureId: "k6-cache-hit",
    prompt: "Write a short refund response for the Day5 cache hit load baseline.",
  };
}

function cacheMissScenario() {
  const sampleId = `${alphaId(__VU)}${randomAlphaId(12)}`;

  return {
    name: "cache-miss",
    expectedStatus: 200,
    featureId: "k6-cache-miss",
    prompt: `Write a short refund response for load sample ${sampleId}.`,
  };
}

function blockedScenario() {
  return {
    name: "blocked",
    expectedStatus: 403,
    featureId: "k6-blocked",
    prompt: "Summarize this synthetic config: api_key=test_secret_token_redacted_for_demo_only_1234567890",
  };
}

export function setup() {
  if (mode === "cache-hit" || mode === "mixed") {
    const scenario = cacheHitScenario();
    http.post(
      `${baseUrl}/v1/chat/completions`,
      chatBody(scenario.prompt),
      { headers: headers("k6-cache-hit-warmup") }
    );
  }
}

export default function () {
  const scenario = scenarioForIteration();
  const response = http.post(
    `${baseUrl}/v1/chat/completions`,
    chatBody(scenario.prompt),
    { headers: headers(scenario.featureId), tags: { load_mode: scenario.name } }
  );

  const requestId = getHeader(response, "X-GateLM-Request-Id");
  const cacheStatus = getHeader(response, "X-GateLM-Cache-Status");
  const maskingAction = getHeader(response, "X-GateLM-Masking-Action");

  const expectedStatus = response.status === scenario.expectedStatus;
  const hasRequestId = requestId !== "";
  const isCacheHit = cacheStatus === "hit";
  const isCacheMiss = cacheStatus === "miss";
  const isBlocked = response.status === 403 || maskingAction === "blocked";

  expectedStatusRate.add(expectedStatus);
  requestIdRate.add(hasRequestId);
  cacheHitRate.add(isCacheHit);
  cacheMissRate.add(isCacheMiss);
  blockedRate.add(isBlocked);

  check(response, {
    "status matches scenario": () => expectedStatus,
    "request id exists": () => hasRequestId,
    "cache header exists": () => cacheStatus !== "",
    "successful requests route": () =>
      response.status !== 200 || getHeader(response, "X-GateLM-Routed-Model") !== "",
    "blocked requests are marked blocked": () =>
      scenario.expectedStatus !== 403 || maskingAction === "blocked",
  });
}
