import { NextResponse } from "next/server";
import {
  createChatConversation,
  createChatConversationMessage,
  updateChatConversation
} from "@/lib/control-plane/conversations-client";
import type { GatewayContextMessage } from "@/lib/control-plane/conversations-types";
import {
  resolveApplicationChatProfile,
  type ResolvedApplicationChatProfile
} from "@/lib/gateway/application-chat-profiles";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";
import type {
  CustomerDemoExchange,
  CustomerDemoHeader,
  CustomerDemoModel,
  CustomerDemoRequest,
  CustomerDemoScenarioId,
  CustomerDemoSurface
} from "@/lib/gateway/customer-demo-client";

type JsonRecord = Record<string, unknown>;

type GatewayCallResult = {
  body: JsonRecord;
  headers: Headers;
  httpStatus: number;
  latencyMs: number;
  contextRetentionEnabled: boolean;
  conversationId: string | null;
  requestBody: CustomerDemoRequest["body"];
  requestHeaders: CustomerDemoHeader[];
  requestId: string;
  streaming: CustomerDemoExchange["streaming"];
};

type LiveScenarioDefinition = {
  detectedTypes: string[];
  gatewayPrompt: string;
};

type GatewaySseSummary = {
  assistantContent: string;
  chunkCount: number;
  completed: boolean;
};

type GatewaySseDataResult = {
  content: string;
  done: boolean;
  hasValue: boolean;
  value: string;
};

type ProviderFailureMode = "error" | "timeout";

type ConversationGatewayContext = {
  contextRetentionEnabled: boolean;
  conversationId: string;
  messages: GatewayContextMessage[];
  userMessageId: string | null;
};

type RequestProfileResult =
  | {
      ok: true;
      profile: ResolvedApplicationChatProfile;
    }
  | {
      error: string;
      ok: false;
    };

type GatewayCallOptions = {
  contextRetentionEnabled?: boolean;
  conversationId?: string | null;
  message?: string;
  profile: ResolvedApplicationChatProfile;
  stream?: boolean;
  surface?: CustomerDemoSurface;
  userName?: string;
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
const APPLICATION_END_USER_ID = "customer_user_demo_live";
const DEFAULT_CONTEXT_RETENTION_ENABLED = true;
const DEFAULT_SYSTEM_MESSAGE = "You are a helpful customer support assistant.";

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
  const profileResult = await getRequestProfile(payload.profileId);

  if (!profileResult.ok) {
    return NextResponse.json({ error: profileResult.error }, { status: 400 });
  }

  const profile = profileResult.profile;
  const model = await getCustomerDemoLiveModel({ profileId: profile.id });

  if (payload.tenantId !== model.tenantId) {
    return NextResponse.json({ error: "Unknown tenant for customer demo." }, { status: 404 });
  }

  if (!isCustomerDemoScenarioId(payload.scenarioId)) {
    return NextResponse.json({ error: "Unknown customer demo scenario." }, { status: 400 });
  }

  const scenarioId = payload.scenarioId;
  const scenario = model.scenarios.find((item) => item.scenarioId === scenarioId);
  const streamRequested =
    payload.stream && (payload.surface !== "application" || (model.applicationChatStreamingEnabled ?? true));

  if (!scenario) {
    return NextResponse.json({ error: "Customer demo scenario is not configured." }, { status: 404 });
  }

  if (streamRequested && payload.surface === "application") {
    return streamLiveScenario({
      model,
      payload,
      profile,
      scenario,
      scenarioId
    });
  }

  try {
    const gatewayResult = await executeLiveScenario(
      scenarioId,
      streamRequested,
      payload.message,
      payload.surface,
      payload.conversationId,
      payload.contextRetentionEnabled,
      payload.userName,
      profile
    );

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

function streamLiveScenario({
  model,
  payload,
  profile,
  scenario,
  scenarioId
}: {
  model: CustomerDemoModel;
  payload: Awaited<ReturnType<typeof readRequestPayload>>;
  profile: ResolvedApplicationChatProfile;
  scenario: CustomerDemoExchange;
  scenarioId: CustomerDemoScenarioId;
}) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (scenarioId === "cache-hit") {
          await callGateway("cache-hit", "warmup", {
            message: payload.message,
            profile,
            surface: payload.surface,
            userName: payload.userName
          });
        }

        const gatewayResult = await callGatewayStreaming(
          scenarioId,
          "1",
          {
            contextRetentionEnabled: payload.contextRetentionEnabled,
            conversationId: payload.conversationId,
            message: payload.message,
            profile,
            stream: true,
            surface: payload.surface,
            userName: payload.userName
          },
          (content) => {
            enqueueSse(controller, encoder, "delta", { content });
          }
        );
        const exchange = buildLiveExchange({
          allScenarios: model.scenarios,
          gatewayResult,
          scenario,
          scenarioId,
          tenantId: model.tenantId
        });

        enqueueSse(controller, encoder, "exchange", { exchange });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gateway integration request failed.";
        enqueueSse(controller, encoder, "error", { error: message });
      } finally {
        enqueueSse(controller, encoder, "done", {});
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no"
    }
  });
}

async function readRequestPayload(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    contextRetentionEnabled?: unknown;
    conversationId?: unknown;
    message?: unknown;
    profileId?: unknown;
    scenarioId?: unknown;
    stream?: unknown;
    surface?: unknown;
    tenantId?: unknown;
    userName?: unknown;
  };

  return {
    message: normalizeUserMessage(payload.message),
    contextRetentionEnabled:
      typeof payload.contextRetentionEnabled === "boolean"
        ? payload.contextRetentionEnabled
        : DEFAULT_CONTEXT_RETENTION_ENABLED,
    conversationId:
      typeof payload.conversationId === "string" && payload.conversationId.trim()
        ? payload.conversationId.trim()
        : null,
    profileId: typeof payload.profileId === "string" ? payload.profileId : "",
    scenarioId: typeof payload.scenarioId === "string" ? payload.scenarioId : "",
    stream: payload.stream === true,
    surface: normalizeCustomerDemoSurface(payload.surface),
    tenantId: typeof payload.tenantId === "string" ? payload.tenantId : "",
    userName: normalizeEndUserId(payload.userName)
  };
}

function normalizeUserMessage(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const message = value.trim();

  return message.length > 0 ? message.slice(0, 2000) : undefined;
}

function normalizeEndUserId(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/[\r\n\t]+/g, " ").trim().replace(/\s+/g, " ");

  return normalized.length > 0 ? Array.from(normalized).slice(0, 160).join("") : undefined;
}

function isCustomerDemoScenarioId(value: string): value is CustomerDemoScenarioId {
  return Object.hasOwn(LIVE_SCENARIOS, value);
}

function normalizeCustomerDemoSurface(value: unknown): CustomerDemoSurface {
  return value === "application" ? "application" : "demo";
}

async function getRequestProfile(profileId: string): Promise<RequestProfileResult> {
  try {
    return {
      ok: true,
      profile: await resolveApplicationChatProfile(profileId)
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Application chat profile is invalid.",
      ok: false
    };
  }
}

async function executeLiveScenario(
  scenarioId: CustomerDemoScenarioId,
  stream: boolean,
  message: string | undefined,
  surface: CustomerDemoSurface,
  conversationId: string | null,
  contextRetentionEnabled: boolean | undefined,
  userName: string | undefined,
  profile: ResolvedApplicationChatProfile
) {
  if (scenarioId === "cache-hit") {
    await callGateway("cache-hit", "warmup", {
      contextRetentionEnabled,
      conversationId,
      message,
      profile,
      surface,
      userName
    });
    return callGateway("cache-hit", "hit", {
      contextRetentionEnabled,
      conversationId,
      message,
      profile,
      stream,
      surface,
      userName
    });
  }

  if (scenarioId === "rate-limited") {
    let latestResult: GatewayCallResult | null = null;
    const { rateLimitMaxAttempts } = getLiveGatewayConfig();

    // Keep the demo bounded; rate limit evidence should come from a low-limit demo config.
    for (let index = 0; index < rateLimitMaxAttempts; index += 1) {
      latestResult = await callGateway("rate-limited", String(index + 1), {
        contextRetentionEnabled,
        conversationId,
        message,
        profile,
        stream,
        surface,
        userName
      });

      if (latestResult.httpStatus === 429) {
        return latestResult;
      }
    }

    if (latestResult) {
      return latestResult;
    }
  }

  if (scenarioId === "provider-timeout") {
    return executeProviderFailureScenario(scenarioId, "timeout", profile, userName);
  }

  if (scenarioId === "provider-fallback") {
    return executeProviderFailureScenario(scenarioId, "error", profile, userName);
  }

  return callGateway(scenarioId, "1", {
    contextRetentionEnabled,
    conversationId,
    message,
    profile,
    stream,
    surface,
    userName
  });
}

async function executeProviderFailureScenario(
  scenarioId: CustomerDemoScenarioId,
  mode: ProviderFailureMode,
  profile: ResolvedApplicationChatProfile,
  userName: string | undefined
) {
  const config = getLiveGatewayConfig();

  await configureProviderFailureControl(mode);

  try {
    return await callGateway(scenarioId, mode, { profile, stream: false, userName });
  } finally {
    await resetProviderFailureControl(config).catch(() => undefined);
  }
}

async function callGateway(
  scenarioId: CustomerDemoScenarioId,
  requestIdSuffix: string,
  options: GatewayCallOptions
): Promise<GatewayCallResult> {
  const config = getLiveGatewayConfig({ apiKey: options.profile.apiKey });
  const definition = LIVE_SCENARIOS[scenarioId];
  const requestId = buildRequestId(scenarioId, requestIdSuffix);
  const conversationContext = await prepareConversationGatewayContext({
    definition,
    message: options.message,
    options,
    profile: options.profile,
    requestId
  });
  const requestBody = buildGatewayRequestBody(
    definition,
    scenarioId,
    options.stream === true,
    options.message,
    options.surface ?? "demo",
    config.applicationChatModel,
    config.applicationChatMaxTokens,
    conversationContext?.messages,
    options.userName
  );
  const startedAt = Date.now();
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-GateLM-End-User-Id": "customer_user_demo_live",
      "X-GateLM-Feature-Id": "support-reply",
      "X-GateLM-Request-Id": requestId
    },
    body: JSON.stringify(requestBody),
    cache: "no-store"
  });

  const responseText = await response.text();

  const body = buildGatewayResponseBody(response, responseText, requestBody.stream);
  await retainAssistantMessage({
    body,
    conversationContext,
    profile: options.profile,
    requestId,
    status: response.status
  });

  return {
    body,
    contextRetentionEnabled: conversationContext?.contextRetentionEnabled ?? false,
    conversationId: conversationContext?.conversationId ?? options.conversationId ?? null,
    headers: response.headers,
    httpStatus: response.status,
    latencyMs: Date.now() - startedAt,
    requestBody: buildDisplayRequestBody(requestBody),
    requestHeaders: buildDisplayRequestHeaders(requestId),
    requestId,
    streaming: buildGatewayStreamingSummary(response, responseText, requestBody.stream)
  };
}

async function callGatewayStreaming(
  scenarioId: CustomerDemoScenarioId,
  requestIdSuffix: string,
  options: GatewayCallOptions,
  onDelta: (content: string) => void
): Promise<GatewayCallResult> {
  const config = getLiveGatewayConfig({ apiKey: options.profile.apiKey });
  const definition = LIVE_SCENARIOS[scenarioId];
  const requestId = buildRequestId(scenarioId, requestIdSuffix);
  const conversationContext = await prepareConversationGatewayContext({
    definition,
    message: options.message,
    options,
    profile: options.profile,
    requestId
  });
  const requestBody = buildGatewayRequestBody(
    definition,
    scenarioId,
    options.stream === true,
    options.message,
    options.surface ?? "application",
    config.applicationChatModel,
    config.applicationChatMaxTokens,
    conversationContext?.messages,
    options.userName
  );
  const startedAt = Date.now();
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-GateLM-End-User-Id": "customer_user_demo_live",
      "X-GateLM-Feature-Id": "support-reply",
      "X-GateLM-Request-Id": requestId
    },
    body: JSON.stringify(requestBody),
    cache: "no-store"
  });

  if (!response.body || !isEventStreamResponse(response)) {
    const responseText = await response.text();
    const body = buildGatewayResponseBody(response, responseText, requestBody.stream);
    await retainAssistantMessage({
      body,
      conversationContext,
      profile: options.profile,
      requestId,
      status: response.status
    });

    return {
      body,
      contextRetentionEnabled: conversationContext?.contextRetentionEnabled ?? false,
      conversationId: conversationContext?.conversationId ?? options.conversationId ?? null,
      headers: response.headers,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      requestBody: buildDisplayRequestBody(requestBody),
      requestHeaders: buildDisplayRequestHeaders(requestId),
      requestId,
      streaming: buildGatewayStreamingSummary(response, responseText, requestBody.stream)
    };
  }

  const summary = await readGatewaySseStream(response, onDelta);
  const body = buildGatewayStreamingResponseBody(summary);
  await retainAssistantMessage({
    assistantContent: summary.assistantContent,
    body,
    conversationContext,
    profile: options.profile,
    requestId,
    status: response.status
  });

  return {
    body,
    contextRetentionEnabled: conversationContext?.contextRetentionEnabled ?? false,
    conversationId: conversationContext?.conversationId ?? options.conversationId ?? null,
    headers: response.headers,
    httpStatus: response.status,
    latencyMs: Date.now() - startedAt,
    requestBody: buildDisplayRequestBody(requestBody),
    requestHeaders: buildDisplayRequestHeaders(requestId),
    requestId,
    streaming: {
      completed: summary.completed,
      contentType: response.headers.get("Content-Type"),
      chunkCount: summary.chunkCount,
      requested: true
    }
  };
}

function buildGatewayRequestBody(
  definition: LiveScenarioDefinition,
  scenarioId: CustomerDemoScenarioId,
  stream: boolean,
  message: string | undefined,
  surface: CustomerDemoSurface,
  applicationChatModel: string,
  applicationChatMaxTokens: number,
  contextMessages?: GatewayContextMessage[],
  endUserId?: string
): CustomerDemoRequest["body"] {
  return {
    model: surface === "application" ? applicationChatModel : "auto",
    messages: contextMessages ?? [
      {
        role: "system",
        content: DEFAULT_SYSTEM_MESSAGE
      },
      {
        role: "user",
        content: message ?? definition.gatewayPrompt
      }
    ],
    max_tokens: surface === "application" ? applicationChatMaxTokens : 128,
    temperature: 0.2,
    stream,
    metadata: buildGatewayRequestMetadata(scenarioId, surface, endUserId),
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

function buildGatewayRequestMetadata(
  scenarioId: CustomerDemoScenarioId,
  surface: CustomerDemoSurface,
  endUserId: string | undefined
): Record<string, string> {
  const metadata: Record<string, string> = {
    demoScenario: scenarioId,
    source: surface === "application" ? "web-application-chat" : "web-customer-demo"
  };

  if (endUserId) {
    metadata.endUserId = endUserId;
  }

  return metadata;
}

async function prepareConversationGatewayContext({
  definition,
  message,
  options,
  profile,
  requestId
}: {
  definition: LiveScenarioDefinition;
  message: string | undefined;
  options: {
    contextRetentionEnabled?: boolean;
    conversationId?: string | null;
    surface?: CustomerDemoSurface;
    userName?: string;
  };
  profile: ResolvedApplicationChatProfile;
  requestId: string;
}): Promise<ConversationGatewayContext | null> {
  if ((options.surface ?? "demo") !== "application") {
    return null;
  }

  const contextRetentionEnabled =
    options.contextRetentionEnabled ?? DEFAULT_CONTEXT_RETENTION_ENABLED;
  if (!contextRetentionEnabled) {
    return null;
  }

  try {
    const model = await getCustomerDemoLiveModel({ profileId: profile.id });
    const conversation =
      options.conversationId
        ? await updateExistingConversation({
            contextRetentionEnabled,
            conversationId: options.conversationId,
            profile
          })
        : await createApplicationConversation({
            contextRetentionEnabled,
            profile,
            userName: options.userName
          });

    const messageResult = await createChatConversationMessage({
      applicationId: model.applicationId,
      content: message ?? definition.gatewayPrompt,
      conversationId: conversation.id,
      projectId: model.projectId,
      requestId,
      role: "user",
      systemMessage: DEFAULT_SYSTEM_MESSAGE,
      tenantId: model.tenantId
    });

    if (!messageResult.ok) {
      return null;
    }

    return {
      contextRetentionEnabled: messageResult.data.context.contextRetentionEnabled,
      conversationId: conversation.id,
      messages: withRawCurrentUserMessage(
        messageResult.data.context.messages,
        message ?? definition.gatewayPrompt
      ),
      userMessageId: messageResult.data.message.id
    };
  } catch {
    return null;
  }
}

function withRawCurrentUserMessage(
  messages: GatewayContextMessage[] | null | undefined,
  currentContent: string
): GatewayContextMessage[] {
  const normalizedCurrentContent = currentContent.trim();
  if (!normalizedCurrentContent) {
    return messages ?? [];
  }

  const nextMessages = (messages ?? []).map((message) => ({ ...message }));
  const currentMessageIndex = nextMessages.length - 1;
  const currentMessage = nextMessages[currentMessageIndex];

  if (currentMessage?.role === "user") {
    nextMessages[currentMessageIndex] = {
      ...currentMessage,
      content: normalizedCurrentContent
    };
    return nextMessages;
  }

  return [
    ...nextMessages,
    {
      content: normalizedCurrentContent,
      role: "user"
    }
  ];
}

async function createApplicationConversation({
  contextRetentionEnabled,
  profile,
  userName
}: {
  contextRetentionEnabled: boolean;
  profile: ResolvedApplicationChatProfile;
  userName?: string;
}): Promise<{ contextRetentionEnabled: boolean; id: string }> {
  const model = await getCustomerDemoLiveModel({ profileId: profile.id });
  const conversation = await createChatConversation({
    applicationId: model.applicationId,
    contextRetentionEnabled,
    endUserId: userName ?? APPLICATION_END_USER_ID,
    projectId: model.projectId,
    tenantId: model.tenantId
  });

  if (!conversation.ok) {
    throw new Error(conversation.error);
  }

  return conversation.data;
}

async function updateExistingConversation({
  contextRetentionEnabled,
  conversationId,
  profile
}: {
  contextRetentionEnabled: boolean;
  conversationId: string;
  profile: ResolvedApplicationChatProfile;
}): Promise<{ contextRetentionEnabled: boolean; id: string }> {
  const model = await getCustomerDemoLiveModel({ profileId: profile.id });
  const conversation = await updateChatConversation({
    applicationId: model.applicationId,
    contextRetentionEnabled,
    conversationId,
    projectId: model.projectId,
    tenantId: model.tenantId
  });

  if (!conversation.ok) {
    throw new Error(conversation.error);
  }

  return conversation.data;
}

async function retainAssistantMessage({
  assistantContent,
  body,
  conversationContext,
  profile,
  requestId,
  status
}: {
  assistantContent?: string;
  body: JsonRecord;
  conversationContext: ConversationGatewayContext | null;
  profile: ResolvedApplicationChatProfile;
  requestId: string;
  status: number;
}) {
  if (!conversationContext || status < 200 || status >= 300) {
    return;
  }

  const content = assistantContent ?? getAssistantContent(body);

  if (!content) {
    return;
  }

  const model = await getCustomerDemoLiveModel({ profileId: profile.id });
  await createChatConversationMessage({
    applicationId: model.applicationId,
    content,
    conversationId: conversationContext.conversationId,
    parentMessageId: conversationContext.userMessageId ?? undefined,
    projectId: model.projectId,
    requestId,
    role: "assistant",
    tenantId: model.tenantId
  }).catch(() => undefined);
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

    return buildGatewayStreamingResponseBody(summary);
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

function buildGatewayStreamingResponseBody(summary: GatewaySseSummary): JsonRecord {
  return {
    choices: summary.assistantContent
      ? [
          {
            message: {
              content: summary.assistantContent,
              role: "assistant"
            }
          }
        ]
      : [],
    streaming: {
      chunkCount: summary.chunkCount,
      completed: summary.completed,
      contentWithheld: true
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
  const contentParts: string[] = [];
  let chunkCount = 0;
  let completed = false;

  for (const line of text.split(/\r?\n/)) {
    const result = readGatewaySseDataLine(line);

    if (!result.hasValue) {
      continue;
    }

    if (result.done) {
      completed = true;
      continue;
    }

    chunkCount += 1;

    if (result.content) {
      contentParts.push(result.content);
    }
  }

  return {
    assistantContent: contentParts.join("").trim(),
    chunkCount,
    completed
  };
}

async function readGatewaySseStream(
  response: Response,
  onDelta: (content: string) => void
): Promise<GatewaySseSummary> {
  const reader = response.body?.getReader();

  if (!reader) {
    return {
      assistantContent: "",
      chunkCount: 0,
      completed: false
    };
  }

  const decoder = new TextDecoder();
  const contentParts: string[] = [];
  let buffer = "";
  let chunkCount = 0;
  let completed = false;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const result = readGatewaySseFrame(frame);

      if (!result.hasValue) {
        continue;
      }

      if (result.done) {
        completed = true;
        continue;
      }

      chunkCount += 1;

      if (result.content) {
        contentParts.push(result.content);
        onDelta(result.content);
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    const result = readGatewaySseFrame(buffer);

    if (result.done) {
      completed = true;
    } else if (result.hasValue) {
      chunkCount += 1;

      if (result.content) {
        contentParts.push(result.content);
        onDelta(result.content);
      }
    }
  }

  return {
    assistantContent: contentParts.join("").trim(),
    chunkCount,
    completed
  };
}

function readGatewaySseFrame(frame: string): GatewaySseDataResult {
  const lines = frame.split(/\r?\n/);
  let content = "";
  let done = false;
  let hasValue = false;
  let value = "";

  for (const line of lines) {
    const result = readGatewaySseDataLine(line);
    if (!result.hasValue) {
      continue;
    }

    hasValue = true;
    done = done || result.done;
    content += result.content;
    value = result.value;
  }

  return {
    content,
    done,
    hasValue,
    value
  };
}

function readGatewaySseDataLine(line: string): GatewaySseDataResult {
  if (!line.startsWith("data:")) {
    return {
      content: "",
      done: false,
      hasValue: false,
      value: ""
    };
  }

  return parseGatewaySseData(stripSingleLeadingSseSpace(line.slice("data:".length)));
}

function parseGatewaySseData(value: string): GatewaySseDataResult {
  if (!value) {
    return {
      content: "",
      done: false,
      hasValue: false,
      value: ""
    };
  }

  if (value === "[DONE]") {
    return {
      content: "",
      done: true,
      hasValue: true,
      value
    };
  }

  const parsed = safeJsonParse(value);

  return {
    content: getStreamingChunkContent(parsed),
    done: false,
    hasValue: true,
    value
  };
}

function stripSingleLeadingSseSpace(value: string) {
  return value.startsWith(" ") ? value.slice(1) : value;
}

function enqueueSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  payload: unknown
) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  );
}

function getStreamingChunkContent(value: unknown) {
  if (!isJsonRecord(value) || !Array.isArray(value.choices)) {
    return "";
  }

  return value.choices
    .map((choice) => {
      if (!isJsonRecord(choice)) {
        return "";
      }

      const delta = choice.delta;
      if (isJsonRecord(delta) && typeof delta.content === "string") {
        return delta.content;
      }

      const message = choice.message;
      if (isJsonRecord(message) && typeof message.content === "string") {
        return message.content;
      }

      return typeof choice.text === "string" ? choice.text : "";
    })
    .join("");
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
  const assistantMessage = getDisplayAssistantMessage(
    status,
    gatewayResult.body,
    scenario.assistantMessage
  );

  return {
    assistantMessage,
    cacheStatus,
    contextRetentionEnabled: gatewayResult.contextRetentionEnabled,
    conversationId: gatewayResult.conversationId,
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

  if (isBlockedGatewayError(result.httpStatus, errorCode)) {
    return "blocked";
  }

  if (result.httpStatus >= 200 && result.httpStatus < 300) {
    return "success";
  }

  return "failed";
}

function isBlockedGatewayError(httpStatus: number, errorCode: string | undefined) {
  if (httpStatus !== 401 && httpStatus !== 403) {
    return false;
  }

  return (
    errorCode === "budget_blocked" ||
    errorCode === "invalid_api_key" ||
    errorCode === "invalid_app_token" ||
    errorCode === "scope_mismatch" ||
    errorCode === "sensitive_data_blocked"
  );
}

function normalizeMaskingAction(value: string | undefined): CustomerDemoExchange["maskingAction"] {
  if (value === "redacted" || value === "blocked") {
    return value;
  }

  return "none";
}

function getDisplayAssistantMessage(
  status: CustomerDemoExchange["status"],
  body: JsonRecord,
  fallback: string
) {
  if (status === "success") {
    return getAssistantContent(body) ?? "Gateway request completed successfully.";
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

  if (status === "error" || status === "failed") {
    return "Gateway returned a sanitized error.";
  }

  return fallback;
}

function getAssistantContent(body: JsonRecord) {
  const choices = body.choices;

  if (!Array.isArray(choices)) {
    return undefined;
  }

  for (const choice of choices) {
    if (!isJsonRecord(choice)) {
      continue;
    }

    const message = choice.message;

    if (isJsonRecord(message)) {
      const content = message.content;

      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
    }

    const text = choice.text;

    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }

  return undefined;
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
