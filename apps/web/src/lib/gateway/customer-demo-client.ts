export type CustomerDemoScenarioId =
  | "safe"
  | "redacted"
  | "blocked"
  | "cache-hit"
  | "rate-limited";

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
  description: string;
  detectedTypes: string[];
  httpStatus: number;
  latencyMs: number;
  maskingAction: "none" | "redacted" | "blocked";
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
  sendChatCompletion(scenarioId: CustomerDemoScenarioId): Promise<CustomerDemoExchange>;
}

export class FixtureGatewayChatClient implements GatewayChatClient {
  private readonly scenarioMap: Map<CustomerDemoScenarioId, CustomerDemoExchange>;

  constructor(scenarios: CustomerDemoExchange[]) {
    this.scenarioMap = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  }

  async sendChatCompletion(scenarioId: CustomerDemoScenarioId): Promise<CustomerDemoExchange> {
    const scenario = this.scenarioMap.get(scenarioId);

    if (!scenario) {
      throw new Error(`Unknown customer demo scenario: ${scenarioId}`);
    }

    return scenario;
  }
}

export class RouteGatewayChatClient implements GatewayChatClient {
  constructor(private readonly tenantId: string) {}

  async sendChatCompletion(scenarioId: CustomerDemoScenarioId): Promise<CustomerDemoExchange> {
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
