export type CustomerDemoScenarioId =
  | "safe"
  | "redacted"
  | "blocked"
  | "cache-hit"
  | "rate-limited"
  | "provider-timeout"
  | "provider-fallback";

export type CustomerDemoIntegrationMode = "fixture" | "gateway";
export type CustomerDemoSurface = "application" | "demo";

export type CustomerDemoHeader = {
  name: string;
  value: string;
};

export type CustomerDemoConversation = {
  contextRetentionEnabled: boolean;
  id: string;
};

export type CustomerDemoRequest = {
  endpoint: string;
  method: "POST";
  headers: CustomerDemoHeader[];
  body: {
    model: string;
    messages: Array<{
      role: "assistant" | "system" | "user";
      content: string;
    }>;
    max_tokens?: number;
    temperature?: number;
    stream: boolean;
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
  contextRetentionEnabled: boolean;
  conversationId: string | null;
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
  streaming: {
    completed: boolean | null;
    contentType: string | null;
    chunkCount: number | null;
    requested: boolean;
  };
  title: string;
};

export type CustomerDemoModel = {
  applicationId: string;
  integrationMode: CustomerDemoIntegrationMode;
  projectId: string;
  scenarios: CustomerDemoExchange[];
  surface: CustomerDemoSurface;
  tenantId: string;
};

export interface GatewayChatClient {
  createConversation(options?: {
    contextRetentionEnabled?: boolean;
  }): Promise<CustomerDemoConversation>;
  sendChatCompletion(
    scenarioId: CustomerDemoScenarioId,
    options?: {
      contextRetentionEnabled?: boolean;
      conversationId?: string | null;
      message?: string;
      stream?: boolean;
    }
  ): Promise<CustomerDemoExchange>;
  sendChatCompletionStream(
    scenarioId: CustomerDemoScenarioId,
    options: {
      contextRetentionEnabled?: boolean;
      conversationId?: string | null;
      message?: string;
      stream?: boolean;
    },
    handlers: {
      onDelta: (content: string) => void;
    }
  ): Promise<CustomerDemoExchange>;
  updateConversation(
    conversationId: string,
    options: { contextRetentionEnabled?: boolean }
  ): Promise<CustomerDemoConversation>;
}

export class FixtureGatewayChatClient implements GatewayChatClient {
  private readonly scenarioMap: Map<CustomerDemoScenarioId, CustomerDemoExchange>;

  constructor(scenarios: CustomerDemoExchange[]) {
    this.scenarioMap = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  }

  async createConversation(
    options: { contextRetentionEnabled?: boolean } = {}
  ): Promise<CustomerDemoConversation> {
    return {
      contextRetentionEnabled: options.contextRetentionEnabled ?? false,
      id: `fixture-conversation-${Date.now()}`
    };
  }

  async sendChatCompletion(
    scenarioId: CustomerDemoScenarioId,
    options: {
      contextRetentionEnabled?: boolean;
      conversationId?: string | null;
      message?: string;
      stream?: boolean;
    } = {}
  ): Promise<CustomerDemoExchange> {
    const scenario = this.scenarioMap.get(scenarioId);

    if (!scenario) {
      throw new Error(`Unknown customer demo scenario: ${scenarioId}`);
    }

    return options.stream
      ? {
          ...scenario,
          contextRetentionEnabled: options.contextRetentionEnabled ?? scenario.contextRetentionEnabled,
          conversationId: options.conversationId ?? scenario.conversationId,
          request: {
            ...scenario.request,
            body: {
              ...scenario.request.body,
              stream: true
            }
          },
          streaming: {
            completed: true,
            contentType: "fixture",
            chunkCount: 0,
            requested: true
          }
        }
      : {
          ...scenario,
          contextRetentionEnabled: options.contextRetentionEnabled ?? scenario.contextRetentionEnabled,
          conversationId: options.conversationId ?? scenario.conversationId
        };
  }

  async sendChatCompletionStream(
    scenarioId: CustomerDemoScenarioId,
    options: {
      contextRetentionEnabled?: boolean;
      conversationId?: string | null;
      message?: string;
      stream?: boolean;
    } = {},
    handlers: { onDelta: (content: string) => void }
  ): Promise<CustomerDemoExchange> {
    const exchange = await this.sendChatCompletion(scenarioId, {
      ...options,
      stream: true
    });

    if (exchange.assistantMessage) {
      handlers.onDelta(exchange.assistantMessage);
    }

    return exchange;
  }

  async updateConversation(
    conversationId: string,
    options: { contextRetentionEnabled?: boolean }
  ): Promise<CustomerDemoConversation> {
    return {
      contextRetentionEnabled: options.contextRetentionEnabled ?? false,
      id: conversationId
    };
  }
}

export class RouteGatewayChatClient implements GatewayChatClient {
  constructor(
    private readonly tenantId: string,
    private readonly surface: CustomerDemoSurface
  ) {}

  async sendChatCompletion(
    scenarioId: CustomerDemoScenarioId,
    options: {
      contextRetentionEnabled?: boolean;
      conversationId?: string | null;
      message?: string;
      stream?: boolean;
    } = {}
  ): Promise<CustomerDemoExchange> {
    const response = await fetch("/api/customer-demo/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: options.message,
        contextRetentionEnabled: options.contextRetentionEnabled,
        conversationId: options.conversationId,
        scenarioId,
        surface: this.surface,
        stream: options.stream === true,
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

  async sendChatCompletionStream(
    scenarioId: CustomerDemoScenarioId,
    options: {
      contextRetentionEnabled?: boolean;
      conversationId?: string | null;
      message?: string;
      stream?: boolean;
    } = {},
    handlers: { onDelta: (content: string) => void }
  ): Promise<CustomerDemoExchange> {
    const response = await fetch("/api/customer-demo/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: options.message,
        contextRetentionEnabled: options.contextRetentionEnabled,
        conversationId: options.conversationId,
        scenarioId,
        surface: this.surface,
        stream: true,
        tenantId: this.tenantId
      })
    });

    if (!response.headers.get("Content-Type")?.includes("text/event-stream")) {
      const payload = (await response.json()) as {
        error?: string;
        exchange?: CustomerDemoExchange;
      };

      if (!response.ok || !payload.exchange) {
        throw new Error(payload.error ?? "Gateway integration request failed.");
      }

      if (payload.exchange.assistantMessage) {
        handlers.onDelta(payload.exchange.assistantMessage);
      }

      return payload.exchange;
    }

    if (!response.ok || !response.body) {
      throw new Error("Gateway streaming request failed.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalExchange: CustomerDemoExchange | null = null;
    let streamError = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const event = parseCustomerDemoSseFrame(frame);

        if (!event) {
          continue;
        }

        if (event.event === "delta") {
          const delta = parseCustomerDemoSseJson<{ content?: unknown }>(event.data);

          if (typeof delta?.content === "string") {
            handlers.onDelta(delta.content);
            await waitForNextPaint();
          }
        } else if (event.event === "exchange") {
          const payload = parseCustomerDemoSseJson<{ exchange?: CustomerDemoExchange }>(event.data);

          finalExchange = payload?.exchange ?? null;
        } else if (event.event === "error") {
          const payload = parseCustomerDemoSseJson<{ error?: unknown }>(event.data);

          streamError = typeof payload?.error === "string" ? payload.error : "Gateway streaming request failed.";
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      const event = parseCustomerDemoSseFrame(buffer);

      if (event?.event === "exchange") {
        const payload = parseCustomerDemoSseJson<{ exchange?: CustomerDemoExchange }>(event.data);

        finalExchange = payload?.exchange ?? finalExchange;
      }
    }

    if (streamError) {
      throw new Error(streamError);
    }

    if (!finalExchange) {
      throw new Error("Gateway streaming response did not include a final exchange.");
    }

    return finalExchange;
  }

  async createConversation(
    options: { contextRetentionEnabled?: boolean } = {}
  ): Promise<CustomerDemoConversation> {
    const response = await fetch("/api/customer-demo/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contextRetentionEnabled: options.contextRetentionEnabled,
        tenantId: this.tenantId
      })
    });
    const payload = (await response.json()) as {
      conversation?: CustomerDemoConversation;
      error?: string;
    };

    if (!response.ok || !payload.conversation) {
      throw new Error(payload.error ?? "Conversation create failed.");
    }

    return payload.conversation;
  }

  async updateConversation(
    conversationId: string,
    options: { contextRetentionEnabled?: boolean }
  ): Promise<CustomerDemoConversation> {
    const response = await fetch("/api/customer-demo/conversations", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contextRetentionEnabled: options.contextRetentionEnabled,
        conversationId,
        tenantId: this.tenantId
      })
    });
    const payload = (await response.json()) as {
      conversation?: CustomerDemoConversation;
      error?: string;
    };

    if (!response.ok || !payload.conversation) {
      throw new Error(payload.error ?? "Conversation update failed.");
    }

    return payload.conversation;
  }
}

function parseCustomerDemoSseFrame(frame: string) {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = stripSingleLeadingSseSpace(line.slice("event:".length));
    } else if (line.startsWith("data:")) {
      dataLines.push(stripSingleLeadingSseSpace(line.slice("data:".length)));
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    data: dataLines.join("\n"),
    event
  };
}

function parseCustomerDemoSseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stripSingleLeadingSseSpace(value: string) {
  return value.startsWith(" ") ? value.slice(1) : value;
}

function waitForNextPaint() {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
