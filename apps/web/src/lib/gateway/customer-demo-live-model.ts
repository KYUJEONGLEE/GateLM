import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import type {
  CustomerDemoExchange,
  CustomerDemoModel,
  CustomerDemoRequest,
  CustomerDemoScenarioId
} from "@/lib/gateway/customer-demo-client";

type RuntimeConfigFixture = {
  runtimeConfig: {
    applicationId: string;
    projectId: string;
    tenantId: string;
  };
};

type LiveScenarioTemplate = {
  cacheStatus: string;
  description: string;
  detectedTypes: string[];
  httpStatus: number;
  maskingAction: CustomerDemoExchange["maskingAction"];
  promptPreview: string;
  providerCall: CustomerDemoExchange["providerCall"];
  scenarioId: CustomerDemoScenarioId;
  status: CustomerDemoExchange["status"];
  title: string;
};

const LIVE_SCENARIO_TEMPLATES: LiveScenarioTemplate[] = [
  {
    cacheStatus: "miss",
    description: "Allowed request through Gateway governance with exact cache miss.",
    detectedTypes: [],
    httpStatus: 200,
    maskingAction: "none",
    promptPreview:
      "Write a concise support reply for a delayed shipment. Keep it under three sentences.",
    providerCall: "called",
    scenarioId: "safe",
    status: "success",
    title: "Safe request"
  },
  {
    cacheStatus: "miss",
    description: "Rule-based safety redacts contact data before provider call.",
    detectedTypes: ["email", "phone_number"],
    httpStatus: 200,
    maskingAction: "redacted",
    promptPreview: "Write a support note to <email> and ask them to call <phone_number>.",
    providerCall: "called",
    scenarioId: "redacted",
    status: "success",
    title: "Redaction"
  },
  {
    cacheStatus: "bypass",
    description: "Credential-like content is blocked before routing, cache, and provider.",
    detectedTypes: ["credential"],
    httpStatus: 403,
    maskingAction: "blocked",
    promptPreview: "Summarize this synthetic config: api_key=<credential_like_secret>",
    providerCall: "skipped",
    scenarioId: "blocked",
    status: "blocked",
    title: "Blocked"
  },
	{
		cacheStatus: "hit",
		description: "Same safe request resolves to exact cache hit and provider bypass.",
    detectedTypes: [],
    httpStatus: 200,
    maskingAction: "none",
    promptPreview:
      "Write a concise support reply for a delayed shipment. Keep it under three sentences.",
		providerCall: "skipped",
		scenarioId: "cache-hit",
		status: "success",
		title: "Cache hit"
	},
  {
    cacheStatus: "bypass",
    description: "Application-scoped rate limit stops the request before provider cost.",
    detectedTypes: [],
    httpStatus: 429,
    maskingAction: "none",
    promptPreview: "Write one more local stack response after quota is exhausted.",
    providerCall: "skipped",
    scenarioId: "rate-limited",
    status: "rate_limited",
    title: "Rate limit"
  }
];

export function getCustomerDemoLiveModel(): CustomerDemoModel {
  const runtimeConfig = (runtimeConfigFixture as RuntimeConfigFixture).runtimeConfig;

  return {
    applicationId: runtimeConfig.applicationId,
    integrationMode: "gateway",
    projectId: runtimeConfig.projectId,
    scenarios: LIVE_SCENARIO_TEMPLATES.map((template) =>
      buildLiveScenario(template, runtimeConfig.tenantId)
    ),
    tenantId: runtimeConfig.tenantId
  };
}

function buildLiveScenario(
  template: LiveScenarioTemplate,
  tenantId: string
): CustomerDemoExchange {
  return {
    assistantMessage: "A live Gateway response will replace this preview after the request runs.",
    cacheStatus: template.cacheStatus,
    description: template.description,
    detectedTypes: template.detectedTypes,
    httpStatus: template.httpStatus,
    latencyMs: 0,
    maskingAction: template.maskingAction,
    providerCall: template.providerCall,
    request: {
      endpoint: "/v1/chat/completions",
      method: "POST",
      headers: [
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
          name: "Content-Type",
          value: "application/json"
        }
      ],
      body: buildLiveRequestBody(template)
    },
    requestId: `pending-live-${template.scenarioId}`,
    requestLogHref: `/tenants/${tenantId}/request-logs`,
    response: {
      body: {
        status: "not_sent"
      },
      headers: [],
      statusCode: 0
    },
    scenarioId: template.scenarioId,
    status: template.status,
    title: template.title
  };
}

function buildLiveRequestBody(template: LiveScenarioTemplate): CustomerDemoRequest["body"] {
  return {
    model: "auto",
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
    metadata: {
      demoScenario: template.scenarioId,
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
