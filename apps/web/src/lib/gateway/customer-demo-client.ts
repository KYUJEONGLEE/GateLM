export type CustomerDemoScenarioId = "safe" | "redacted" | "blocked" | "cache-hit";

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
