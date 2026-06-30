import { NextResponse } from "next/server";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";
import type {
  CustomerDemoExchange,
  CustomerDemoHeader,
  CustomerDemoRequest,
  CustomerDemoScenarioAlias,
  CustomerDemoScenarioId
} from "@/lib/gateway/customer-demo-client";
import { normalizeCustomerDemoScenarioId } from "@/lib/gateway/customer-demo-client";

type JsonRecord = Record<string, unknown>;

type GatewayCallResult = {
  body: JsonRecord;
  headers: Headers;
  httpStatus: number;
  latencyMs: number;
  requestBody: CustomerDemoRequest["body"];
  requestHeaders: CustomerDemoHeader[];
  requestId: string;
};

type LiveScenarioDefinition = {
  detectedCount: number;
  detectorCategories: string[];
  gatewayPrompt: string;
};

const RESPONSE_HEADER_NAMES = [
  "X-GateLM-Request-Id",
  "X-GateLM-Cache-Status",
  "X-GateLM-Cache-Type",
  "X-GateLM-Masking-Action",
  "X-GateLM-Routed-Provider",
  "X-GateLM-Routed-Model",
  "X-GateLM-Estimated-Cost-Usd",
  "Content-Type"
];

const SAFE_PROMPT =
  "Write a concise support reply for a delayed shipment. Keep it under three sentences.";

const LIVE_SCENARIOS: Record<CustomerDemoScenarioId, LiveScenarioDefinition> = {
  safe: {
    detectedCount: 0,
    detectorCategories: [],
    gatewayPrompt: SAFE_PROMPT
  },
  "cache-hit": {
    detectedCount: 0,
    detectorCategories: [],
    gatewayPrompt: SAFE_PROMPT
  },
  redaction: {
    detectedCount: 2,
    detectorCategories: ["email", "phone_number"],
    gatewayPrompt:
      "Write a support note to minji.kim@example.test and ask them to call 010-0000-1234."
  },
  safety_block: {
    detectedCount: 1,
    detectorCategories: ["credential"],
    gatewayPrompt:
      "Summarize this synthetic config: api_key=test_secret_token_redacted_for_demo_only_abcdef1234567890"
  },
  "rate-limited": {
    detectedCount: 0,
    detectorCategories: [],
    gatewayPrompt: "Write one more local stack response after quota is exhausted."
  }
};

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const model = getCustomerDemoLiveModel();

  if (payload.tenantId !== model.tenantId) {
    return NextResponse.json({ error: "Unknown tenant for customer demo." }, { status: 404 });
  }

  if (!isCustomerDemoScenarioAlias(payload.scenarioId)) {
    return NextResponse.json({ error: "Unknown customer demo scenario." }, { status: 400 });
  }

  const scenarioId = normalizeCustomerDemoScenarioId(payload.scenarioId);
  const scenario = model.scenarios.find((item) => item.scenarioId === scenarioId);

  if (!scenario) {
    return NextResponse.json({ error: "Customer demo scenario is not configured." }, { status: 404 });
  }

  try {
    const gatewayResult = await executeLiveScenario(scenarioId);

    return NextResponse.json({
      exchange: buildLiveExchange({
        allScenarios: model.scenarios,
        gatewayResult,
        scenario,
        scenarioId,
        tenantId: model.tenantId
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway integration request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function readRequestPayload(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    scenarioId?: unknown;
    tenantId?: unknown;
  };

  return {
    scenarioId: typeof payload.scenarioId === "string" ? payload.scenarioId : "",
    tenantId: typeof payload.tenantId === "string" ? payload.tenantId : ""
  };
}

function isCustomerDemoScenarioAlias(value: string): value is CustomerDemoScenarioAlias {
  return value === "redacted" || value === "blocked" || Object.hasOwn(LIVE_SCENARIOS, value);
}

async function executeLiveScenario(scenarioId: CustomerDemoScenarioId) {
  if (scenarioId === "cache-hit") {
    await callGateway("cache-hit", "warmup");
    return callGateway("cache-hit", "hit");
  }

  if (scenarioId === "rate-limited") {
    let latestResult: GatewayCallResult | null = null;
    const { rateLimitMaxAttempts } = getLiveGatewayConfig();

    // Keep the demo bounded; rate limit evidence should come from a low-limit demo config.
    for (let index = 0; index < rateLimitMaxAttempts; index += 1) {
      latestResult = await callGateway("rate-limited", String(index + 1));

      if (latestResult.httpStatus === 429) {
        return latestResult;
      }
    }

    if (latestResult) {
      return latestResult;
    }
  }

  return callGateway(scenarioId, "1");
}

async function callGateway(
  scenarioId: CustomerDemoScenarioId,
  requestIdSuffix: string
): Promise<GatewayCallResult> {
  const config = getLiveGatewayConfig();
  const definition = LIVE_SCENARIOS[scenarioId];
  const requestId = buildRequestId(scenarioId, requestIdSuffix);
  const requestBody = buildGatewayRequestBody(definition, scenarioId);
  const startedAt = Date.now();
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-GateLM-App-Token": config.appToken,
      "X-GateLM-End-User-Id": "customer_user_demo_live",
      "X-GateLM-Feature-Id": "support-reply",
      "X-GateLM-Request-Id": requestId
    },
    body: JSON.stringify(requestBody),
    cache: "no-store"
  });

  return {
    body: await readGatewayResponseBody(response),
    headers: response.headers,
    httpStatus: response.status,
    latencyMs: Date.now() - startedAt,
    requestBody: buildDisplayRequestBody(requestBody),
    requestHeaders: buildDisplayRequestHeaders(requestId),
    requestId
  };
}

function buildGatewayRequestBody(
  definition: LiveScenarioDefinition,
  scenarioId: CustomerDemoScenarioId
): CustomerDemoRequest["body"] {
  return {
    model: "auto",
    messages: [
      {
        role: "system",
        content: "You are a helpful customer support assistant."
      },
      {
        role: "user",
        content: definition.gatewayPrompt
      }
    ],
    max_tokens: 128,
    temperature: 0.2,
    stream: false,
    metadata: {
      demoScenario: scenarioId,
      source: "web-customer-demo"
    },
    gate_lm: {
      cache: {
        mode: "auto"
      },
      routing: {
        mode: "auto"
      },
      responseMetadata: true
    }
  };
}

function buildDisplayRequestBody(
  requestBody: CustomerDemoRequest["body"]
): CustomerDemoRequest["body"] {
  return {
    ...requestBody,
    messages: requestBody.messages.map((message) =>
      ({
        ...message,
        content: "<withheld>"
      })
    )
  };
}

async function readGatewayResponseBody(response: Response): Promise<JsonRecord> {
  const text = await response.text();

  if (!text.trim()) {
    return {
      error: {
        code: "empty_gateway_response",
        message: "Gateway returned an empty response.",
        request_id: response.headers.get("X-GateLM-Request-Id") ?? "",
        type: "gatelm_gateway_error"
      }
    };
  }

  const parsed = safeJsonParse(text);

  if (isJsonRecord(parsed)) {
    return parsed;
  }

  return {
    error: {
      code: "invalid_gateway_response",
      message: "Gateway returned a non-object JSON response.",
      request_id: response.headers.get("X-GateLM-Request-Id") ?? "",
      type: "gatelm_gateway_error"
    }
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function buildLiveExchange({
  allScenarios,
  gatewayResult,
  scenario,
  scenarioId,
  tenantId
}: {
  allScenarios: CustomerDemoExchange[];
  gatewayResult: GatewayCallResult;
  scenario: CustomerDemoExchange;
  scenarioId: CustomerDemoScenarioId;
  tenantId: string;
}): CustomerDemoExchange {
  const requestId = getGatewayRequestId(gatewayResult);
  const cacheStatus = getGatewayValue(gatewayResult, "cacheStatus", "X-GateLM-Cache-Status")
    ?? scenario.cacheStatus;
  const maskingAction = normalizeMaskingAction(
    getGatewayValue(gatewayResult, "maskingAction", "X-GateLM-Masking-Action")
  );
  const status = getGatewayStatus(gatewayResult);
  const actualScenarioId = status === "rate_limited" ? "rate-limited" : scenarioId;
  const displayScenario =
    allScenarios.find((item) => item.scenarioId === actualScenarioId) ?? scenario;
  const assistantMessage = getDisplayAssistantMessage(status, scenario.assistantMessage);
  const detectorSummary = getDetectorSummary(gatewayResult, actualScenarioId);
  const outcomeSummary = getOutcomeSummary({
    cacheStatus,
    gatewayResult,
    maskingAction,
    status
  });

  return {
    assistantMessage,
    cacheStatus,
    dashboardHref: `/tenants/${tenantId}/dashboard`,
    description: displayScenario.description,
    detectorSummary,
    httpStatus: gatewayResult.httpStatus,
    latencyMs: getGatewayLatencyMs(gatewayResult),
    maskingAction,
    outcomeSummary,
    providerCall: outcomeSummary.providerOutcome === "not_called" ? "skipped" : "called",
    request: {
      endpoint: "/v1/chat/completions",
      method: "POST",
      headers: gatewayResult.requestHeaders,
      body: gatewayResult.requestBody
    },
    requestId,
    requestLogHref: `/tenants/${tenantId}/request-logs/${requestId}`,
    response: {
      body: buildDisplayResponseBody(gatewayResult.body),
      headers: buildResponseHeaders(gatewayResult.headers),
      statusCode: gatewayResult.httpStatus
    },
    scenarioId: actualScenarioId,
    status,
    title: displayScenario.title
  };
}

function buildDisplayRequestHeaders(requestId: string): CustomerDemoHeader[] {
  return [
    {
      name: "X-GateLM-End-User-Id",
      value: "customer_user_demo_live"
    },
    {
      name: "X-GateLM-Feature-Id",
      value: "support-reply"
    },
    {
      name: "X-GateLM-Request-Id",
      value: requestId
    },
    {
      name: "Content-Type",
      value: "application/json"
    }
  ];
}

function buildResponseHeaders(headers: Headers): CustomerDemoHeader[] {
  return RESPONSE_HEADER_NAMES.map((name) => ({
    name,
    value: headers.get(name) ?? "not-set"
  }));
}

function buildDisplayResponseBody(body: JsonRecord): JsonRecord {
  const responseBody: JsonRecord = {
    body: "<withheld>"
  };

  if (isJsonRecord(body.gate_lm)) {
    responseBody.gate_lm = body.gate_lm;
  }

  if (isJsonRecord(body.error)) {
    responseBody.error = {
      code: getNestedString(body, ["error", "code"]) ?? "unknown",
      request_id: getNestedString(body, ["error", "request_id"]) ?? "",
      type: getNestedString(body, ["error", "type"]) ?? "gatelm_error"
    };
  }

  return responseBody;
}

function getGatewayRequestId(result: GatewayCallResult) {
  return (
    result.headers.get("X-GateLM-Request-Id")
    ?? getNestedString(result.body, ["gate_lm", "requestId"])
    ?? getNestedString(result.body, ["error", "request_id"])
    ?? result.requestId
  );
}

function getGatewayValue(result: GatewayCallResult, gateLMKey: string, headerName: string) {
  return result.headers.get(headerName) ?? getNestedString(result.body, ["gate_lm", gateLMKey]);
}

function getGatewayLatencyMs(result: GatewayCallResult) {
  return getNestedNumber(result.body, ["gate_lm", "latencyMs"]) ?? result.latencyMs;
}

function getGatewayStatus(result: GatewayCallResult): CustomerDemoExchange["status"] {
  const terminalStatus = getFirstNestedString(result.body, [
    ["gate_lm", "terminalStatus"],
    ["terminalStatus"]
  ]);

  if (
    terminalStatus === "success" ||
    terminalStatus === "blocked" ||
    terminalStatus === "rate_limited" ||
    terminalStatus === "failed" ||
    terminalStatus === "cancelled"
  ) {
    return terminalStatus;
  }

  const errorCode = getNestedString(result.body, ["error", "code"]);

  if (result.httpStatus === 429 || errorCode === "rate_limited") {
    return "rate_limited";
  }

  if (result.httpStatus === 403 && errorCode === "sensitive_data_blocked") {
    return "blocked";
  }

  if (result.httpStatus >= 200 && result.httpStatus < 300) {
    return "success";
  }

  return "failed";
}

function normalizeMaskingAction(value: string | undefined): CustomerDemoExchange["maskingAction"] {
  if (value === "redacted" || value === "blocked") {
    return value;
  }

  return "none";
}

function getDisplayAssistantMessage(status: CustomerDemoExchange["status"], fallback: string) {
  if (status === "success") {
    return "Gateway request completed successfully.";
  }

  if (status === "cache_hit") {
    return "Served from exact cache.";
  }

  if (status === "blocked") {
    return "Blocked before provider call.";
  }

  if (status === "rate_limited") {
    return "Rate limit applied before provider call.";
  }

  if (status === "error") {
    return "Gateway returned a sanitized error.";
  }

  return fallback;
}

function getDetectorSummary(
  result: GatewayCallResult,
  scenarioId: CustomerDemoScenarioId
): CustomerDemoExchange["detectorSummary"] {
  const fallback = LIVE_SCENARIOS[scenarioId];
  const detectorCategories =
    getFirstNestedStringArray(result.body, [
      ["gate_lm", "safetySummary", "detectorCategories"],
      ["safetySummary", "detectorCategories"],
      ["gate_lm", "domainOutcomes", "safety", "detectedTypes"],
      ["domainOutcomes", "safety", "detectedTypes"]
    ]) ?? fallback.detectorCategories;
  const detectedCount =
    getFirstNestedNumber(result.body, [
      ["gate_lm", "safetySummary", "detectedCount"],
      ["safetySummary", "detectedCount"],
      ["gate_lm", "domainOutcomes", "safety", "detectedCount"],
      ["domainOutcomes", "safety", "detectedCount"]
    ]) ?? fallback.detectedCount;

  return {
    detectedCount,
    detectorCategories
  };
}

function getOutcomeSummary({
  cacheStatus,
  gatewayResult,
  maskingAction,
  status
}: {
  cacheStatus: string;
  gatewayResult: GatewayCallResult;
  maskingAction: CustomerDemoExchange["maskingAction"];
  status: string;
}): CustomerDemoExchange["outcomeSummary"] {
  const safetyOutcome = getFirstNestedString(gatewayResult.body, [
    ["gate_lm", "safetySummary", "outcome"],
    ["safetySummary", "outcome"],
    ["gate_lm", "domainOutcomes", "safety", "outcome"],
    ["domainOutcomes", "safety", "outcome"]
  ]) ?? maskingActionFromSafety(maskingAction);
  const cacheOutcome = getFirstNestedString(gatewayResult.body, [
    ["gate_lm", "domainOutcomes", "cache", "outcome"],
    ["domainOutcomes", "cache", "outcome"]
  ]) ?? cacheOutcomeFromStatus(cacheStatus);
  const providerOutcome = getFirstNestedString(gatewayResult.body, [
    ["gate_lm", "domainOutcomes", "provider", "outcome"],
    ["domainOutcomes", "provider", "outcome"]
  ]) ?? providerOutcomeFromStatus(status, cacheOutcome);
  const streamingOutcome = getFirstNestedString(gatewayResult.body, [
    ["gate_lm", "domainOutcomes", "streaming", "outcome"],
    ["domainOutcomes", "streaming", "outcome"]
  ]) ?? "not_streaming";

  return {
    cacheOutcome,
    providerOutcome,
    safetyOutcome,
    streamingOutcome,
    terminalStatus: status
  };
}

function maskingActionFromSafety(maskingAction: CustomerDemoExchange["maskingAction"]) {
  if (maskingAction === "blocked" || maskingAction === "redacted") {
    return maskingAction;
  }

  return "passed";
}

function cacheOutcomeFromStatus(cacheStatus: string) {
  if (cacheStatus === "hit" || cacheStatus === "miss" || cacheStatus === "error") {
    return cacheStatus;
  }

  return "bypassed";
}

function providerOutcomeFromStatus(status: string, cacheOutcome: string) {
  if (cacheOutcome === "hit" || status === "blocked" || status === "rate_limited") {
    return "not_called";
  }

  return status === "success" ? "success" : "error";
}

function getNestedString(record: JsonRecord, path: string[]) {
  const value = getNestedValue(record, path);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNestedNumber(record: JsonRecord, path: string[]) {
  const value = getNestedValue(record, path);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getFirstNestedString(record: JsonRecord, paths: string[][]) {
  for (const path of paths) {
    const value = getNestedString(record, path);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getFirstNestedNumber(record: JsonRecord, paths: string[][]) {
  for (const path of paths) {
    const value = getNestedNumber(record, path);
    if (typeof value === "number") {
      return value;
    }
  }

  return undefined;
}

function getFirstNestedStringArray(record: JsonRecord, paths: string[][]) {
  for (const path of paths) {
    const value = getNestedValue(record, path);
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return value;
    }
  }

  return undefined;
}

function getNestedValue(record: JsonRecord, path: string[]): unknown {
  let current: unknown = record;

  for (const key of path) {
    if (!isJsonRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildRequestId(scenarioId: CustomerDemoScenarioId, suffix: string) {
  const safeScenarioId = scenarioId.replaceAll("-", "_");
  const entropy = crypto.randomUUID().replaceAll("-", "").slice(0, 10);

  return `request_web_demo_${safeScenarioId}_${Date.now()}_${suffix}_${entropy}`;
}
