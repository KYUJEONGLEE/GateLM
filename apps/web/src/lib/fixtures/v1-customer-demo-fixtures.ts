import credentialLifecycleFixture from "../../../../../docs/v1.0.0/fixtures/credential-lifecycle.fixture.json";
import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import type {
  CustomerDemoExchange,
  CustomerDemoHeader,
  CustomerDemoModel,
  CustomerDemoRequest,
  CustomerDemoScenarioId
} from "@/lib/gateway/customer-demo-client";
import {
  getInvocationLogFixture,
  type InvocationLogRecord
} from "@/lib/fixtures/v1-observability-fixtures";

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
  appToken,
  record
}: {
  apiKey: CredentialListItem;
  appToken: CredentialListItem;
  record: InvocationLogRecord;
}): CustomerDemoHeader[] {
  return [
    {
      name: "Authorization",
      value: `Bearer ${displaySecret(apiKey.prefix, apiKey.last4)}`
    },
    {
      name: "X-GateLM-App-Token",
      value: displaySecret(appToken.prefix, appToken.last4)
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

function buildResponseHeaders(record: InvocationLogRecord): CustomerDemoHeader[] {
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
      name: "X-GateLM-Routed-Provider",
      value: record.selectedProvider ?? "not-routed"
    },
    {
      name: "X-GateLM-Routed-Model",
      value: record.selectedModel ?? "not-routed"
    },
    {
      name: "X-GateLM-Estimated-Cost-Usd",
      value: formatEstimatedCost(record.costMicroUsd)
    }
  ];
}

function buildRequestBody(
  config: ScenarioConfig,
  record: InvocationLogRecord
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

function buildResponseBody(config: ScenarioConfig, record: InvocationLogRecord) {
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
    model: record.selectedModel ?? record.requestedModel ?? "auto",
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
      selectedProvider: record.selectedProvider,
      selectedModel: record.selectedModel,
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
  appToken,
  config,
  record
}: {
  apiKey: CredentialListItem;
  appToken: CredentialListItem;
  config: ScenarioConfig;
  record: InvocationLogRecord;
}): CustomerDemoExchange {
  const request: CustomerDemoRequest = {
    endpoint: "/v1/chat/completions",
    method: "POST",
    headers: buildRequestHeaders({ apiKey, appToken, record }),
    body: buildRequestBody(config, record)
  };

  return {
    assistantMessage: config.assistantMessage,
    cacheStatus: record.cacheStatus,
    description: config.description,
    detectedTypes: record.maskingDetectedTypes ?? [],
    httpStatus: record.httpStatus,
    latencyMs: record.latencyMs,
    maskingAction: record.maskingAction,
    providerCall: record.providerLatencyMs == null ? "skipped" : "called",
    request,
    requestId: record.requestId,
    requestLogHref: `/tenants/${record.tenantId}/request-logs/${record.requestId}`,
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
  const records = getInvocationLogFixture().records;

  return {
    applicationId: runtime.runtimeConfig.applicationId,
    integrationMode: "fixture",
    projectId: runtime.runtimeConfig.projectId,
    scenarios: scenarioConfigs.map((config) => {
      const record = records.find((item) => item.requestId === config.recordId);

      if (!record) {
        throw new Error(`Missing customer demo invocation fixture: ${config.recordId}`);
      }

      return buildExchange({
        apiKey: credentials.credentialLifecycle.apiKey.listItemExample,
        appToken: credentials.credentialLifecycle.appToken.listItemExample,
        config,
        record
      });
    }),
    tenantId: runtime.runtimeConfig.tenantId
  };
}
