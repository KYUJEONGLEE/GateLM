#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8080";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000100";
const DEFAULT_PROJECT_ID = "00000000-0000-4000-8000-000000000200";
const DEFAULT_API_KEY = "glm_api_test_redacted";
const DEFAULT_APP_TOKEN = "glm_app_token_test_redacted";
const REQUIRED_METRIC_FAMILIES = [
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
  "gatelm_async_log_enqueue_total",
  "gatelm_async_log_enqueue_duration_seconds",
  "gatelm_async_log_queue_depth",
  "gatelm_async_log_dropped_total",
  "gatelm_async_log_persist_total",
  "gatelm_async_log_persist_duration_seconds",
];
const PROMPT_BY_SCENARIO = {
  safe_request: "Write a short safe customer support reply for GateLM async log dashboard evidence.",
  exact_cache_seed: "Write a short safe cacheable response for GateLM async log dashboard evidence.",
  exact_cache_hit: "Write a short safe cacheable response for GateLM async log dashboard evidence.",
  redaction: "Write a support reply to synthetic.async.dashboard@example.test without exposing the address.",
  safety_block: "This synthetic request contains api_key=test_secret_token_redacted_for_demo_only_async_dashboard",
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const opts = parseArgs(process.argv.slice(2));

try {
  await main(opts);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("");
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

async function main(options) {
  if (options.help) {
    printUsage();
    return;
  }

  validateOptions(options);

  const runId = `async_log_dashboard_${timestampForId()}`;
  const runStartedAt = new Date(Date.now() - 10_000);
  const reportDir = path.resolve(repoRoot, options.reportDir);
  const requestResults = [];

  console.log("");
  console.log("GateLM async log dashboard evidence");
  console.log("===================================");
  console.log(`gateway:    ${options.gatewayBaseUrl}`);
  console.log(`tenantId:   ${options.tenantId}`);
  console.log(`projectId:  ${options.projectId}`);
  console.log(`runId:      ${runId}`);
  console.log(`traffic:    ${options.skipTraffic ? "skip" : "send synthetic requests"}`);
  console.log("");

  await assertHealth(options.gatewayBaseUrl);

  if (!options.skipTraffic) {
    for (const scenario of Object.keys(PROMPT_BY_SCENARIO)) {
      const result = await invokeGatewayChat(options, runId, scenario);
      requestResults.push(result);
      console.log(`${scenario}: HTTP ${result.httpStatus} requestId=${result.requestId}`);
    }
    await sleep(options.flushWaitMs);
  }

  const range = dashboardRange(runStartedAt, options.windowMinutes);
  const overviewUrl = dashboardOverviewUrl(options, range);
  const overview = await pollDashboardOverview(overviewUrl, {
    minRequests: options.skipTraffic ? 0 : requestResults.length,
    timeoutMs: options.dashboardWaitMs,
    intervalMs: 500,
  });
  const metricsText = await fetchText(joinUrl(options.gatewayBaseUrl, "/metrics"));
  const metricsSummary = summarizeMetrics(metricsText, !options.skipTraffic);
  const assertions = assertEvidence({
    requestResults,
    overview,
    metricsSummary,
    trafficExpected: !options.skipTraffic,
  });

  const report = {
    schemaVersion: "gatelm.async-log-dashboard-evidence.v1",
    runId,
    generatedAt: new Date().toISOString(),
    gatewayBaseUrl: options.gatewayBaseUrl,
    scope: {
      tenantId: options.tenantId,
      projectId: options.projectId,
    },
    range,
    requests: requestResults,
    dashboard: dashboardReportSummary(overview),
    metrics: metricsSummary,
    assertions,
    securityNote:
      "This report intentionally excludes raw prompt, raw response, Authorization header, API Key, App Token, Provider Key, and secret plaintext.",
  };

  await fs.mkdir(reportDir, { recursive: true });
  const timestamp = timestampForId();
  const reportPath = path.join(reportDir, `v2-async-log-dashboard-evidence-${timestamp}.json`);
  const latestPath = path.join(reportDir, "latest.json");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, serialized, "utf8");
  await fs.writeFile(latestPath, serialized, "utf8");

  console.log("");
  console.log(`report: ${path.relative(repoRoot, reportPath)}`);
  console.log(`latest: ${path.relative(repoRoot, latestPath)}`);

  const failed = assertions.filter((item) => !item.pass);
  if (failed.length > 0) {
    throw new Error(`Evidence assertions failed: ${failed.map((item) => item.name).join(", ")}`);
  }

  console.log("PASS: async log dashboard evidence succeeded");
}

function parseArgs(args) {
  const options = {
    help: false,
    gatewayBaseUrl: envOrDefault("GATEWAY_BASE_URL", DEFAULT_GATEWAY_BASE_URL),
    tenantId: envOrDefault("GATELM_E2E_TENANT_ID", DEFAULT_TENANT_ID),
    projectId: envOrDefault("GATELM_E2E_PROJECT_ID", DEFAULT_PROJECT_ID),
    apiKey: envOrDefault("GATELM_DEMO_API_KEY", DEFAULT_API_KEY),
    appToken: envOrDefault("GATELM_DEMO_APP_TOKEN", DEFAULT_APP_TOKEN),
    reportDir: envOrDefault("GATELM_ASYNC_LOG_EVIDENCE_REPORT_DIR", "reports/async-log-dashboard-evidence"),
    windowMinutes: positiveIntEnv("GATELM_ASYNC_LOG_EVIDENCE_WINDOW_MINUTES", 15),
    flushWaitMs: positiveIntEnv("GATELM_ASYNC_LOG_EVIDENCE_FLUSH_WAIT_MS", 1_000),
    dashboardWaitMs: positiveIntEnv("GATELM_ASYNC_LOG_EVIDENCE_DASHBOARD_WAIT_MS", 6_000),
    skipTraffic: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    const value = () => {
      index += 1;
      if (index >= args.length || args[index].startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      return args[index];
    };

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--gateway-base-url":
        options.gatewayBaseUrl = value();
        break;
      case "--tenant-id":
        options.tenantId = value();
        break;
      case "--project-id":
        options.projectId = value();
        break;
      case "--api-key":
        options.apiKey = value();
        break;
      case "--app-token":
        options.appToken = value();
        break;
      case "--report-dir":
        options.reportDir = value();
        break;
      case "--window-minutes":
        options.windowMinutes = positiveIntValue(value(), "--window-minutes");
        break;
      case "--flush-wait-ms":
        options.flushWaitMs = positiveIntValue(value(), "--flush-wait-ms");
        break;
      case "--dashboard-wait-ms":
        options.dashboardWaitMs = positiveIntValue(value(), "--dashboard-wait-ms");
        break;
      case "--skip-traffic":
        options.skipTraffic = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.gatewayBaseUrl = trimTrailingSlash(options.gatewayBaseUrl);
  return options;
}

function validateOptions(options) {
  assertNonEmpty(options.gatewayBaseUrl, "gateway base URL is required");
  assertNonEmpty(options.tenantId, "tenant id is required");
  assertNonEmpty(options.projectId, "project id is required");
  if (!options.skipTraffic) {
    assertNonEmpty(options.apiKey, "api key is required unless --skip-traffic is used");
    assertNonEmpty(options.appToken, "app token is required unless --skip-traffic is used");
  }
}

async function assertHealth(gatewayBaseUrl) {
  const health = await fetch(joinUrl(gatewayBaseUrl, "/healthz"));
  if (!health.ok) {
    throw new Error(`/healthz failed with HTTP ${health.status}`);
  }
}

async function invokeGatewayChat(options, runId, scenario) {
  const requestId = `request_${runId}_${scenario}`;
  const prompt = `${PROMPT_BY_SCENARIO[scenario]} Run ${runId}.`;
  const startedAt = new Date().toISOString();
  const response = await fetch(joinUrl(options.gatewayBaseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      "x-gatelm-app-token": options.appToken,
      "x-gatelm-request-id": requestId,
      "x-gatelm-end-user-id": "user_async_log_dashboard_evidence",
      "x-gatelm-feature-id": "v2_async_log_dashboard_evidence",
    },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 96,
      stream: false,
    }),
  });

  const bodyText = await response.text();
  return {
    scenario,
    requestId,
    promptFingerprint: shortHash(prompt),
    startedAt,
    completedAt: new Date().toISOString(),
    httpStatus: response.status,
    ok: response.ok,
    cacheStatus: response.headers.get("x-gatelm-cache-status") ?? "",
    maskingAction: response.headers.get("x-gatelm-masking-action") ?? "",
    routedProvider: response.headers.get("x-gatelm-routed-provider") ?? "",
    routedModel: response.headers.get("x-gatelm-routed-model") ?? "",
    contentType: response.headers.get("content-type") ?? "",
    safeErrorCode: safeErrorCode(bodyText),
  };
}

function dashboardRange(startedAt, windowMinutes) {
  const from = new Date(startedAt.getTime() - 60_000);
  const to = new Date(Date.now() + Math.max(windowMinutes, 1) * 60_000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function dashboardOverviewUrl(options, range) {
  const params = new URLSearchParams({
    tenantId: options.tenantId,
    projectId: options.projectId,
    from: range.from,
    to: range.to,
  });
  return `${joinUrl(options.gatewayBaseUrl, "/api/dashboard/overview")}?${params.toString()}`;
}

async function pollDashboardOverview(url, options) {
  const deadline = Date.now() + options.timeoutMs;
  let lastOverview = null;
  let lastError = null;

  do {
    try {
      const overview = envelopeData(await fetchJson(url));
      lastOverview = overview;
      const totalRequests = numberValue(overview?.totals?.totalRequests);
      if (totalRequests >= options.minRequests) {
        return overview;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(options.intervalMs);
  } while (Date.now() < deadline);

  if (lastOverview) {
    return lastOverview;
  }
  throw lastError ?? new Error("Dashboard overview was not available before timeout");
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${safeGatewayErrorSummary(text)}`);
  }
  return JSON.parse(text);
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${safeGatewayErrorSummary(text)}`);
  }
  return text;
}

function summarizeMetrics(metricsText, trafficExpected) {
  const families = REQUIRED_METRIC_FAMILIES.map((name) => {
    const sampleLines = metricsText
      .split(/\r?\n/)
      .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name}_bucket{`) || line.startsWith(`${name}_sum{`) || line.startsWith(`${name}_count{`) || line.startsWith(`${name} `));
    return {
      name,
      declared: metricsText.includes(`# HELP ${name} `) && metricsText.includes(`# TYPE ${name} `),
      sampleCount: sampleLines.length,
      totalSampleValue: sampleLines.reduce((sum, line) => sum + metricLineValue(line), 0),
    };
  });
  const gatewayRequestSamples = sumMetric(metricsText, "gatelm_gateway_requests_total");
  const providerRequestSamples = sumMetric(metricsText, "gatelm_provider_requests_total");
  return {
    trafficExpected,
    requiredFamilies: families,
    gatewayRequestSamples,
    gatewayFailureSamples: sumMetricMatching(metricsText, "gatelm_gateway_requests_total", (line) => /status="(failed|blocked|rate_limited|cancelled)"/.test(line) || /http_status="5\d\d"/.test(line)),
    gatewayStatusSamples: sumMetricByLabel(metricsText, "gatelm_gateway_requests_total", "status"),
    gatewayHttpStatusSamples: sumMetricByLabel(metricsText, "gatelm_gateway_requests_total", "http_status"),
    inflightRequestSamples: sumMetric(metricsText, "gatelm_gateway_inflight_requests"),
    providerRequestSamples,
    providerErrorSamples: sumMetricMatching(metricsText, "gatelm_provider_requests_total", (line) => /status="failed"/.test(line) || /http_status="5\d\d"/.test(line)),
    providerStatusSamples: sumMetricByLabel(metricsText, "gatelm_provider_requests_total", "status"),
    providerBypassEstimateSamples: Math.max(0, gatewayRequestSamples - providerRequestSamples),
    cacheOperationSamples: sumMetric(metricsText, "gatelm_cache_operations_total"),
    rateLimitDeniedSamples: sumMetric(metricsText, "gatelm_rate_limit_decisions_total", "rate_limit_allowed=\"false\""),
    maskingActionSamples: sumMetric(metricsText, "gatelm_masking_actions_total"),
    logWriteErrorSamples: sumMetricMatching(metricsText, "gatelm_log_writes_total", (line) => !/status="success"/.test(line)),
    enqueueSuccessSamples: sumMetric(metricsText, "gatelm_async_log_enqueue_total", "status=\"success\""),
    enqueueTotalSamples: sumMetric(metricsText, "gatelm_async_log_enqueue_total"),
    persistSuccessSamples: sumMetric(metricsText, "gatelm_async_log_persist_total", "status=\"success\""),
    persistTotalSamples: sumMetric(metricsText, "gatelm_async_log_persist_total"),
    dropSamples: sumMetric(metricsText, "gatelm_async_log_dropped_total"),
    queueDepthSamples: sumMetric(metricsText, "gatelm_async_log_queue_depth"),
  };
}
function assertEvidence({ requestResults, overview, metricsSummary, trafficExpected }) {
  const assertions = [];

  recordAssertion(assertions, "dashboard totals are available", Number.isFinite(numberValue(overview?.totals?.totalRequests)));
  recordAssertion(assertions, "dashboard freshness source is request log", String(overview?.freshness?.source ?? overview?.dataFreshness?.source ?? "") === "postgresql_request_log");
  recordAssertion(assertions, "dashboard freshness has last ingested timestamp", nonEmptyString(dashboardLastIngestedAt(overview)));
  recordAssertion(assertions, "dashboard exposes cache breakdown", Array.isArray(overview?.breakdowns?.byCacheOutcome));
  recordAssertion(assertions, "dashboard exposes provider/model breakdown", Array.isArray(overview?.breakdowns?.byProviderModel));
  recordAssertion(assertions, "dashboard exposes latency performance", overview?.performance && typeof overview.performance === "object");

  for (const family of metricsSummary.requiredFamilies) {
    recordAssertion(assertions, `metric family declared: ${family.name}`, family.declared);
  }

  if (trafficExpected) {
    const successCount = requestResults.filter((item) => item.httpStatus >= 200 && item.httpStatus < 300).length;
    const persistedRequests = numberValue(overview?.totals?.totalRequests);
    recordAssertion(assertions, "synthetic traffic produced at least one successful request", successCount > 0);
    recordAssertion(assertions, "dashboard counted synthetic request window", persistedRequests >= requestResults.length);
    recordAssertion(assertions, "gateway request samples exist", metricsSummary.gatewayRequestSamples >= requestResults.length);
    recordAssertion(assertions, "provider request samples exist", metricsSummary.providerRequestSamples > 0);
    recordAssertion(assertions, "cache operation samples are visible", metricsSummary.cacheOperationSamples > 0);
    recordAssertion(assertions, "masking action samples are visible", metricsSummary.maskingActionSamples > 0);
    recordAssertion(assertions, "async enqueue success samples exist", metricsSummary.enqueueSuccessSamples >= requestResults.length);
    recordAssertion(assertions, "async persist success samples exist", metricsSummary.persistSuccessSamples > 0);
  }

  return assertions;
}

function dashboardLastIngestedAt(overview) {
  return firstNonEmptyString(
    overview?.freshness?.lastIngestedAt,
    overview?.dataFreshness?.lastIngestedAt,
    overview?.dataFreshness?.lastLogCreatedAt,
    overview?.dataFreshness?.generatedAt,
    overview?.generatedAt,
  );
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (nonEmptyString(value)) {
      return value;
    }
  }
  return "";
}

function recordAssertion(assertions, name, pass) {
  assertions.push({ name, pass: Boolean(pass) });
}

function dashboardReportSummary(overview) {
  return {
    generatedAt: overview?.generatedAt ?? "",
    range: overview?.range ?? overview?.timeRange ?? {},
    freshness: overview?.freshness ?? {},
    dataFreshness: overview?.dataFreshness ?? {},
    queryBudget: overview?.queryBudget ?? {},
    totals: overview?.totals ?? {},
    performance: overview?.performance ?? {},
    breakdowns: {
      byApplication: overview?.breakdowns?.byApplication ?? [],
      byBudgetScope: overview?.breakdowns?.byBudgetScope ?? [],
      byProviderModel: overview?.breakdowns?.byProviderModel ?? [],
      bySafetyOutcome: overview?.breakdowns?.bySafetyOutcome ?? [],
      byCacheOutcome: overview?.breakdowns?.byCacheOutcome ?? [],
      byFallbackOutcome: overview?.breakdowns?.byFallbackOutcome ?? [],
      byTerminalStatus: overview?.breakdowns?.byTerminalStatus ?? [],
    },
  };
}

function envelopeData(payload) {
  return payload?.data ?? payload;
}

function safeErrorCode(text) {
  if (!text.trim()) {
    return "";
  }
  try {
    const payload = JSON.parse(text);
    return String(payload?.error?.code ?? payload?.code ?? "");
  } catch {
    return "";
  }
}

function safeGatewayErrorSummary(text) {
  if (!text.trim()) {
    return "<empty>";
  }
  try {
    const payload = JSON.parse(text);
    const code = payload?.error?.code ?? payload?.code ?? "unknown";
    const message = payload?.error?.message ?? payload?.message ?? "no message";
    return `${code}: ${message}`;
  } catch {
    return text.slice(0, 240);
  }
}

function sumMetric(metricsText, name, requiredFragment = "") {
  return metricsText
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `))
    .filter((line) => requiredFragment === "" || line.includes(requiredFragment))
    .reduce((sum, line) => sum + metricLineValue(line), 0);
}

function sumMetricMatching(metricsText, name, predicate) {
  return metricsText
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `))
    .filter(predicate)
    .reduce((sum, line) => sum + metricLineValue(line), 0);
}

function sumMetricByLabel(metricsText, name, labelName) {
  const totals = {};
  const labelPattern = new RegExp(`${labelName}="([^"]+)"`);
  for (const line of metricsText.split(/\r?\n/)) {
    if (!line.startsWith(`${name}{`) && !line.startsWith(`${name} `)) {
      continue;
    }
    const match = line.match(labelPattern);
    const value = match ? match[1] : "none";
    totals[value] = (totals[value] ?? 0) + metricLineValue(line);
  }
  return totals;
}
function metricLineValue(line) {
  const match = line.trim().match(/\s(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i);
  return match ? Number(match[1]) : 0;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function joinUrl(baseUrl, pathname) {
  return `${trimTrailingSlash(baseUrl)}/${pathname.replace(/^\/+/, "")}`;
}

function trimTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function envOrDefault(name, defaultValue) {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : defaultValue;
}

function positiveIntEnv(name, defaultValue) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    return defaultValue;
  }
  return positiveIntValue(value, name);
}

function positiveIntValue(value, name) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function assertNonEmpty(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
}

function shortHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function timestampForId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printUsage() {
  console.log(`GateLM async log dashboard evidence

Usage:
  node scripts/dev/v2-async-log-dashboard-evidence.mjs [options]

Options:
  --gateway-base-url <url>   Gateway base URL. Default: GATEWAY_BASE_URL or ${DEFAULT_GATEWAY_BASE_URL}
  --tenant-id <id>           Tenant scope. Default: GATELM_E2E_TENANT_ID or demo tenant
  --project-id <id>          Project scope. Default: GATELM_E2E_PROJECT_ID or demo project
  --api-key <key>            Demo API key. Default: GATELM_DEMO_API_KEY or redacted demo key
  --app-token <token>        Demo app token. Default: GATELM_DEMO_APP_TOKEN or redacted demo token
  --report-dir <path>        Report output dir. Default: reports/async-log-dashboard-evidence
  --window-minutes <number>  Dashboard query window after run start. Default: 15
  --flush-wait-ms <number>   Wait after traffic for async writer flush. Default: 1000
  --dashboard-wait-ms <num>  Poll dashboard until expected count or timeout. Default: 6000
  --skip-traffic             Only verify dashboard and metrics endpoints.
  --help                     Show this message.
`);
}
