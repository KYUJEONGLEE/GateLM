import credentialLifecycleFixture from "../../../../../docs/v1.0.0/fixtures/credential-lifecycle.fixture.json";
import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import type {
  CustomerDemoExchange,
  CustomerDemoHeader,
  CustomerDemoModel,
  CustomerDemoRequest,
  CustomerDemoScenarioId
} from "@/lib/gateway/customer-demo-client";
import { normalizeRoutingCategory } from "@/lib/gateway/live-observability-contract";

type RuntimeConfigFixture = {
  runtimeConfig: {
    tenantId: string;
    projectId: string;
    applicationId: string;
  };
};

type CredentialListItem = {
  credentialId: string;
  prefix: string;
  last4: string;
  scopes?: string[] | null;
  status: string;
};

type CredentialLifecycleFixture = {
  credentialLifecycle: {
    apiKey: {
      listItemExample: CredentialListItem;
    };
    appToken: {
      listItemExample: CredentialListItem;
    };
  };
};

type ScenarioConfig = {
  assistantMessage: string;
  description: string;
  metadata: Record<string, string>;
  recordId: string;
  scenarioId: CustomerDemoScenarioId;
  title: string;
};

type CustomerDemoFixtureRecord = {
  applicationId: string;
  cacheStatus: string;
  cacheType: string;
  completionTokens: number;
  costMicroUsd: number;
  createdAt: string;
  endUserId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  featureId: string | null;
  httpStatus: number;
  latencyMs: number;
  maskingAction: "none" | "redacted" | "blocked";
  maskingDetectedTypes: string[];
  projectId: string;
  promptCategory: string;
  promptTokens: number;
  providerLatencyMs: number | null;
  requestId: string;
  requestedModel: string;
  routingReason: string | null;
  status: string;
  stream: boolean;
  tenantId: string;
  totalTokens: number;
};

const scenarioConfigs: ScenarioConfig[] = [
  {
    assistantMessage: "Request completed.",
    description: "Allowed request through Gateway governance with exact cache miss.",
    metadata: {
      customerTicketId: "ticket-safe-001",
      requestPath: "standard"
    },
    recordId: "request_v1_demo_safe_success_001",
    scenarioId: "safe",
    title: "Safe request"
  },
  {
    assistantMessage: "Sensitive values were redacted.",
    description: "Rule-based safety redacts contact data before provider call.",
    metadata: {
      customerTicketId: "ticket-redacted-003",
      requestPath: "redaction"
    },
    recordId: "request_v1_demo_redacted_003",
    scenarioId: "redacted",
    title: "Redaction"
  },
  {
    assistantMessage: "Request blocked.",
    description: "Credential-like content is blocked before routing, cache, and provider.",
    metadata: {
      customerTicketId: "ticket-blocked-004",
      requestPath: "blocked"
    },
    recordId: "request_v1_demo_blocked_004",
    scenarioId: "blocked",
    title: "Blocked"
  },
  {
    assistantMessage: "Cached answer returned.",
    description: "Same safe request resolves to exact cache hit and provider bypass.",
    metadata: {
      customerTicketId: "ticket-cache-hit-002",
      requestPath: "cache-hit"
    },
    recordId: "request_v1_demo_cache_hit_002",
    scenarioId: "cache-hit",
    title: "Cache hit"
  },
  {
    assistantMessage:
      "No assistant reply was generated because the application exceeded its fixed-window limit.",
    description: "Application-scoped rate limit stops the request before provider cost.",
    metadata: {
      customerTicketId: "ticket-rate-limited-005",
      demoScenario: "rate-limited"
    },
    recordId: "request_v1_demo_rate_limited_005",
    scenarioId: "rate-limited",
    title: "Rate limit"
  }
];

function displaySecret(prefix: string, last4: string) {
  return `${prefix}<redacted>${last4}`;
}

function formatEstimatedCost(costMicroUsd: number) {
  return (costMicroUsd / 1_000_000).toFixed(6);
}

function buildRequestHeaders({
  apiKey,
  record
}: {
  apiKey: CredentialListItem;
  record: CustomerDemoFixtureRecord;
}): CustomerDemoHeader[] {
  return [
    {
      name: "Authorization",
      value: `Bearer ${displaySecret(apiKey.prefix, apiKey.last4)}`
    },
    {
      name: "X-GateLM-End-User-Id",
      value: record.endUserId ?? "not-set"
    },
    {
      name: "X-GateLM-Feature-Id",
      value: record.featureId ?? "not-set"
    },
    {
      name: "Content-Type",
      value: "application/json"
    }
  ];
}

function buildResponseHeaders(record: CustomerDemoFixtureRecord): CustomerDemoHeader[] {
  return [
    {
      name: "X-GateLM-Request-Id",
      value: record.requestId
    },
    {
      name: "X-GateLM-Cache-Status",
      value: record.cacheStatus
    },
    {
      name: "X-GateLM-Cache-Type",
      value: record.cacheType
    },
    {
      name: "X-GateLM-Masking-Action",
      value: record.maskingAction
    },
    {
      name: "X-GateLM-Execution-Mode",
      value: record.httpStatus < 400 ? "mock" : "not-executed"
    },
    {
      name: "X-GateLM-Estimated-Cost-Usd",
      value: formatEstimatedCost(record.costMicroUsd)
    }
  ];
}

function buildRequestBody(
  config: ScenarioConfig,
  record: CustomerDemoFixtureRecord
): CustomerDemoRequest["body"] {
  return {
    model: record.requestedModel ?? "auto",
    messages: [
      {
        role: "system",
        content: "<withheld>"
      },
      {
        role: "user",
        content: "<withheld>"
      }
    ],
    max_tokens: 128,
    temperature: 0.2,
    stream: false,
    metadata: config.metadata,
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

function buildResponseBody(config: ScenarioConfig, record: CustomerDemoFixtureRecord) {
  if (record.httpStatus >= 400) {
    return {
      error: {
        message: record.errorMessage ?? "Gateway request failed.",
        type: "gatelm_gateway_error",
        param: null,
        code: record.errorCode ?? "gateway_error",
        request_id: record.requestId
      }
    };
  }

  return {
    id: `chatcmpl_${record.requestId}`,
    object: "chat.completion",
    created: Math.floor(Date.parse(record.createdAt) / 1000),
    model: record.requestedModel ?? "auto",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: config.assistantMessage
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: record.promptTokens,
      completion_tokens: record.completionTokens,
      total_tokens: record.totalTokens
    },
    gate_lm: {
      requestId: record.requestId,
      tenantId: record.tenantId,
      projectId: record.projectId,
      applicationId: record.applicationId,
      requestedModel: record.requestedModel,
      category: normalizeRoutingCategory(record.promptCategory),
      difficulty: "simple",
      modelRef: null,
      executionMode: "mock",
      cacheStatus: record.cacheStatus,
      routingReason: record.routingReason,
      maskingAction: record.maskingAction,
      estimatedCostUsd: formatEstimatedCost(record.costMicroUsd),
      latencyMs: record.latencyMs
    }
  };
}

function buildExchange({
  apiKey,
  config,
  record
}: {
  apiKey: CredentialListItem;
  config: ScenarioConfig;
  record: CustomerDemoFixtureRecord;
}): CustomerDemoExchange {
  const request: CustomerDemoRequest = {
    endpoint: "/v1/chat/completions",
    method: "POST",
    headers: buildRequestHeaders({ apiKey, record }),
    body: buildRequestBody(config, record)
  };

  return {
    assistantMessage: config.assistantMessage,
    cacheStatus: record.cacheStatus,
    contextRetentionEnabled: false,
    conversationId: null,
    description: config.description,
    detectedTypes: record.maskingDetectedTypes ?? [],
    httpStatus: record.httpStatus,
    latencyMs: record.latencyMs,
    maskingAction: record.maskingAction,
    providerCall: record.providerLatencyMs == null ? "skipped" : "called",
    request,
    requestId: record.requestId,
    requestLogHref: `/tenants/${record.tenantId}/request-logs?requestId=${encodeURIComponent(record.requestId)}`,
    response: {
      body: buildResponseBody(config, record),
      headers: buildResponseHeaders(record),
      statusCode: record.httpStatus
    },
    scenarioId: config.scenarioId,
    status: record.status,
    streaming: {
      completed: record.stream ? true : null,
      contentType: record.stream ? "text/event-stream" : null,
      chunkCount: record.stream ? 0 : null,
      requested: record.stream
    },
    title: config.title
  };
}

export function getCustomerDemoModel(): CustomerDemoModel {
  const runtime = runtimeConfigFixture as RuntimeConfigFixture;
  const credentials = credentialLifecycleFixture as CredentialLifecycleFixture;
  const records = scenarioConfigs.map((config, index) =>
    buildFixtureRecord(config, runtime.runtimeConfig, index)
  );

  return {
    applicationId: runtime.runtimeConfig.applicationId,
    integrationMode: "fixture",
    projectId: runtime.runtimeConfig.projectId,
    scenarios: scenarioConfigs.map((config, index) => {
      const record = records[index];
      return buildExchange({
        apiKey: credentials.credentialLifecycle.apiKey.listItemExample,
        config,
        record
      });
    }),
    surface: "demo",
    tenantId: runtime.runtimeConfig.tenantId
  };
}

function buildFixtureRecord(
  config: ScenarioConfig,
  runtime: RuntimeConfigFixture["runtimeConfig"],
  index: number
): CustomerDemoFixtureRecord {
  const terminal = fixtureTerminalState(config.scenarioId);
  const promptTokens = terminal.httpStatus < 400 ? 24 : 0;
  const completionTokens = terminal.httpStatus < 400 ? 16 : 0;

  return {
    applicationId: runtime.applicationId,
    cacheStatus: terminal.cacheStatus,
    cacheType: terminal.cacheStatus === "hit" || terminal.cacheStatus === "miss" ? "exact" : "none",
    completionTokens,
    costMicroUsd: terminal.providerLatencyMs === null ? 0 : 1,
    createdAt: new Date(Date.UTC(2026, 6, 13, 0, index, 0)).toISOString(),
    endUserId: "customer_fixture_user",
    errorCode: terminal.errorCode,
    errorMessage: terminal.errorMessage,
    featureId: "support-reply",
    httpStatus: terminal.httpStatus,
    latencyMs: terminal.providerLatencyMs ?? 12,
    maskingAction: terminal.maskingAction,
    maskingDetectedTypes: terminal.maskingAction === "redacted" ? ["email"] : [],
    projectId: runtime.projectId,
    promptCategory: "general",
    promptTokens,
    providerLatencyMs: terminal.providerLatencyMs,
    requestId: config.recordId,
    requestedModel: "auto",
    routingReason:
      terminal.httpStatus < 400
        ? terminal.cacheStatus === "hit"
          ? "exact_cache_hit_provider_bypass"
          : "category_difficulty_matrix"
        : null,
    status: terminal.status,
    stream: false,
    tenantId: runtime.tenantId,
    totalTokens: promptTokens + completionTokens
  };
}

function fixtureTerminalState(scenarioId: CustomerDemoScenarioId) {
  switch (scenarioId) {
    case "blocked":
      return {
        cacheStatus: "bypass",
        errorCode: "sensitive_data_blocked",
        errorMessage: "Request blocked by GateLM security policy.",
        httpStatus: 403,
        maskingAction: "blocked" as const,
        providerLatencyMs: null,
        status: "blocked"
      };
    case "cache-hit":
      return {
        cacheStatus: "hit",
        errorCode: null,
        errorMessage: null,
        httpStatus: 200,
        maskingAction: "none" as const,
        providerLatencyMs: null,
        status: "success"
      };
    case "rate-limited":
      return {
        cacheStatus: "bypass",
        errorCode: "rate_limit_exceeded",
        errorMessage: "Application rate limit exceeded.",
        httpStatus: 429,
        maskingAction: "none" as const,
        providerLatencyMs: null,
        status: "rate_limited"
      };
    case "redacted":
      return {
        cacheStatus: "miss",
        errorCode: null,
        errorMessage: null,
        httpStatus: 200,
        maskingAction: "redacted" as const,
        providerLatencyMs: 91,
        status: "success"
      };
    default:
      return {
        cacheStatus: "miss",
        errorCode: null,
        errorMessage: null,
        httpStatus: 200,
        maskingAction: "none" as const,
        providerLatencyMs: 84,
        status: "success"
      };
  }
}
