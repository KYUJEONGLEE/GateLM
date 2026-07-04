#!/usr/bin/env node

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_GATEWAY_BASE_URL = "http://localhost:8080";
const DEFAULT_MOCK_PROVIDER_BASE_URL = "http://localhost:8090";
const DEFAULT_PROJECT_ID = "00000000-0000-4000-8000-000000000200";
const DEFAULT_API_KEY = "glm_api_test_redacted";
const DEFAULT_APP_TOKEN = "glm_app_token_test_redacted";
const DEFAULT_REPORT_DIR = "reports/routing-blind-100-evidence";
const DEFAULT_TIMEOUT_MS = 10_000;
const ROUTING_CASE_COUNT = 100;
const SAFE_PREVIEW_LIMIT = 96;

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

  const runId = `blind100_${timestampForId()}`;
  const reportDir = path.resolve(repoRoot, options.reportDir);
  const routingCases = buildRoutingCases(runId);
  const flowProbes = buildFlowProbes(runId);
  const requestPrefix = `request_${runId}_`;
  const runStartedAt = new Date().toISOString();

  console.log("");
  console.log("GateLM routing blind 100 evidence");
  console.log("==================================");
  console.log(`gateway:       ${options.gatewayBaseUrl}`);
  console.log(`mock provider: ${options.mockProviderBaseUrl}`);
  console.log(`projectId:     ${options.projectId}`);
  console.log(`runId:         ${runId}`);
  console.log(`routing cases: ${routingCases.length}`);
  console.log(`flow probes:   ${flowProbes.length}`);
  console.log("");

  await fs.mkdir(reportDir, { recursive: true });
  await writeBlindDataset(reportDir, runId, routingCases);

  await assertGatewayReady(options.gatewayBaseUrl);
  await resetMockProvider(options);
  const mockCallsBefore = await mockProviderTotalCalls(options);

  const routingResults = [];
  for (let index = 0; index < routingCases.length; index += 1) {
    const testCase = routingCases[index];
    const result = await invokeGatewayChat(options, runId, testCase, {
      featureId: "v2_routing_blind_100",
    });
    routingResults.push(result);

    if ((index + 1) % 10 === 0 || index === routingCases.length - 1) {
      console.log(`routing ${String(index + 1).padStart(3, " ")}/${routingCases.length}: latest HTTP ${result.httpStatus}`);
    }
  }

  const flowResults = [];
  for (const probe of flowProbes) {
    const result = await invokeGatewayChat(options, runId, probe, {
      featureId: "v2_gateway_flow_probe",
    });
    flowResults.push(result);
    console.log(`flow ${probe.caseId}: HTTP ${result.httpStatus} cache=${result.cacheStatus || "-"} masking=${result.maskingAction || "-"}`);
  }

  await sleep(options.flushWaitMs);
  const dbLogs = options.skipDb
    ? []
    : await waitForDbLogs(requestPrefix, routingCases.length + flowProbes.length, options.dbWaitMs);
  const mockStats = await getMockStats(options);
  const metricsText = await fetchText(joinUrl(options.gatewayBaseUrl, "/metrics"));

  const dbByRequestId = new Map(dbLogs.map((item) => [item.requestId, item]));
  const enrichedRouting = routingResults.map((result) =>
    enrichRoutingResult(result, dbByRequestId.get(result.requestId)),
  );
  const enrichedFlow = flowResults.map((result) => enrichFlowResult(result, dbByRequestId.get(result.requestId)));
  const routingSummary = summarizeRouting(enrichedRouting);
  const flowSummary = summarizeFlow(enrichedFlow, mockCallsBefore, mockStats);
  const metricsSummary = summarizeMetrics(metricsText);
  const assertions = buildAssertions({
    routingSummary,
    flowSummary,
    expectedDbLogs: routingCases.length + flowProbes.length,
    actualDbLogs: dbLogs.length,
    skipDb: options.skipDb,
  });

  const runCompletedAt = new Date().toISOString();
  const report = {
    schemaVersion: "gatelm.routing-blind-100-evidence.v1",
    runId,
    generatedAt: runCompletedAt,
    gatewayBaseUrl: options.gatewayBaseUrl,
    mockProviderBaseUrl: options.mockProviderBaseUrl,
    projectId: options.projectId,
    timing: {
      startedAt: runStartedAt,
      completedAt: runCompletedAt,
    },
    summary: {
      routing: routingSummary,
      flow: flowSummary,
      metrics: metricsSummary,
      dbLogCount: dbLogs.length,
    },
    blindDataset: {
      caseCount: routingCases.length,
      file: "latest_blind_cases.json",
      note: "The blind dataset file excludes expected category/model/reason labels. This JSON report keeps labels only for scoring.",
    },
    routingResults: enrichedRouting,
    flowResults: enrichedFlow,
    dbLogSample: dbLogs.slice(0, 20),
    assertions,
    securityNote:
      "Reports exclude Authorization, API key, app token, provider key, raw provider credential, and raw synthetic PII prompt values.",
  };

  const answerKey = {
    schemaVersion: "gatelm.routing-blind-100-answer-key.v1",
    runId,
    cases: routingCases.map((testCase) => ({
      caseId: testCase.caseId,
      expectedCategory: testCase.expectedCategory,
      expectedModel: testCase.expectedModel,
      expectedRoutingReason: testCase.expectedRoutingReason,
    })),
  };

  const timestamp = timestampForId();
  const reportPath = path.join(reportDir, `routing-blind-100-evidence-${timestamp}.json`);
  const latestPath = path.join(reportDir, "latest.json");
  const publicMarkdownPath = path.join(reportDir, "latest_public.md");
  const answerKeyPath = path.join(reportDir, "latest_answer_key.json");
  const reportPayload = `${JSON.stringify(report, null, 2)}\n`;
  const answerPayload = `${JSON.stringify(answerKey, null, 2)}\n`;

  await fs.writeFile(reportPath, reportPayload, "utf8");
  await fs.writeFile(latestPath, reportPayload, "utf8");
  await fs.writeFile(answerKeyPath, answerPayload, "utf8");
  await fs.writeFile(publicMarkdownPath, renderPublicMarkdown(report), "utf8");

  console.log("");
  console.log(`blind dataset: ${path.relative(repoRoot, path.join(reportDir, "latest_blind_cases.json"))}`);
  console.log(`public report:  ${path.relative(repoRoot, publicMarkdownPath)}`);
  console.log(`json report:    ${path.relative(repoRoot, latestPath)}`);
  console.log(`answer key:     ${path.relative(repoRoot, answerKeyPath)}`);

  const failed = assertions.filter((item) => !item.pass);
  if (failed.length > 0) {
    throw new Error(`Evidence assertions failed: ${failed.map((item) => item.name).join(", ")}`);
  }

  console.log("PASS: routing blind 100 evidence succeeded");
}

function parseArgs(args) {
  const options = {
    help: false,
    gatewayBaseUrl: envOrDefault("GATEWAY_BASE_URL", DEFAULT_GATEWAY_BASE_URL),
    mockProviderBaseUrl: envOrDefault("MOCK_PROVIDER_BASE_URL", DEFAULT_MOCK_PROVIDER_BASE_URL),
    projectId: envOrDefault("GATELM_DEMO_PROJECT_ID", DEFAULT_PROJECT_ID),
    apiKey: envOrDefault("GATELM_DEMO_API_KEY", DEFAULT_API_KEY),
    appToken: envOrDefault("GATELM_DEMO_APP_TOKEN", DEFAULT_APP_TOKEN),
    reportDir: envOrDefault("GATELM_ROUTING_BLIND_100_REPORT_DIR", DEFAULT_REPORT_DIR),
    flushWaitMs: positiveIntEnv("GATELM_ROUTING_BLIND_100_FLUSH_WAIT_MS", 2_000),
    dbWaitMs: positiveIntEnv("GATELM_ROUTING_BLIND_100_DB_WAIT_MS", 15_000),
    requestTimeoutMs: positiveIntEnv("GATELM_ROUTING_BLIND_100_REQUEST_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    skipDb: false,
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
      case "--mock-provider-base-url":
        options.mockProviderBaseUrl = value();
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
      case "--flush-wait-ms":
        options.flushWaitMs = positiveIntValue(value(), "--flush-wait-ms");
        break;
      case "--db-wait-ms":
        options.dbWaitMs = positiveIntValue(value(), "--db-wait-ms");
        break;
      case "--request-timeout-ms":
        options.requestTimeoutMs = positiveIntValue(value(), "--request-timeout-ms");
        break;
      case "--skip-db":
        options.skipDb = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.gatewayBaseUrl = trimTrailingSlash(options.gatewayBaseUrl);
  options.mockProviderBaseUrl = trimTrailingSlash(options.mockProviderBaseUrl);
  return options;
}

function validateOptions(options) {
  assertNonEmpty(options.gatewayBaseUrl, "gateway base URL is required");
  assertNonEmpty(options.mockProviderBaseUrl, "mock provider base URL is required");
  assertNonEmpty(options.projectId, "project id is required");
  assertNonEmpty(options.apiKey, "api key is required");
  assertNonEmpty(options.appToken, "app token is required");
}

function buildRoutingCases(runId) {
  const specs = [
    {
      prefix: "general_short",
      count: 15,
      expectedCategory: "general",
      expectedModel: "mock-fast",
      expectedRoutingReason: "short_prompt_low_cost",
      prompt: (index) => `Explain the weekly product update for customer success case ${index} in one short paragraph. Run ${runId}.`,
    },
    {
      prefix: "general_long",
      count: 10,
      expectedCategory: "general",
      expectedModel: "mock-balanced",
      expectedRoutingReason: "default_balanced",
      prompt: (index) =>
        [
          `Write a calm internal briefing for a product announcement case ${index}.`,
          "Include the audience, timing, message goal, customer impact, owner follow-up, launch checklist, open risks, and next steps.",
          "Keep the answer practical for a team preparing a routine update for customers and partner teams.",
          "Use plain language, avoid specialist terms, and make the message easy to share in a weekly note.",
          `Run ${runId}.`,
        ].join(" "),
    },
    {
      prefix: "support_refund",
      count: 15,
      expectedCategory: "support_refund",
      expectedModel: "mock-fast",
      expectedRoutingReason: "category_support_refund_low_cost",
      prompt: (index) => `Write a refund response for a customer who wants to return an item after billing case ${index}. Run ${runId}.`,
    },
    {
      prefix: "code",
      count: 15,
      expectedCategory: "code",
      expectedModel: "mock-smart",
      expectedRoutingReason: "category_code_high_quality",
      prompt: (index) => `Fix this TypeScript function error and explain the failing condition for handler case ${index}. Run ${runId}.`,
    },
    {
      prefix: "translation",
      count: 15,
      expectedCategory: "translation",
      expectedModel: "mock-balanced",
      expectedRoutingReason: "category_translation_balanced",
      prompt: (index) => `Translate this customer notice into English with a polite tone for case ${index}. Run ${runId}.`,
    },
    {
      prefix: "summarization",
      count: 10,
      expectedCategory: "summarization",
      expectedModel: "mock-balanced",
      expectedRoutingReason: "category_summarization_balanced",
      prompt: (index) => `Summarize the meeting notes into three decisions and two blockers for case ${index}. Run ${runId}.`,
    },
    {
      prefix: "extraction_json",
      count: 10,
      expectedCategory: "extraction_json",
      expectedModel: "mock-balanced",
      expectedRoutingReason: "category_extraction_json_balanced",
      prompt: (index) => `Extract the order id, status, and owner as JSON from this text for case ${index}. Run ${runId}.`,
    },
    {
      prefix: "reasoning",
      count: 10,
      expectedCategory: "reasoning",
      expectedModel: "mock-smart",
      expectedRoutingReason: "category_reasoning_high_quality",
      prompt: (index) => `Compare these rollout options and explain the tradeoff before recommending one path for case ${index}. Run ${runId}.`,
    },
  ];

  const cases = [];
  for (const spec of specs) {
    for (let index = 1; index <= spec.count; index += 1) {
      cases.push({
        kind: "routing",
        caseId: `${spec.prefix}_${String(index).padStart(3, "0")}`,
        prompt: spec.prompt(index),
        expectedCategory: spec.expectedCategory,
        expectedModel: spec.expectedModel,
        expectedRoutingReason: spec.expectedRoutingReason,
        expectedHTTPStatus: 200,
        temperature: 0.2,
        maxTokens: 96,
      });
    }
  }

  if (cases.length !== ROUTING_CASE_COUNT) {
    throw new Error(`routing case count mismatch: got ${cases.length}, want ${ROUTING_CASE_COUNT}`);
  }
  return cases;
}

function buildFlowProbes(runId) {
  const exactPrompt = `Explain exact cache behavior in one sentence for run ${runId}.`;
  return [
    {
      kind: "flow",
      caseId: "flow_exact_seed",
      flowType: "exact_cache_seed",
      prompt: exactPrompt,
      expectedHTTPStatus: 200,
      temperature: 0.1,
      maxTokens: 64,
    },
    {
      kind: "flow",
      caseId: "flow_exact_hit",
      flowType: "exact_cache_hit",
      prompt: exactPrompt,
      expectedHTTPStatus: 200,
      temperature: 0.1,
      maxTokens: 64,
    },
    {
      kind: "flow",
      caseId: "flow_semantic_seed",
      flowType: "semantic_cache_seed",
      prompt: `배송비 환불 되나요? Run ${runId}.`,
      expectedHTTPStatus: 200,
      temperature: 0.2,
      maxTokens: 64,
    },
    {
      kind: "flow",
      caseId: "flow_semantic_probe",
      flowType: "semantic_cache_probe",
      prompt: `반품 배송비 환불 받을 수 있나요? Run ${runId}.`,
      expectedHTTPStatus: 200,
      temperature: 0.2,
      maxTokens: 64,
    },
    {
      kind: "flow",
      caseId: "flow_pii_redaction",
      flowType: "pii_redaction",
      prompt: `Write a support reply for ticket ${runId} to synthetic.blind100.${runId}@example.test and ask them to call 010-0000-1234.`,
      expectedHTTPStatus: 200,
      temperature: 0.2,
      maxTokens: 64,
    },
    {
      kind: "flow",
      caseId: "flow_pii_block",
      flowType: "pii_block",
      prompt: `Summarize this synthetic config: api_key=test_secret_token_redacted_for_demo_only_${runId}_abcdef1234567890`,
      expectedHTTPStatus: 403,
      temperature: 0.2,
      maxTokens: 64,
    },
  ];
}

async function writeBlindDataset(reportDir, runId, routingCases) {
  const blindDataset = {
    schemaVersion: "gatelm.routing-blind-100-dataset.v1",
    runId,
    caseCount: routingCases.length,
    note: "This blind dataset intentionally excludes expectedCategory, expectedModel, and expectedRoutingReason.",
    cases: routingCases.map((testCase) => ({
      caseId: testCase.caseId,
      prompt: testCase.prompt,
      model: "auto",
      temperature: testCase.temperature,
      maxTokens: testCase.maxTokens,
    })),
  };
  const payload = `${JSON.stringify(blindDataset, null, 2)}\n`;
  const timestamp = timestampForId();
  await fs.writeFile(path.join(reportDir, `routing-blind-100-cases-${timestamp}.json`), payload, "utf8");
  await fs.writeFile(path.join(reportDir, "latest_blind_cases.json"), payload, "utf8");
}

async function assertGatewayReady(gatewayBaseUrl) {
  const ready = await fetchJson(joinUrl(gatewayBaseUrl, "/readyz"));
  if (ready.status < 200 || ready.status >= 300) {
    throw new Error(`/readyz failed with HTTP ${ready.status}: ${ready.text.slice(0, 240)}`);
  }
}

async function resetMockProvider(options) {
  const response = await fetch(joinUrl(options.mockProviderBaseUrl, "/__mock/reset"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(options.requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`mock provider reset failed with HTTP ${response.status}`);
  }
}

async function invokeGatewayChat(options, runId, testCase, extra) {
  const requestId = `request_${runId}_${testCase.caseId}`;
  const startedAt = new Date().toISOString();
  const body = {
    model: "auto",
    messages: [{ role: "user", content: testCase.prompt }],
    temperature: testCase.temperature,
    max_tokens: testCase.maxTokens,
    stream: false,
  };

  const response = await fetch(joinUrl(options.gatewayBaseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      "x-gatelm-app-token": options.appToken,
      "x-gatelm-request-id": requestId,
      "x-gatelm-end-user-id": "user_routing_blind_100",
      "x-gatelm-feature-id": extra.featureId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.requestTimeoutMs),
  });

  const text = await response.text();
  const decoded = parseJSONOrNull(text);
  const gateLM = decoded?.gate_lm ?? {};
  const errorCode = decoded?.error?.code ?? "";

  return {
    kind: testCase.kind,
    caseId: testCase.caseId,
    flowType: testCase.flowType ?? "",
    requestId,
    promptFingerprint: shortHash(testCase.prompt),
    promptPreview: testCase.kind === "routing" ? safePreview(testCase.prompt) : safeFlowPromptPreview(testCase),
    expectedCategory: testCase.expectedCategory,
    expectedModel: testCase.expectedModel,
    expectedRoutingReason: testCase.expectedRoutingReason,
    expectedHTTPStatus: testCase.expectedHTTPStatus,
    httpStatus: response.status,
    errorCode,
    startedAt,
    completedAt: new Date().toISOString(),
    cacheStatus: headerOr(response, "x-gatelm-cache-status", gateLM.cacheStatus),
    cacheType: gateLM.cacheType ?? "",
    cacheHitRequestId: gateLM.cacheHitRequestId ?? "",
    maskingAction: headerOr(response, "x-gatelm-masking-action", gateLM.maskingAction),
    selectedProvider: headerOr(response, "x-gatelm-routed-provider", gateLM.selectedProvider),
    selectedModel: headerOr(response, "x-gatelm-routed-model", gateLM.selectedModel),
    routingReason: gateLM.routingReason ?? "",
    terminalStatus: gateLM.terminalStatus ?? "",
    providerCalled: Boolean(gateLM.providerCalled),
    latencyMs: typeof gateLM.latencyMs === "number" ? gateLM.latencyMs : null,
    responseBodyFingerprint: shortHash(text),
  };
}

function enrichRoutingResult(result, dbLog) {
  const actualCategory = firstNonEmpty(dbLog?.promptCategory, categoryFromRoutingReason(result.routingReason));
  const actualModel = firstNonEmpty(result.selectedModel, dbLog?.selectedModel);
  const actualReason = firstNonEmpty(result.routingReason, dbLog?.routingReason);
  return {
    ...result,
    actualCategory,
    db: compactDbEvidence(dbLog),
    pass: {
      http: result.httpStatus === result.expectedHTTPStatus,
      category: actualCategory === result.expectedCategory,
      model: actualModel === result.expectedModel,
      routingReason: actualReason === result.expectedRoutingReason,
      dbLogWritten: Boolean(dbLog),
    },
  };
}

function enrichFlowResult(result, dbLog) {
  return {
    ...result,
    db: compactDbEvidence(dbLog),
    semantic: {
      enabled: boolish(dbLog?.semanticCacheEnabled),
      mode: dbLog?.semanticCacheMode ?? "",
      hit: boolish(dbLog?.semanticCacheHit),
      returnedFromCache: boolish(dbLog?.semanticReturnedFromCache),
      wouldHit: boolish(dbLog?.semanticCacheWouldHit),
      wouldMiss: boolish(dbLog?.semanticCacheWouldMiss),
      decisionReason: dbLog?.semanticCacheDecisionReason ?? "",
      similarity: dbLog?.semanticSimilarity ?? "",
      matchedRequestId: dbLog?.semanticMatchedRequestId ?? "",
    },
  };
}

function compactDbEvidence(dbLog) {
  if (!dbLog) {
    return {
      written: false,
    };
  }
  return {
    written: true,
    status: dbLog.status,
    httpStatus: dbLog.httpStatus,
    cacheStatus: dbLog.cacheStatus,
    cacheType: dbLog.cacheType,
    cacheHitRequestId: dbLog.cacheHitRequestId,
    maskingAction: dbLog.maskingAction,
    maskingDetectedTypes: dbLog.maskingDetectedTypes,
    maskingDetectedCount: dbLog.maskingDetectedCount,
    selectedProvider: dbLog.selectedProvider,
    selectedModel: dbLog.selectedModel,
    routingReason: dbLog.routingReason,
    promptCategory: dbLog.promptCategory,
    providerCalled: boolish(dbLog.providerCalled),
    providerOutcome: dbLog.providerOutcome,
    requestLogWritten: boolish(dbLog.requestLogWritten),
    semanticCacheDecisionReason: dbLog.semanticCacheDecisionReason,
  };
}

function summarizeRouting(results) {
  const total = results.length;
  const httpPass = count(results, (item) => item.pass.http);
  const categoryPass = count(results, (item) => item.pass.category);
  const modelPass = count(results, (item) => item.pass.model);
  const reasonPass = count(results, (item) => item.pass.routingReason);
  const dbPass = count(results, (item) => item.pass.dbLogWritten);
  const byExpectedCategory = {};
  for (const result of results) {
    const key = result.expectedCategory;
    byExpectedCategory[key] ??= { total: 0, categoryPass: 0, modelPass: 0, reasonPass: 0 };
    byExpectedCategory[key].total += 1;
    if (result.pass.category) byExpectedCategory[key].categoryPass += 1;
    if (result.pass.model) byExpectedCategory[key].modelPass += 1;
    if (result.pass.routingReason) byExpectedCategory[key].reasonPass += 1;
  }
  return {
    total,
    httpPass,
    categoryPass,
    modelPass,
    reasonPass,
    dbLogWritten: dbPass,
    categoryAccuracy: ratio(categoryPass, total),
    modelAccuracy: ratio(modelPass, total),
    routingReasonAccuracy: ratio(reasonPass, total),
    dbLogCoverage: ratio(dbPass, total),
    byExpectedCategory,
  };
}

function summarizeFlow(results, mockCallsBefore, mockStats) {
  const byType = Object.fromEntries(results.map((item) => [item.flowType, item]));
  const exactSeed = byType.exact_cache_seed;
  const exactHit = byType.exact_cache_hit;
  const semanticProbe = byType.semantic_cache_probe;
  const piiRedaction = byType.pii_redaction;
  const piiBlock = byType.pii_block;

  return {
    total: results.length,
    dbLogWritten: count(results, (item) => item.db.written),
    mockProviderCallsBefore: mockCallsBefore,
    mockProviderCallsAfter: mockStats?.data?.totalCalls ?? null,
    mockProviderCallsByModel: mockStats?.data?.callsByModel ?? {},
    exactCache: {
      seedMiss: exactSeed?.cacheStatus === "miss",
      secondHit: exactHit?.cacheStatus === "hit",
      providerBypassedOnHit: exactHit?.providerCalled === false || exactHit?.db.providerCalled === false,
      hitRequestId: firstNonEmpty(exactHit?.cacheHitRequestId, exactHit?.db.cacheHitRequestId),
    },
    semanticCache: {
      enabled: semanticProbe?.semantic.enabled ?? false,
      mode: semanticProbe?.semantic.mode ?? "",
      hit: semanticProbe?.cacheStatus === "hit" && semanticProbe?.cacheType === "semantic",
      returnedFromCache: semanticProbe?.semantic.returnedFromCache ?? false,
      wouldHit: semanticProbe?.semantic.wouldHit ?? false,
      decisionReason: semanticProbe?.semantic.decisionReason ?? "",
      similarity: semanticProbe?.semantic.similarity ?? "",
      matchedRequestId: semanticProbe?.semantic.matchedRequestId ?? "",
    },
    pii: {
      redactionHttpOK: piiRedaction?.httpStatus === 200,
      redactionAction: firstNonEmpty(piiRedaction?.maskingAction, piiRedaction?.db.maskingAction),
      redactionProviderCalled: piiRedaction?.providerCalled === true || piiRedaction?.db.providerCalled === true,
      blockHTTPForbidden: piiBlock?.httpStatus === 403,
      blockAction: firstNonEmpty(piiBlock?.maskingAction, piiBlock?.db.maskingAction),
      blockProviderBypassed: piiBlock?.providerCalled === false || piiBlock?.db.providerCalled === false,
      blockErrorCode: piiBlock?.errorCode ?? "",
    },
  };
}

function summarizeMetrics(metricsText) {
  const families = [
    "gatelm_gateway_requests_total",
    "gatelm_provider_requests_total",
    "gatelm_cache_operations_total",
    "gatelm_masking_actions_total",
    "gatelm_log_writes_total",
    "gatelm_async_log_enqueue_total",
    "gatelm_async_log_persist_total",
  ];
  return Object.fromEntries(families.map((family) => [family, metricsText.includes(family)]));
}

function buildAssertions(input) {
  const assertions = [
    {
      name: "routing 100 HTTP requests succeeded",
      pass: input.routingSummary.httpPass === ROUTING_CASE_COUNT,
      detail: `${input.routingSummary.httpPass}/${ROUTING_CASE_COUNT}`,
    },
    {
      name: "routing category accuracy is 100%",
      pass: input.routingSummary.categoryPass === ROUTING_CASE_COUNT,
      detail: `${input.routingSummary.categoryPass}/${ROUTING_CASE_COUNT}`,
    },
    {
      name: "routing selected model accuracy is 100%",
      pass: input.routingSummary.modelPass === ROUTING_CASE_COUNT,
      detail: `${input.routingSummary.modelPass}/${ROUTING_CASE_COUNT}`,
    },
    {
      name: "routing reason accuracy is 100%",
      pass: input.routingSummary.reasonPass === ROUTING_CASE_COUNT,
      detail: `${input.routingSummary.reasonPass}/${ROUTING_CASE_COUNT}`,
    },
    {
      name: "exact cache second request hit",
      pass: input.flowSummary.exactCache.secondHit,
      detail: JSON.stringify(input.flowSummary.exactCache),
    },
    {
      name: "PII redaction request was redacted and provider-called",
      pass:
        input.flowSummary.pii.redactionHttpOK &&
        input.flowSummary.pii.redactionAction === "redacted" &&
        input.flowSummary.pii.redactionProviderCalled,
      detail: JSON.stringify(input.flowSummary.pii),
    },
    {
      name: "PII block request was forbidden and provider-bypassed",
      pass:
        input.flowSummary.pii.blockHTTPForbidden &&
        input.flowSummary.pii.blockAction === "blocked" &&
        input.flowSummary.pii.blockProviderBypassed,
      detail: JSON.stringify(input.flowSummary.pii),
    },
  ];

  if (!input.skipDb) {
    assertions.push({
      name: "terminal logs written to Postgres",
      pass: input.actualDbLogs >= input.expectedDbLogs,
      detail: `${input.actualDbLogs}/${input.expectedDbLogs}`,
    });
  }
  return assertions;
}

async function waitForDbLogs(requestPrefix, expectedCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() <= deadline) {
    latest = queryDbLogs(requestPrefix);
    if (latest.length >= expectedCount) {
      return latest;
    }
    await sleep(500);
  }
  return latest;
}

function queryDbLogs(requestPrefix) {
  const prefix = escapeSqlLiteral(requestPrefix);
  const sql = `
select coalesce(json_agg(row_to_json(t) order by "requestId"), '[]'::json)
from (
  select
    request_id as "requestId",
    status,
    http_status as "httpStatus",
    selected_provider as "selectedProvider",
    selected_model as "selectedModel",
    routing_reason as "routingReason",
    cache_status as "cacheStatus",
    cache_type as "cacheType",
    cache_hit_request_id as "cacheHitRequestId",
    masking_action as "maskingAction",
    masking_detected_types as "maskingDetectedTypes",
    masking_detected_count as "maskingDetectedCount",
    provider_latency_ms as "providerLatencyMs",
    metadata #>> '{providerCalled}' as "providerCalled",
    metadata #>> '{promptCategory}' as "promptCategory",
    metadata #>> '{semanticCacheEnabled}' as "semanticCacheEnabled",
    metadata #>> '{semanticCacheMode}' as "semanticCacheMode",
    metadata #>> '{semanticCacheHit}' as "semanticCacheHit",
    metadata #>> '{semanticReturnedFromCache}' as "semanticReturnedFromCache",
    metadata #>> '{semanticCacheWouldHit}' as "semanticCacheWouldHit",
    metadata #>> '{semanticCacheWouldMiss}' as "semanticCacheWouldMiss",
    metadata #>> '{semanticCacheDecisionReason}' as "semanticCacheDecisionReason",
    metadata #>> '{semanticSimilarity}' as "semanticSimilarity",
    metadata #>> '{semanticMatchedRequestId}' as "semanticMatchedRequestId",
    metadata #>> '{domainOutcomes,provider,outcome}' as "providerOutcome",
    metadata #>> '{domainOutcomes,logging,requestLogWritten}' as "requestLogWritten",
    created_at as "createdAt"
  from p0_llm_invocation_logs
  where request_id like '${prefix}%'
  order by created_at asc
) t;
`;

  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "psql", "-U", "gatelm", "-d", "gatelm", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(`Postgres log query failed: ${stderr || `exit ${result.status}`}`);
  }

  const raw = String(result.stdout || "").trim();
  if (!raw) {
    return [];
  }
  return JSON.parse(raw);
}

async function getMockStats(options) {
  const response = await fetchJson(joinUrl(options.mockProviderBaseUrl, "/__mock/stats"));
  if (response.status !== 200) {
    throw new Error(`mock stats failed with HTTP ${response.status}`);
  }
  return response.json;
}

async function mockProviderTotalCalls(options) {
  const stats = await getMockStats(options);
  return Number(stats?.data?.totalCalls ?? 0);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: parseJSONOrNull(text),
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}`);
  }
  return response.text();
}

function renderPublicMarkdown(report) {
  const lines = [];
  lines.push(`# GateLM routing blind 100 evidence`);
  lines.push("");
  lines.push(`- runId: \`${report.runId}\``);
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- gateway: \`${report.gatewayBaseUrl}\``);
  lines.push(`- blind dataset: \`latest_blind_cases.json\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| item | value |");
  lines.push("| --- | ---: |");
  lines.push(`| routing cases | ${report.summary.routing.total} |`);
  lines.push(`| category accuracy | ${percent(report.summary.routing.categoryAccuracy)} |`);
  lines.push(`| selected model accuracy | ${percent(report.summary.routing.modelAccuracy)} |`);
  lines.push(`| routing reason accuracy | ${percent(report.summary.routing.routingReasonAccuracy)} |`);
  lines.push(`| routing DB log coverage | ${percent(report.summary.routing.dbLogCoverage)} |`);
  lines.push(`| total DB logs in run | ${report.summary.dbLogCount} |`);
  lines.push("");
  lines.push("## Flow Probes");
  lines.push("");
  lines.push("| flow | requestId | http | cache | masking | providerCalled | dbLog | semanticDecision |");
  lines.push("| --- | --- | ---: | --- | --- | --- | --- | --- |");
  for (const item of report.flowResults) {
    lines.push(
      `| ${item.flowType} | \`${item.requestId}\` | ${item.httpStatus} | ${item.cacheStatus || "-"} / ${item.cacheType || "-"} | ${item.maskingAction || "-"} | ${displayBool(item.providerCalled || item.db.providerCalled)} | ${displayBool(item.db.written)} | ${item.semantic.decisionReason || "-"} |`,
    );
  }
  lines.push("");
  lines.push("## Routing Results");
  lines.push("");
  lines.push("| caseId | requestId | http | actualCategory | selectedModel | routingReason | cache | providerCalled | dbLog |");
  lines.push("| --- | --- | ---: | --- | --- | --- | --- | --- | --- |");
  for (const item of report.routingResults) {
    lines.push(
      `| ${item.caseId} | \`${item.requestId}\` | ${item.httpStatus} | ${item.actualCategory || "-"} | ${item.selectedModel || item.db.selectedModel || "-"} | ${item.routingReason || item.db.routingReason || "-"} | ${item.cacheStatus || item.db.cacheStatus || "-"} / ${item.cacheType || item.db.cacheType || "-"} | ${displayBool(item.providerCalled || item.db.providerCalled)} | ${displayBool(item.db.written)} |`,
    );
  }
  lines.push("");
  lines.push("## Assertions");
  lines.push("");
  lines.push("| assertion | pass | detail |");
  lines.push("| --- | --- | --- |");
  for (const assertion of report.assertions) {
    lines.push(`| ${assertion.name} | ${displayBool(assertion.pass)} | ${escapeMarkdown(assertion.detail)} |`);
  }
  lines.push("");
  lines.push("> Expected labels are intentionally omitted from this public Markdown. Use `latest_answer_key.json` or `latest.json` for scoring details.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function headerOr(response, name, fallback) {
  return firstNonEmpty(response.headers.get(name), fallback);
}

function safePreview(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, SAFE_PREVIEW_LIMIT);
}

function safeFlowPromptPreview(testCase) {
  switch (testCase.flowType) {
    case "pii_redaction":
      return "Write a support reply to <synthetic_email> and ask them to call <synthetic_phone>.";
    case "pii_block":
      return "Summarize this synthetic config: api_key=<synthetic_secret>";
    default:
      return safePreview(testCase.prompt);
  }
}

function categoryFromRoutingReason(reason) {
  switch (reason) {
    case "category_code_high_quality":
      return "code";
    case "category_translation_balanced":
      return "translation";
    case "category_summarization_balanced":
      return "summarization";
    case "category_extraction_json_balanced":
      return "extraction_json";
    case "category_support_refund_low_cost":
      return "support_refund";
    case "category_reasoning_high_quality":
      return "reasoning";
    case "short_prompt_low_cost":
    case "default_balanced":
      return "general";
    default:
      return "";
  }
}

function parseJSONOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function shortHash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function timestampForId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function joinUrl(base, suffix) {
  return `${trimTrailingSlash(base)}/${String(suffix).replace(/^\/+/, "")}`;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function envOrDefault(key, fallback) {
  const value = process.env[key];
  return value == null || String(value).trim() === "" ? fallback : String(value).trim();
}

function positiveIntEnv(key, fallback) {
  const value = process.env[key];
  if (value == null || String(value).trim() === "") {
    return fallback;
  }
  return positiveIntValue(value, key);
}

function positiveIntValue(value, name) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function assertNonEmpty(value, message) {
  if (String(value ?? "").trim() === "") {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const normalized = String(value).trim();
    if (normalized !== "") {
      return normalized;
    }
  }
  return "";
}

function count(values, predicate) {
  return values.reduce((total, item) => total + (predicate(item) ? 1 : 0), 0);
}

function ratio(numerator, denominator) {
  if (denominator <= 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function boolish(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return String(value).trim().toLowerCase() === "true";
}

function displayBool(value) {
  return value ? "yes" : "no";
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function printUsage() {
  console.log(`
Usage:
  node scripts/dev/v2-routing-blind-100-evidence.mjs [options]

Options:
  --gateway-base-url <url>          Gateway base URL. Default: ${DEFAULT_GATEWAY_BASE_URL}
  --mock-provider-base-url <url>    Mock provider base URL. Default: ${DEFAULT_MOCK_PROVIDER_BASE_URL}
  --project-id <uuid>               Demo project id. Default: ${DEFAULT_PROJECT_ID}
  --api-key <key>                   Demo API key.
  --app-token <token>               Demo app token.
  --report-dir <path>               Report output directory. Default: ${DEFAULT_REPORT_DIR}
  --flush-wait-ms <ms>              Wait before DB log polling. Default: env or 2000
  --db-wait-ms <ms>                 DB polling timeout. Default: env or 15000
  --request-timeout-ms <ms>         Per-request timeout. Default: env or 10000
  --skip-db                         Skip Postgres terminal log verification.
  -h, --help                        Show this help.

Outputs:
  reports/routing-blind-100-evidence/latest_blind_cases.json
  reports/routing-blind-100-evidence/latest_public.md
  reports/routing-blind-100-evidence/latest.json
  reports/routing-blind-100-evidence/latest_answer_key.json
`);
}
