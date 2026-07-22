import http from "k6/http";
import { check, fail } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

const PRODUCTION_BASE_URL = "https://gatelm.co.kr";
const PRODUCTION_ACK = "krafton_three_project_budget_demo";

const gatewayBaseUrl = normalizeBaseUrl(
  __ENV.GATELM_GATEWAY_BASE_URL || PRODUCTION_BASE_URL,
);
const duration = durationEnv("GATELM_DEMO_DURATION", "5m");
const expectAskLakeRateLimit = booleanEnv(
  "GATELM_EXPECT_ASK_LAKE_RATE_LIMIT",
  false,
);
const askLakeRampStartSeconds = nonNegativeNumberEnv(
  "GATELM_ASK_LAKE_RAMP_START_SECONDS",
  5,
);
const askLakeRampEndSeconds = nonNegativeNumberEnv(
  "GATELM_ASK_LAKE_RAMP_END_SECONDS",
  10,
);

const projects = {
  ask_lake: projectConfig({
    displayName: "Ask Lake",
    apiKeyEnv: "GATELM_ASK_LAKE_API_KEY",
    rateEnv: "GATELM_ASK_LAKE_RPS",
    defaultRate: 140,
    modelEnv: "GATELM_ASK_LAKE_MODEL",
    defaultModel: "mock-balanced",
  }),
  gatelm: projectConfig({
    displayName: "GateLM",
    apiKeyEnv: "GATELM_GATE_API_KEY",
    rateEnv: "GATELM_GATE_RPS",
    defaultRate: 25,
    modelEnv: "GATELM_GATE_MODEL",
    defaultModel: "mock-balanced",
  }),
  sketch_catch: projectConfig({
    displayName: "Sketch Catch",
    apiKeyEnv: "GATELM_SKETCH_CATCH_API_KEY",
    rateEnv: "GATELM_SKETCH_CATCH_RPS",
    defaultRate: 15,
    modelEnv: "GATELM_SKETCH_CATCH_MODEL",
    defaultModel: "mock-balanced",
  }),
};

const totalRps = Object.values(projects).reduce(
  (sum, project) => sum + project.rate,
  0,
);
validateProductionTarget();
if (totalRps < 150 || totalRps > 200) {
  throw new Error(
    `The combined project rate must stay between 150 and 200 RPS; received ${totalRps}.`,
  );
}
if (askLakeRampEndSeconds <= askLakeRampStartSeconds) {
  throw new Error(
    "GATELM_ASK_LAKE_RAMP_END_SECONDS must be greater than GATELM_ASK_LAKE_RAMP_START_SECONDS.",
  );
}

const projectMetrics = Object.fromEntries(
  Object.keys(projects).map((projectKey) => [
    projectKey,
    {
      attempts: new Counter(`project_${projectKey}_attempts`),
      success: new Rate(`project_${projectKey}_success`),
      rateLimited: new Counter(`project_${projectKey}_rate_limited`),
      duration: new Trend(`project_${projectKey}_duration_ms`, true),
    },
  ]),
);
const cacheHitEvents = new Counter("demo_cache_hit_events");
const maskingRedactedEvents = new Counter("demo_masking_redacted_events");
const specialEventFailures = new Counter("demo_special_event_failures");

export const options = {
  scenarios: {
    combined_traffic: scenario(totalRps, "combinedTraffic"),
  },
  thresholds: buildThresholds(),
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  const runNonce = alphabeticNonce(Date.now() * 1000 + 1);
  const runId = `krafton_demo_${Date.now().toString(36)}`;
  const cachePrompts = {};

  for (const [projectKey, project] of Object.entries(projects)) {
    const cachePrompt = `Summarize teamwork for the demonstration. Cache variant ${runNonce} ${project.displayName}.`;
    cachePrompts[projectKey] = cachePrompt;
    const response = sendCompletion(
      projectKey,
      project,
      runId,
      0,
      cachePrompt,
      "cache_warmup",
    );
    const metadata = safeJson(response.body).gate_lm || {};
    const cacheStatus = headerValue(response, "X-GateLM-Cache-Status");

    if (
      response.status !== 200 ||
      metadata.providerCalled !== true ||
      !matchesModelRef(metadata.modelRef, project.model) ||
      cacheStatus === "hit"
    ) {
      const error = safeJson(response.body).error || {};
      fail(
        `${project.displayName} Mock preflight failed: HTTP ${response.status}, ` +
          `code=${error.code || "unknown"}, message=${error.message || "unknown"}, ` +
          `providerCalled=${metadata.providerCalled === true}, ` +
          `modelMatched=${matchesModelRef(metadata.modelRef, project.model)}, ` +
          `cacheStatus=${cacheStatus || "unknown"}. Load was blocked.`,
      );
    }

    const cacheHitResponse = sendCompletion(
      projectKey,
      project,
      runId,
      1,
      cachePrompt,
      "cache_preflight_hit",
    );
    const cacheHitMetadata = safeJson(cacheHitResponse.body).gate_lm || {};
    const cacheHitStatus = headerValue(
      cacheHitResponse,
      "X-GateLM-Cache-Status",
    );
    if (
      cacheHitResponse.status !== 200 ||
      cacheHitMetadata.providerCalled === true ||
      cacheHitStatus !== "hit"
    ) {
      fail(
        `${project.displayName} cache preflight failed: HTTP ${cacheHitResponse.status}, ` +
          `providerCalled=${cacheHitMetadata.providerCalled === true}, ` +
          `cacheStatus=${cacheHitStatus || "unknown"}. Load was blocked.`,
      );
    }
  }

  return { cachePrompts, runId, trafficStartedAtMs: Date.now() };
}

export function combinedTraffic(data) {
  const iteration = exec.scenario.iterationInTest;
  const elapsedSeconds = Math.max(0, (Date.now() - data.trafficStartedAtMs) / 1000);
  const projectKey = selectProjectForElapsed(iteration, elapsedSeconds);
  runProjectRequest(projectKey, projects[projectKey], data, iteration);
}

export function handleSummary(data) {
  const lines = [
    "",
    "GateLM Krafton three-project budget demo",
    `  target: ${gatewayBaseUrl}`,
    `  duration: ${duration}`,
    `  combined target rate: ${totalRps} RPS`,
    `  Ask Lake: ${projects.ask_lake.rate} RPS / ${projects.ask_lake.model}`,
    `  GateLM: ${projects.gatelm.rate} RPS / ${projects.gatelm.model}`,
    `  Sketch Catch: ${projects.sketch_catch.rate} RPS / ${projects.sketch_catch.model}`,
    `  project mix: balanced until ${askLakeRampStartSeconds}s, Ask Lake ramp until ${askLakeRampEndSeconds}s`,
    `  Ask Lake requests: ${metricValue(data, "project_ask_lake_attempts", "count")}`,
    `  GateLM requests: ${metricValue(data, "project_gatelm_attempts", "count")}`,
    `  Sketch Catch requests: ${metricValue(data, "project_sketch_catch_attempts", "count")}`,
    `  completed iterations: ${metricValue(data, "iterations", "count")}`,
    `  dropped iterations: ${metricValue(data, "dropped_iterations", "count")}`,
    `  cache-hit demo events: ${metricValue(data, "demo_cache_hit_events", "count")}`,
    `  masking demo events: ${metricValue(data, "demo_masking_redacted_events", "count")}`,
    `  special-event failures: ${metricValue(data, "demo_special_event_failures", "count")}`,
    `  Ask Lake 429 responses: ${metricValue(data, "project_ask_lake_rate_limited", "count")}`,
    "",
  ];
  return { stdout: lines.join("\n") };
}

function runProjectRequest(projectKey, project, data, iteration) {
  const eventKind = eventKindForIteration(iteration);
  const prompt = promptForEvent(eventKind, projectKey, data, iteration);
  const response = sendCompletion(
    projectKey,
    project,
    data.runId,
    iteration,
    prompt,
    eventKind,
  );
  const metrics = projectMetrics[projectKey];
  const rateLimited = response.status === 429;
  const accepted =
    response.status === 200 ||
    (projectKey === "ask_lake" && expectAskLakeRateLimit && rateLimited);

  metrics.attempts.add(1);
  metrics.success.add(accepted);
  metrics.duration.add(response.timings.duration);
  if (rateLimited) {
    metrics.rateLimited.add(1);
  }

  if (response.status === 200 && eventKind === "cache_hit") {
    const cacheStatus = headerValue(response, "X-GateLM-Cache-Status");
    if (cacheStatus === "hit") {
      cacheHitEvents.add(1);
    } else {
      specialEventFailures.add(1);
    }
  }

  if (response.status === 200 && eventKind === "masking") {
    const metadata = safeJson(response.body).gate_lm || {};
    if (metadata.maskingAction === "redacted") {
      maskingRedactedEvents.add(1);
    } else {
      specialEventFailures.add(1);
    }
  }

  check(response, {
    [`${project.displayName} returns expected status`]: () => accepted,
  });
}

function sendCompletion(
  projectKey,
  project,
  runId,
  iteration,
  prompt,
  eventKind,
) {
  const uniquePart = `${runId}_${projectKey}_${__VU}_${iteration}_${Date.now()}`;
  const cacheNonce = alphabeticNonce(
    Date.now() * 1000 + __VU * 100 + iteration + 1,
  );
  return http.post(
    `${gatewayBaseUrl}/v1/chat/completions`,
    JSON.stringify({
      model: project.model,
      messages: [
        {
          role: "user",
          content:
            prompt ||
            `Write a brief demo response about teamwork. Variant ${cacheNonce}.`,
        },
      ],
      temperature: 0,
      max_tokens: 16,
      stream: false,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${project.apiKey}`,
        "X-GateLM-Request-Id": `request_${uniquePart}`,
      },
      tags: {
        name: "POST /v1/chat/completions",
        project: projectKey,
        model: project.model,
        event_kind: eventKind || "normal",
      },
    },
  );
}

function eventKindForIteration(iteration) {
  const secondIndex = Math.floor(iteration / totalRps);
  const slotInSecond = iteration % totalRps;
  const specialCount = 1 + (secondIndex % 4);

  for (let index = 0; index < specialCount; index += 1) {
    const specialSlot = Math.floor(((index + 1) * totalRps) / (specialCount + 1));
    if (slotInSecond === specialSlot) {
      return (secondIndex + index) % 2 === 0 ? "cache_hit" : "masking";
    }
  }

  return "normal";
}

function promptForEvent(eventKind, projectKey, data, iteration) {
  if (eventKind === "cache_hit") {
    return data.cachePrompts[projectKey];
  }

  const nonce = alphabeticNonce(Date.now() * 1000 + iteration + 1);
  if (eventKind === "masking") {
    return (
      "Write a support note to demo.contact@example.com and ask them to call " +
      `010-0000-1234. Reference ${nonce}.`
    );
  }

  return `Write a brief demo response about teamwork. Variant ${nonce}.`;
}

function alphabeticNonce(value) {
  let current = Math.max(1, Number(value) || 1);
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(97 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function scenario(rate, exec) {
  return {
    executor: "constant-arrival-rate",
    exec,
    rate,
    timeUnit: "1s",
    duration,
    preAllocatedVUs: Math.max(20, rate * 2),
    maxVUs: Math.max(40, rate * 3),
    gracefulStop: "10s",
  };
}

function selectProjectForElapsed(iteration, elapsedSeconds) {
  const secondIndex = Math.floor(elapsedSeconds);
  const progress = clamp(
    (secondIndex - askLakeRampStartSeconds) /
      (askLakeRampEndSeconds - askLakeRampStartSeconds),
    0,
    1,
  );
  const initialWeight = totalRps / Object.keys(projects).length;
  const shuffledSlot = shuffledSlotForSecond(
    iteration % totalRps,
    secondIndex,
  );
  let cumulativeWeight = 0;

  for (const [projectKey, project] of Object.entries(projects)) {
    cumulativeWeight += initialWeight + (project.rate - initialWeight) * progress;
    if (shuffledSlot < cumulativeWeight) {
      return projectKey;
    }
  }

  return "sketch_catch";
}

function shuffledSlotForSecond(slot, secondIndex) {
  // Keep the full-second quota exact while rotating the order. These offsets
  // also leave Ask Lake dominant in the final nine slots shown by the live log.
  const presentationOffsets = [
    0, 17, 34, 51, 68, 85, 102, 119, 136, 151, 167,
  ];
  const multiplier = 17;
  const offset = presentationOffsets[secondIndex % presentationOffsets.length];
  return (slot * multiplier + offset) % totalRps;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildThresholds() {
  const thresholds = {
    checks: ["rate==1"],
    dropped_iterations: ["count==0"],
    project_gatelm_success: ["rate==1"],
    project_sketch_catch_success: ["rate==1"],
  };

  if (expectAskLakeRateLimit) {
    thresholds.project_ask_lake_success = ["rate==1"];
    thresholds.project_ask_lake_rate_limited = ["count>0"];
  } else {
    thresholds.project_ask_lake_success = ["rate==1"];
    thresholds.http_req_failed = ["rate==0"];
  }
  return thresholds;
}

function projectConfig({
  displayName,
  apiKeyEnv,
  rateEnv,
  defaultRate,
  modelEnv,
  defaultModel,
}) {
  return {
    displayName,
    apiKey: requiredEnv(apiKeyEnv),
    rate: positiveIntEnv(rateEnv, defaultRate),
    model: safeModelEnv(modelEnv, defaultModel),
  };
}

function validateProductionTarget() {
  if (gatewayBaseUrl !== PRODUCTION_BASE_URL) {
    throw new Error(`This demo script only allows ${PRODUCTION_BASE_URL}.`);
  }
  if (String(__ENV.GATELM_PRODUCTION_DEMO_ACK || "").trim() !== PRODUCTION_ACK) {
    throw new Error(
      `Set GATELM_PRODUCTION_DEMO_ACK=${PRODUCTION_ACK} to acknowledge the production load target.`,
    );
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
  const value = Number(String(__ENV[name] || fallback).trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeNumberEnv(name, fallback) {
  const value = Number(String(__ENV[name] ?? fallback).trim());
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return value;
}

function durationEnv(name, fallback) {
  const value = String(__ENV[name] || fallback).trim();
  if (!/^[1-9][0-9]*(ms|s|m|h)$/.test(value)) {
    throw new Error(`${name} must be a positive k6 duration such as 30s or 5m.`);
  }
  return value;
}

function safeModelEnv(name, fallback) {
  const value = String(__ENV[name] || fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)) {
    throw new Error(`${name} contains an invalid model identifier.`);
  }
  return value;
}

function booleanEnv(name, fallback) {
  const value = String(__ENV[name] ?? fallback).trim().toLowerCase();
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false.`);
  }
  return value === "true";
}

function normalizeBaseUrl(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function safeJson(body) {
  try {
    return JSON.parse(body || "{}");
  } catch (_) {
    return {};
  }
}

function matchesModelRef(modelRef, expectedModel) {
  if (typeof modelRef !== "string") {
    return false;
  }
  return modelRef === expectedModel || modelRef.endsWith(`:${expectedModel}`);
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

function metricValue(data, metricName, valueName) {
  const value = data.metrics?.[metricName]?.values?.[valueName];
  return Number.isFinite(value) ? value : 0;
}
