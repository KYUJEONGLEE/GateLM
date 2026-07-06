#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8080";
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000100";
const DEFAULT_PROJECT_ID = "00000000-0000-4000-8000-000000000200";

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

  const range = dashboardRange(options);
  const reportDir = path.resolve(repoRoot, options.reportDir);
  const runId = `dashboard_overview_latency_${timestampForId()}`;
  const url = dashboardOverviewUrl(options, range);

  console.log("");
  console.log("GateLM dashboard overview latency evidence");
  console.log("==========================================");
  console.log(`gateway:     ${options.gatewayBaseUrl}`);
  console.log(`tenantId:    ${options.tenantId}`);
  console.log(`projectId:   ${options.projectId || "<none>"}`);
  console.log(`range:       ${range.from} -> ${range.to}`);
  console.log(`iterations:  ${options.iterations}`);
  console.log(`warmup:      ${options.warmup}`);
  console.log(`concurrency: ${options.concurrency}`);
  console.log(`runId:       ${runId}`);
  console.log("");

  await runWarmup(url, options);
  const samples = await runMeasuredIterations(url, options);
  const summary = summarizeSamples(samples);
  const dashboard = latestDashboardSummary(samples);
  const assertions = [
    { name: "all measured calls completed", pass: samples.length === options.iterations },
    { name: "at least one successful response", pass: summary.successfulResponses > 0 },
    { name: "p95 latency is available", pass: Number.isFinite(summary.durationMs.p95) },
  ];

  const report = {
    schemaVersion: "gatelm.dashboard-overview-latency-evidence.v1",
    runId,
    generatedAt: new Date().toISOString(),
    scope: {
      gatewayBaseUrl: options.gatewayBaseUrl,
      tenantId: options.tenantId,
      projectId: options.projectId || null,
      range,
    },
    options: {
      iterations: options.iterations,
      warmup: options.warmup,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
    },
    summary,
    dashboard,
    samples,
    assertions,
    securityNote:
      "This report intentionally excludes raw prompt, raw response, Authorization header, API Key, App Token, Provider Key, and secret plaintext.",
  };

  await fs.mkdir(reportDir, { recursive: true });
  const timestamp = timestampForId();
  const reportPath = path.join(reportDir, `v2-dashboard-overview-latency-evidence-${timestamp}.json`);
  const latestPath = path.join(reportDir, "latest.json");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, serialized, "utf8");
  await fs.writeFile(latestPath, serialized, "utf8");

  printSummary(summary, dashboard);
  console.log("");
  console.log(`report: ${path.relative(repoRoot, reportPath)}`);
  console.log(`latest: ${path.relative(repoRoot, latestPath)}`);

  const failed = assertions.filter((item) => !item.pass);
  if (failed.length > 0) {
    throw new Error(`Dashboard latency assertions failed: ${failed.map((item) => item.name).join(", ")}`);
  }
}

async function runWarmup(url, options) {
  for (let index = 0; index < options.warmup; index += 1) {
    await fetchDashboardOverview(url, options.timeoutMs, `warmup-${index + 1}`);
  }
}

async function runMeasuredIterations(url, options) {
  const samples = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < options.iterations) {
      const sampleIndex = nextIndex;
      nextIndex += 1;
      samples[sampleIndex] = await fetchDashboardOverview(url, options.timeoutMs, `sample-${sampleIndex + 1}`);
      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  }

  const workers = Array.from({ length: options.concurrency }, () => worker());
  await Promise.all(workers);
  return samples;
}

async function fetchDashboardOverview(url, timeoutMs, sampleId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let status = 0;
  let ok = false;
  let payloadSizeBytes = 0;
  let safeErrorCode = "";
  let dashboard = null;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-GateLM-Request-Id": `request_dashboard_latency_${sampleId}`,
      },
      signal: controller.signal,
    });
    status = response.status;
    ok = response.ok;
    const text = await response.text();
    payloadSizeBytes = Buffer.byteLength(text, "utf8");
    if (response.ok) {
      dashboard = dashboardSummary(JSON.parse(text));
    } else {
      safeErrorCode = safeGatewayErrorCode(text);
    }
  } catch (error) {
    safeErrorCode = error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed";
  } finally {
    clearTimeout(timeout);
  }

  return {
    sampleId,
    durationMs: round(performance.now() - started),
    httpStatus: status,
    ok,
    payloadSizeBytes,
    safeErrorCode,
    dashboard,
  };
}

function dashboardSummary(payload) {
  const data = payload?.data ?? payload ?? {};
  const totals = data.totals ?? {};
  return {
    totalRequests: numberOrNull(totals.totalRequests ?? totals.requestCount),
    successfulRequests: numberOrNull(totals.successfulRequests ?? totals.successCount),
    failedRequests: numberOrNull(totals.failedRequests ?? totals.failedCount),
    cacheHitRequests: numberOrNull(totals.cacheHitRequests),
    totalCostMicroUsd: numberOrNull(totals.totalCostMicroUsd),
    freshnessSource: stringOrNull(data.freshness?.source ?? data.dataFreshness?.source),
    queryBudgetStatus: stringOrNull(data.queryBudget?.status),
    p95GatewayInternalLatencyMs: numberOrNull(data.performance?.p95GatewayInternalLatencyMs),
    p95ProviderLatencyMs: numberOrNull(data.performance?.p95ProviderLatencyMs),
  };
}

function summarizeSamples(samples) {
  const durations = samples.map((sample) => sample.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
  const successfulResponses = samples.filter((sample) => sample.ok).length;
  const failedResponses = samples.length - successfulResponses;
  return {
    sampleCount: samples.length,
    successfulResponses,
    failedResponses,
    successRate: samples.length > 0 ? round(successfulResponses / samples.length, 6) : 0,
    durationMs: {
      min: percentile(durations, 0),
      avg: average(durations),
      p50: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: percentile(durations, 1),
    },
    httpStatusCounts: countBy(samples.map((sample) => String(sample.httpStatus))),
    safeErrorCodeCounts: countBy(samples.map((sample) => sample.safeErrorCode).filter(Boolean)),
    payloadSizeBytes: {
      min: percentile(samples.map((sample) => sample.payloadSizeBytes).sort((a, b) => a - b), 0),
      avg: average(samples.map((sample) => sample.payloadSizeBytes)),
      max: percentile(samples.map((sample) => sample.payloadSizeBytes).sort((a, b) => a - b), 1),
    },
  };
}

function latestDashboardSummary(samples) {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index]?.dashboard) {
      return samples[index].dashboard;
    }
  }
  return null;
}

function dashboardOverviewUrl(options, range) {
  const params = new URLSearchParams({
    tenantId: options.tenantId,
    from: range.from,
    to: range.to,
  });
  appendOptionalQuery(params, "projectId", options.projectId);
  appendOptionalQuery(params, "budgetScopeId", options.budgetScopeId);
  appendOptionalQuery(params, "budgetScopeType", options.budgetScopeType);
  appendOptionalQuery(params, "resolvedBy", options.resolvedBy);
  return `${options.gatewayBaseUrl}/api/dashboard/overview?${params.toString()}`;
}

function dashboardRange(options) {
  if (options.from && options.to) {
    return { from: new Date(options.from).toISOString(), to: new Date(options.to).toISOString() };
  }
  const to = new Date();
  const from = new Date(to.getTime() - options.rangeMinutes * 60_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function parseArgs(args) {
  const options = {
    help: false,
    gatewayBaseUrl: envOrDefault("GATEWAY_BASE_URL", DEFAULT_GATEWAY_BASE_URL),
    tenantId: envOrDefault("GATELM_E2E_TENANT_ID", DEFAULT_TENANT_ID),
    projectId: envOrDefault("GATELM_E2E_PROJECT_ID", DEFAULT_PROJECT_ID),
    budgetScopeId: "",
    budgetScopeType: "",
    resolvedBy: "",
    from: "",
    to: "",
    rangeMinutes: positiveIntEnv("GATELM_DASHBOARD_LATENCY_RANGE_MINUTES", 15),
    iterations: positiveIntEnv("GATELM_DASHBOARD_LATENCY_ITERATIONS", 30),
    warmup: nonNegativeIntEnv("GATELM_DASHBOARD_LATENCY_WARMUP", 3),
    concurrency: positiveIntEnv("GATELM_DASHBOARD_LATENCY_CONCURRENCY", 1),
    delayMs: nonNegativeIntEnv("GATELM_DASHBOARD_LATENCY_DELAY_MS", 100),
    timeoutMs: positiveIntEnv("GATELM_DASHBOARD_LATENCY_TIMEOUT_MS", 10_000),
    reportDir: envOrDefault("GATELM_DASHBOARD_LATENCY_REPORT_DIR", "reports/dashboard-overview-latency-evidence"),
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
      case "--no-project":
        options.projectId = "";
        break;
      case "--budget-scope-id":
        options.budgetScopeId = value();
        break;
      case "--budget-scope-type":
        options.budgetScopeType = value();
        break;
      case "--resolved-by":
        options.resolvedBy = value();
        break;
      case "--from":
        options.from = value();
        break;
      case "--to":
        options.to = value();
        break;
      case "--range-minutes":
        options.rangeMinutes = positiveIntValue(value(), "--range-minutes");
        break;
      case "--iterations":
        options.iterations = positiveIntValue(value(), "--iterations");
        break;
      case "--warmup":
        options.warmup = nonNegativeIntValue(value(), "--warmup");
        break;
      case "--concurrency":
        options.concurrency = positiveIntValue(value(), "--concurrency");
        break;
      case "--delay-ms":
        options.delayMs = nonNegativeIntValue(value(), "--delay-ms");
        break;
      case "--timeout-ms":
        options.timeoutMs = positiveIntValue(value(), "--timeout-ms");
        break;
      case "--report-dir":
        options.reportDir = value();
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
  if (Boolean(options.from) !== Boolean(options.to)) {
    throw new Error("--from and --to must be provided together");
  }
  if (options.from && Number.isNaN(new Date(options.from).getTime())) {
    throw new Error("--from must be a valid date");
  }
  if (options.to && Number.isNaN(new Date(options.to).getTime())) {
    throw new Error("--to must be a valid date");
  }
}

function appendOptionalQuery(params, key, value) {
  if (value && String(value).trim() !== "") {
    params.set(key, String(value).trim());
  }
}

function safeGatewayErrorCode(text) {
  if (!text.trim()) {
    return "empty_error_body";
  }
  try {
    const payload = JSON.parse(text);
    return String(payload?.error?.code ?? payload?.code ?? "unknown_error");
  } catch {
    return "non_json_error_body";
  }
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return null;
  }
  if (p <= 0) {
    return round(sortedValues[0]);
  }
  if (p >= 1) {
    return round(sortedValues[sortedValues.length - 1]);
  }
  const index = Math.ceil(sortedValues.length * p) - 1;
  return round(sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))]);
}

function average(values) {
  if (values.length === 0) {
    return null;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function printSummary(summary, dashboard) {
  console.log("summary:");
  console.log(`  success: ${summary.successfulResponses}/${summary.sampleCount} (${(summary.successRate * 100).toFixed(1)}%)`);
  console.log(`  duration ms: avg=${summary.durationMs.avg} p50=${summary.durationMs.p50} p90=${summary.durationMs.p90} p95=${summary.durationMs.p95} p99=${summary.durationMs.p99} max=${summary.durationMs.max}`);
  console.log(`  http status: ${JSON.stringify(summary.httpStatusCounts)}`);
  if (dashboard) {
    console.log(`  dashboard totalRequests: ${dashboard.totalRequests}`);
    console.log(`  dashboard freshness source: ${dashboard.freshnessSource ?? "unknown"}`);
    console.log(`  dashboard queryBudget: ${dashboard.queryBudgetStatus ?? "unknown"}`);
  }
}

function envOrDefault(name, fallback) {
  const value = process.env[name];
  return value == null || value.trim() === "" ? fallback : value.trim();
}

function positiveIntEnv(name, fallback) {
  const value = process.env[name];
  return value == null || value.trim() === "" ? fallback : positiveIntValue(value, name);
}

function nonNegativeIntEnv(name, fallback) {
  const value = process.env[name];
  return value == null || value.trim() === "" ? fallback : nonNegativeIntValue(value, name);
}

function positiveIntValue(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeIntValue(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function assertNonEmpty(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
}

function trimTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function timestampForId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function printUsage() {
  console.log(`GateLM dashboard overview latency evidence

Usage:
  node scripts/dev/v2-dashboard-overview-latency-evidence.mjs [options]

Options:
  --gateway-base-url <url>    Gateway base URL. Default: ${DEFAULT_GATEWAY_BASE_URL}
  --tenant-id <id>            Tenant scope. Default: demo tenant
  --project-id <id>           Project scope. Default: demo project
  --no-project                Query tenant scope without projectId
  --from <iso>                Fixed query range start. Must be used with --to
  --to <iso>                  Fixed query range end. Must be used with --from
  --range-minutes <number>    Rolling range when --from/--to are omitted. Default: 15
  --iterations <number>       Measured request count. Default: 30
  --warmup <number>           Warmup request count. Default: 3
  --concurrency <number>      Parallel measured requests. Default: 1
  --delay-ms <number>         Delay after each measured request per worker. Default: 100
  --timeout-ms <number>       Per-request timeout. Default: 10000
  --report-dir <path>         Report output dir. Default: reports/dashboard-overview-latency-evidence
  --help                      Show this message
`);
}
