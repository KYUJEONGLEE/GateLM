#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8080";
const DEFAULT_PROMETHEUS_BASE_URL = "http://localhost:9090";
const DEFAULT_GRAFANA_BASE_URL = "http://localhost:3005";
const DEFAULT_API_KEY = "glm_api_test_redacted";
const DEFAULT_APP_TOKEN = "glm_app_token_test_redacted";
const DEFAULT_GRAFANA_USER = "admin";
const DEFAULT_GRAFANA_PASSWORD = "admin";
const REQUIRED_PROMETHEUS_QUERIES = [
  { name: "gateway target up", query: 'up{job="gatelm-gateway"}', requireSamples: true },
  { name: "gateway requests", query: "sum(gatelm_gateway_requests_total)", requireSamples: true },
  { name: "gateway latency count", query: "sum(gatelm_gateway_request_duration_seconds_count)", requireSamples: true },
  { name: "provider requests", query: "sum(gatelm_provider_requests_total)", requireSamples: true },
  { name: "log writes", query: "sum(gatelm_log_writes_total)", requireSamples: true },
  { name: "async enqueue", query: "sum(gatelm_async_log_enqueue_total)", requireSamples: true },
  { name: "async persist", query: "sum(gatelm_async_log_persist_total)", requireSamples: true },
  { name: "async queue depth", query: "sum(gatelm_async_log_queue_depth)", requireSamples: false },
];

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

  const runId = `observability_stack_${timestampForId()}`;
  const reportDir = path.resolve(repoRoot, options.reportDir);
  const assertions = [];
  const requestResults = [];

  console.log("");
  console.log("GateLM observability stack evidence");
  console.log("===================================");
  console.log(`gateway:    ${options.gatewayBaseUrl}`);
  console.log(`prometheus: ${options.prometheusBaseUrl}`);
  console.log(`grafana:    ${options.grafanaBaseUrl}`);
  console.log(`runId:      ${runId}`);
  console.log(`traffic:    ${options.skipTraffic ? "skip" : "send synthetic request"}`);
  console.log("");

  const gatewayHealth = await fetchText(joinUrl(options.gatewayBaseUrl, "/healthz"));
  recordAssertion(assertions, "gateway health endpoint is reachable", gatewayHealth.length > 0);

  if (!options.skipTraffic) {
    const result = await invokeGatewayChat(options, runId);
    requestResults.push(result);
    recordAssertion(assertions, "synthetic Gateway request succeeded", result.httpStatus >= 200 && result.httpStatus < 300);
    console.log(`gateway request: HTTP ${result.httpStatus} requestId=${result.requestId}`);
  }

  await sleep(options.scrapeWaitMs);

  const prometheusHealth = await fetchText(joinUrl(options.prometheusBaseUrl, "/-/healthy"));
  recordAssertion(assertions, "prometheus health endpoint is reachable", prometheusHealth.toLowerCase().includes("prometheus"));

  const targets = await fetchJson(joinUrl(options.prometheusBaseUrl, "/api/v1/targets?state=active"));
  const gatewayTarget = findGatewayTarget(targets);
  recordAssertion(assertions, "prometheus has gatelm-gateway target", Boolean(gatewayTarget));
  recordAssertion(assertions, "prometheus gatelm-gateway target is up", gatewayTarget?.health === "up");

  const queryResults = [];
  for (const querySpec of REQUIRED_PROMETHEUS_QUERIES) {
    const queryResult = await prometheusQuery(options.prometheusBaseUrl, querySpec.query);
    const sampleCount = queryResult.data?.result?.length ?? 0;
    const numericValue = prometheusNumericValue(queryResult);
    queryResults.push({ ...querySpec, sampleCount, value: numericValue });
    recordAssertion(
      assertions,
      `prometheus query has samples: ${querySpec.name}`,
      querySpec.requireSamples ? sampleCount > 0 && numericValue >= 0 : sampleCount >= 0,
    );
  }

  const grafanaHealth = await fetchJson(joinUrl(options.grafanaBaseUrl, "/api/health"));
  recordAssertion(assertions, "grafana health endpoint is reachable", grafanaHealth.database === "ok");

  const grafanaHeaders = grafanaAuthHeaders(options);
  const datasource = await fetchJson(joinUrl(options.grafanaBaseUrl, "/api/datasources/uid/gatelm-prometheus"), { headers: grafanaHeaders });
  recordAssertion(assertions, "grafana prometheus datasource is provisioned", datasource.uid === "gatelm-prometheus" && datasource.type === "prometheus");

  const dashboard = await fetchJson(joinUrl(options.grafanaBaseUrl, "/api/dashboards/uid/gatelm-gateway-overview"), { headers: grafanaHeaders });
  recordAssertion(assertions, "grafana gateway dashboard is provisioned", dashboard.dashboard?.uid === "gatelm-gateway-overview");
  recordAssertion(assertions, "grafana dashboard has panels", Array.isArray(dashboard.dashboard?.panels) && dashboard.dashboard.panels.length >= 10);

  const report = {
    schemaVersion: "gatelm.observability-stack-evidence.v1",
    runId,
    generatedAt: new Date().toISOString(),
    scope: {
      gatewayBaseUrl: options.gatewayBaseUrl,
      prometheusBaseUrl: options.prometheusBaseUrl,
      grafanaBaseUrl: options.grafanaBaseUrl,
    },
    requests: requestResults,
    prometheus: {
      target: gatewayTarget ? {
        scrapeUrl: gatewayTarget.scrapeUrl,
        health: gatewayTarget.health,
        lastScrape: gatewayTarget.lastScrape,
        lastError: gatewayTarget.lastError,
      } : null,
      queries: queryResults,
    },
    grafana: {
      health: grafanaHealth,
      datasource: datasourceSummary(datasource),
      dashboard: dashboardSummary(dashboard),
    },
    assertions,
    securityNote:
      "This report intentionally excludes raw prompt, raw response, Authorization header, API Key, App Token, Provider Key, and secret plaintext.",
  };

  await fs.mkdir(reportDir, { recursive: true });
  const timestamp = timestampForId();
  const reportPath = path.join(reportDir, `v2-observability-stack-evidence-${timestamp}.json`);
  const latestPath = path.join(reportDir, "latest.json");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(reportPath, serialized, "utf8");
  await fs.writeFile(latestPath, serialized, "utf8");

  console.log("");
  console.log(`report: ${path.relative(repoRoot, reportPath)}`);
  console.log(`latest: ${path.relative(repoRoot, latestPath)}`);

  const failed = assertions.filter((item) => !item.pass);
  if (failed.length > 0) {
    throw new Error(`Observability stack assertions failed: ${failed.map((item) => item.name).join(", ")}`);
  }

  console.log("PASS: observability stack evidence succeeded");
}

function parseArgs(args) {
  const options = {
    help: false,
    gatewayBaseUrl: envOrDefault("GATEWAY_BASE_URL", DEFAULT_GATEWAY_BASE_URL),
    prometheusBaseUrl: envOrDefault("PROMETHEUS_BASE_URL", DEFAULT_PROMETHEUS_BASE_URL),
    grafanaBaseUrl: envOrDefault("GRAFANA_BASE_URL", DEFAULT_GRAFANA_BASE_URL),
    apiKey: envOrDefault("GATELM_DEMO_API_KEY", DEFAULT_API_KEY),
    appToken: envOrDefault("GATELM_DEMO_APP_TOKEN", DEFAULT_APP_TOKEN),
    grafanaUser: envOrDefault("GRAFANA_ADMIN_USER", DEFAULT_GRAFANA_USER),
    grafanaPassword: envOrDefault("GRAFANA_ADMIN_PASSWORD", DEFAULT_GRAFANA_PASSWORD),
    reportDir: envOrDefault("GATELM_OBSERVABILITY_EVIDENCE_REPORT_DIR", "reports/observability-stack-evidence"),
    scrapeWaitMs: positiveIntEnv("GATELM_OBSERVABILITY_EVIDENCE_SCRAPE_WAIT_MS", 10_000),
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
      case "--prometheus-base-url":
        options.prometheusBaseUrl = value();
        break;
      case "--grafana-base-url":
        options.grafanaBaseUrl = value();
        break;
      case "--api-key":
        options.apiKey = value();
        break;
      case "--app-token":
        options.appToken = value();
        break;
      case "--grafana-user":
        options.grafanaUser = value();
        break;
      case "--grafana-password":
        options.grafanaPassword = value();
        break;
      case "--report-dir":
        options.reportDir = value();
        break;
      case "--scrape-wait-ms":
        options.scrapeWaitMs = positiveIntValue(value(), "--scrape-wait-ms");
        break;
      case "--skip-traffic":
        options.skipTraffic = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.gatewayBaseUrl = trimTrailingSlash(options.gatewayBaseUrl);
  options.prometheusBaseUrl = trimTrailingSlash(options.prometheusBaseUrl);
  options.grafanaBaseUrl = trimTrailingSlash(options.grafanaBaseUrl);
  return options;
}

function validateOptions(options) {
  assertNonEmpty(options.gatewayBaseUrl, "gateway base URL is required");
  assertNonEmpty(options.prometheusBaseUrl, "prometheus base URL is required");
  assertNonEmpty(options.grafanaBaseUrl, "grafana base URL is required");
  assertNonEmpty(options.grafanaUser, "grafana user is required");
  assertNonEmpty(options.grafanaPassword, "grafana password is required");
  if (!options.skipTraffic) {
    assertNonEmpty(options.apiKey, "api key is required unless --skip-traffic is used");
    assertNonEmpty(options.appToken, "app token is required unless --skip-traffic is used");
  }
}

async function invokeGatewayChat(options, runId) {
  const requestId = `request_${runId}_gateway_metrics`;
  const prompt = `Write a short safe customer support reply for GateLM observability stack evidence. Run ${runId}.`;
  const response = await fetch(joinUrl(options.gatewayBaseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      "x-gatelm-app-token": options.appToken,
      "x-gatelm-request-id": requestId,
      "x-gatelm-end-user-id": "user_observability_stack_evidence",
      "x-gatelm-feature-id": "v2_observability_stack_evidence",
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
  const gateLM = gateLMMetadata(bodyText);
  return {
    requestId,
    promptFingerprint: shortHash(prompt),
    httpStatus: response.status,
    ok: response.ok,
    cacheStatus: response.headers.get("x-gatelm-cache-status") ?? "",
    maskingAction: response.headers.get("x-gatelm-masking-action") ?? "",
    requestedModel: String(gateLM.requestedModel ?? ""),
    routingReason: String(gateLM.routingReason ?? ""),
    executionMode: String(gateLM.executionMode ?? ""),
  };
}

function gateLMMetadata(bodyText) {
  try {
    return JSON.parse(bodyText)?.gate_lm ?? {};
  } catch {
    return {};
  }
}

async function prometheusQuery(prometheusBaseUrl, query) {
  return fetchJson(`${joinUrl(prometheusBaseUrl, "/api/v1/query")}?query=${encodeURIComponent(query)}`);
}

function findGatewayTarget(targetsResponse) {
  const activeTargets = targetsResponse?.data?.activeTargets;
  if (!Array.isArray(activeTargets)) {
    return null;
  }
  return activeTargets.find((target) => target.labels?.job === "gatelm-gateway") ?? null;
}

function prometheusNumericValue(queryResult) {
  const first = queryResult?.data?.result?.[0];
  const raw = first?.value?.[1];
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${safeGatewayErrorSummary(text)}`);
  }
  return JSON.parse(text);
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${safeGatewayErrorSummary(text)}`);
  }
  return text;
}

function grafanaAuthHeaders(options) {
  const credentials = Buffer.from(`${options.grafanaUser}:${options.grafanaPassword}`, "utf8").toString("base64");
  return { authorization: `Basic ${credentials}` };
}

function datasourceSummary(datasource) {
  return {
    uid: datasource?.uid ?? "",
    name: datasource?.name ?? "",
    type: datasource?.type ?? "",
    url: datasource?.url ?? "",
    isDefault: Boolean(datasource?.isDefault),
  };
}

function dashboardSummary(dashboard) {
  return {
    uid: dashboard?.dashboard?.uid ?? "",
    title: dashboard?.dashboard?.title ?? "",
    panelCount: Array.isArray(dashboard?.dashboard?.panels) ? dashboard.dashboard.panels.length : 0,
    folderTitle: dashboard?.meta?.folderTitle ?? "",
  };
}

function recordAssertion(assertions, name, pass) {
  assertions.push({ name, pass: Boolean(pass) });
}

function envOrDefault(name, fallback) {
  const value = process.env[name];
  return value == null || value.trim() === "" ? fallback : value.trim();
}

function positiveIntEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value.trim() === "") {
    return fallback;
  }
  return positiveIntValue(value, name);
}

function positiveIntValue(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function assertNonEmpty(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function joinUrl(baseUrl, suffix) {
  return `${trimTrailingSlash(baseUrl)}${suffix}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function timestampForId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function safeGatewayErrorSummary(text) {
  if (!text) {
    return "";
  }
  try {
    const parsed = JSON.parse(text);
    const code = parsed?.error?.code ?? parsed?.code ?? "unknown_error";
    return JSON.stringify({ error: { code } });
  } catch {
    return text.slice(0, 160);
  }
}

function printUsage() {
  console.log(`Usage: pnpm v2:observability:stack-evidence [options]

Options:
  --gateway-base-url <url>      Gateway base URL. Default: ${DEFAULT_GATEWAY_BASE_URL}
  --prometheus-base-url <url>   Prometheus base URL. Default: ${DEFAULT_PROMETHEUS_BASE_URL}
  --grafana-base-url <url>      Grafana base URL. Default: ${DEFAULT_GRAFANA_BASE_URL}
  --api-key <value>             Demo Gateway API key for synthetic traffic
  --app-token <value>           Demo Gateway app token for synthetic traffic
  --grafana-user <value>        Grafana admin user. Default: ${DEFAULT_GRAFANA_USER}
  --grafana-password <value>    Grafana admin password. Default: ${DEFAULT_GRAFANA_PASSWORD}
  --report-dir <path>           Evidence report directory
  --scrape-wait-ms <number>     Wait time after traffic before Prometheus query. Default: 10000
  --skip-traffic                Do not send synthetic Gateway request
  --help                        Show this help
`);
}
