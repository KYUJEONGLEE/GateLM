import { NextResponse } from "next/server";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";
import type {
  CustomerDemoExchange,
  CustomerDemoHeader,
  CustomerDemoRequest,
  CustomerDemoScenarioId
} from "@/lib/gateway/customer-demo-client";

type JsonRecord = Record<string, unknown>;

type GatewayCallResult = {
  body: JsonRecord;
  headers: Headers;
  httpStatus: number;
  latencyMs: number;
  requestBody: CustomerDemoRequest["body"];
  requestHeaders: CustomerDemoHeader[];
  requestId: string;
  streaming: CustomerDemoExchange["streaming"];
};

type LiveScenarioDefinition = {
  detectedTypes: string[];
  gatewayPrompt: string;
};

type ProviderFailureMode = "error" | "timeout";

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
    detectedTypes: [],
    gatewayPrompt: SAFE_PROMPT
  },
  "cache-hit": {
    detectedTypes: [],
    gatewayPrompt: SAFE_PROMPT
  },
  redacted: {
    detectedTypes: ["email", "phone_number"],
    gatewayPrompt:
      "Write a support note to minji.kim@example.test and ask them to call 010-0000-1234."
  },
  blocked: {
    detectedTypes: ["credential"],
    gatewayPrompt:
      "Summarize this synthetic config: api_key=test_secret_token_redacted_for_demo_only_abcdef1234567890"
  },
  "rate-limited": {
    detectedTypes: [],
    gatewayPrompt: "Write one more local stack response after quota is exhausted."
  },
  "provider-timeout": {
    detectedTypes: [],
    gatewayPrompt: "Write a short safe provider timeout fallback response."
  },
  "provider-fallback": {
    detectedTypes: [],
    gatewayPrompt: "Write a short safe provider error fallback response."
  }
};

export async function POST(request: Request) {
  const payload = await readRequestPayload(request);
  const model = getCustomerDemoLiveModel();

  if (payload.tenantId !== model.tenantId) {
    return NextResponse.json({ error: "Unknown tenant for customer demo." }, { status: 404 });
  }

  if (!isCustomerDemoScenarioId(payload.scenarioId)) {
    return NextResponse.json({ error: "Unknown customer demo scenario." }, { status: 400 });
  }

  const scenario = model.scenarios.find((item) => item.scenarioId === payload.scenarioId);

  if (!scenario) {
    return NextResponse.json({ error: "Customer demo scenario is not configured." }, { status: 404 });
  }

  try {
    const gatewayResult = await executeLiveScenario(payload.scenarioId, payload.stream);

    return NextResponse.json({
      exchange: buildLiveExchange({
        allScenarios: model.scenarios,
        gatewayResult,
        scenario,
        scenarioId: payload.scenarioId,
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
    stream?: unknown;
    tenantId?: unknown;
  };

  return {
    scenarioId: typeof payload.scenarioId === "string" ? payload.scenarioId : "",
    stream: payload.stream === true,
    tenantId: typeof payload.tenantId === "string" ? payload.tenantId : ""
  };
}

function isCustomerDemoScenarioId(value: string): value is CustomerDemoScenarioId {
  return Object.hasOwn(LIVE_SCENARIOS, value);
}

async function executeLiveScenario(scenarioId: CustomerDemoScenarioId, stream: boolean) {
  if (scenarioId === "cache-hit") {
    await callGateway("cache-hit", "warmup");
    return callGateway("cache-hit", "hit", { stream });
  }

  if (scenarioId === "rate-limited") {
    let latestResult: GatewayCallResult | null = null;
    const { rateLimitMaxAttempts } = getLiveGatewayConfig();

    // Keep the demo bounded; rate limit evidence should come from a low-limit demo config.
    for (let index = 0; index < rateLimitMaxAttempts; index += 1) {
      latestResult = await callGateway("rate-limited", String(index + 1), { stream });

      if (latestResult.httpStatus === 429) {
        return latestResult;
      }
    }

    if (latestResult) {
      return latestResult;
    }
  }

  if (scenarioId === "provider-timeout") {
    return executeProviderFailureScenario(scenarioId, "timeout");
  }

  if (scenarioId === "provider-fallback") {
    return executeProviderFailureScenario(scenarioId, "error");
  }

  return callGateway(scenarioId, "1", { stream });
}

async function executeProviderFailureScenario(
  scenarioId: CustomerDemoScenarioId,
  mode: ProviderFailureMode
) {
  const config = getLiveGatewayConfig();

  await configureProviderFailureControl(mode);

  try {
    return await callGateway(scenarioId, mode, { stream: false });
  } finally {
    await resetProviderFailureControl(config).catch(() => undefined);
  }
}

async function callGateway(
  scenarioId: CustomerDemoScenarioId,
  requestIdSuffix: string,
  options: { stream?: boolean } = {}
): Promise<GatewayCallResult> {
  const config = getLiveGatewayConfig();
  const definition = LIVE_SCENARIOS[scenarioId];
  const requestId = buildRequestId(scenarioId, requestIdSuffix);
  const requestBody = buildGatewayRequestBody(definition, scenarioId, options.stream === true);
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

  const responseText = await response.text();

  return {
    body: buildGatewayResponseBody(response, responseText, requestBody.stream),
    headers: response.headers,
    httpStatus: response.status,
    latencyMs: Date.now() - startedAt,
    requestBody: buildDisplayRequestBody(requestBody),
    requestHeaders: buildDisplayRequestHeaders(requestId),
    requestId,
    streaming: buildGatewayStreamingSummary(response, responseText, requestBody.stream)
  };
}

function buildGatewayRequestBody(
  definition: LiveScenarioDefinition,
  scenarioId: CustomerDemoScenarioId,
  stream: boolean
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
    stream,
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

async function configureProviderFailureControl(mode: ProviderFailureMode) {
  const config = getLiveGatewayConfig();
  const response = await fetch(`${config.providerFailureControlUrl}/__mock/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      failModels: config.providerFailureModels,
      mode
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Provider failure control is unavailable.");
  }
}

async function resetProviderFailureControl(config = getLiveGatewayConfig()) {
  await fetch(`${config.providerFailureControlUrl}/__mock/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      failModels: [],
      mode: "off"
    }),
    cache: "no-store"
  });
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

function buildGatewayResponseBody(
  response: Response,
  text: string,
  streamRequested: boolean
): JsonRecord {
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

  if (streamRequested && isEventStreamResponse(response)) {
    const summary = parseGatewaySseSummary(text);

    return {
      streaming: {
        chunkCount: summary.chunkCount,
        completed: summary.completed,
        contentWithheld: true
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

function buildGatewayStreamingSummary(
  response: Response,
  text: string,
  requested: boolean
): CustomerDemoExchange["streaming"] {
  if (!requested) {
    return {
      completed: null,
      contentType: response.headers.get("Content-Type"),
      chunkCount: null,
      requested: false
    };
  }

  const summary = isEventStreamResponse(response)
    ? parseGatewaySseSummary(text)
    : {
        chunkCount: 0,
        completed: false
      };

  return {
    completed: summary.completed,
    contentType: response.headers.get("Content-Type"),
    chunkCount: summary.chunkCount,
    requested: true
  };
}

function isEventStreamResponse(response: Response) {
  return response.headers.get("Content-Type")?.includes("text/event-stream") ?? false;
}

function parseGatewaySseSummary(text: string) {
  let chunkCount = 0;
  let completed = false;

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const value = line.slice("data:".length).trim();

    if (value === "[DONE]") {
      completed = true;
      continue;
    }

    if (value) {
      chunkCount += 1;
    }
  }

  return {
    chunkCount,
    completed
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

  return {
    assistantMessage,
    cacheStatus,
    description: displayScenario.description,
    detectedTypes: LIVE_SCENARIOS[actualScenarioId].detectedTypes,
    httpStatus: gatewayResult.httpStatus,
    latencyMs: getGatewayLatencyMs(gatewayResult),
    maskingAction,
    providerCall: status === "success" && cacheStatus !== "hit" ? "called" : "skipped",
    request: {
      endpoint: "/v1/chat/completions",
      method: "POST",
      headers: gatewayResult.requestHeaders,
      body: gatewayResult.requestBody
    },
    requestId,
    requestLogHref: `/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(requestId)}`,
    response: {
      body: buildDisplayResponseBody(gatewayResult.body),
      headers: buildResponseHeaders(gatewayResult.headers),
      statusCode: gatewayResult.httpStatus
    },
    scenarioId: actualScenarioId,
    status,
    streaming: gatewayResult.streaming,
    title: displayScenario.title
  };
}

function buildDisplayRequestHeaders(requestId: string): CustomerDemoHeader[] {
  return [
    {
      name: "Authorization",
      value: "Bearer <redacted>"
    },
    {
      name: "X-GateLM-App-Token",
      value: "<redacted>"
    },
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

function getNestedString(record: JsonRecord, path: string[]) {
  const value = getNestedValue(record, path);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNestedNumber(record: JsonRecord, path: string[]) {
  const value = getNestedValue(record, path);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
