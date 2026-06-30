export type CustomerDemoScenarioId =
  | "safe"
  | "redaction"
  | "safety_block"
  | "cache-hit"
  | "rate-limited";

export type CustomerDemoScenarioAlias = CustomerDemoScenarioId | "redacted" | "blocked";

export type CustomerDemoIntegrationMode = "fixture" | "gateway";

export type CustomerDemoHeader = {
  name: string;
  value: string;
};

export type CustomerDemoRequest = {
  endpoint: string;
  method: "POST";
  headers: CustomerDemoHeader[];
  body: {
    model: string;
    messages: Array<{
      role: "system" | "user";
      content: string;
    }>;
    max_tokens?: number;
    temperature?: number;
    stream: false;
    metadata: Record<string, string>;
    gate_lm: {
      cache: {
        mode: "auto";
      };
      routing: {
        mode: "auto";
      };
      responseMetadata: true;
    };
  };
};

export type CustomerDemoResponse = {
  body: unknown;
  headers: CustomerDemoHeader[];
  statusCode: number;
};

export type CustomerDemoExchange = {
  assistantMessage: string;
  cacheStatus: string;
  dashboardHref: string;
  description: string;
  detectorSummary: {
    detectedCount: number;
    detectorCategories: string[];
  };
  httpStatus: number;
  latencyMs: number;
  maskingAction: "none" | "redacted" | "blocked";
  outcomeSummary: {
    cacheOutcome: string;
    providerOutcome: string;
    safetyOutcome: string;
    streamingOutcome: string;
    terminalStatus: string;
  };
  providerCall: "called" | "skipped";
  request: CustomerDemoRequest;
  requestId: string;
  requestLogHref: string;
  response: CustomerDemoResponse;
  scenarioId: CustomerDemoScenarioId;
  status: string;
  title: string;
};

export type CustomerDemoModel = {
  applicationId: string;
  integrationMode: CustomerDemoIntegrationMode;
  projectId: string;
  scenarios: CustomerDemoExchange[];
  tenantId: string;
};

export interface GatewayChatClient {
  sendChatCompletion(scenarioId: CustomerDemoScenarioAlias): Promise<CustomerDemoExchange>;
}

export class FixtureGatewayChatClient implements GatewayChatClient {
  private readonly scenarioMap: Map<CustomerDemoScenarioId, CustomerDemoExchange>;

  constructor(scenarios: CustomerDemoExchange[]) {
    this.scenarioMap = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  }

  async sendChatCompletion(scenarioId: CustomerDemoScenarioAlias): Promise<CustomerDemoExchange> {
    const scenario = this.scenarioMap.get(normalizeCustomerDemoScenarioId(scenarioId));

    if (!scenario) {
      throw new Error(`Unknown customer demo scenario: ${scenarioId}`);
    }

    return scenario;
  }
}

export class RouteGatewayChatClient implements GatewayChatClient {
  constructor(private readonly tenantId: string) {}

  async sendChatCompletion(scenarioId: CustomerDemoScenarioAlias): Promise<CustomerDemoExchange> {
    const response = await fetch("/api/customer-demo/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        scenarioId,
        tenantId: this.tenantId
      })
    });
    const payload = (await response.json()) as {
      error?: string;
      exchange?: CustomerDemoExchange;
    };

    if (!response.ok || !payload.exchange) {
      throw new Error(payload.error ?? "Gateway integration request failed.");
    }

    return payload.exchange;
  }
}

export function normalizeCustomerDemoScenarioId(
  scenarioId: CustomerDemoScenarioAlias
): CustomerDemoScenarioId {
  if (scenarioId === "redacted") {
    return "redaction";
  }

  if (scenarioId === "blocked") {
    return "safety_block";
  }

  return scenarioId;
}
