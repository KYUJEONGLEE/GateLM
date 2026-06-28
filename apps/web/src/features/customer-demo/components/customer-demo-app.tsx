"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FixtureGatewayChatClient,
  RouteGatewayChatClient,
  type CustomerDemoExchange,
  type CustomerDemoHeader,
  type CustomerDemoModel,
  type CustomerDemoScenarioId
} from "@/lib/gateway/customer-demo-client";

type CustomerDemoAppProps = {
  model: CustomerDemoModel;
};

export function CustomerDemoApp({ model }: CustomerDemoAppProps) {
  const client = useMemo(() => {
    if (model.integrationMode === "gateway") {
      return new RouteGatewayChatClient(model.tenantId);
    }

    return new FixtureGatewayChatClient(model.scenarios);
  }, [model.integrationMode, model.scenarios, model.tenantId]);
  const [exchange, setExchange] = useState<CustomerDemoExchange>(() => buildInitialExchange(model));
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialGatewayRequestSent = useRef(false);
  const requestInFlight = useRef(false);

  const selectScenario = useCallback(async (scenarioId: CustomerDemoScenarioId) => {
    if (requestInFlight.current) {
      return;
    }

    requestInFlight.current = true;
    setIsLoading(true);
    setLoadError(null);

    try {
      setExchange(await client.sendChatCompletion(scenarioId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to send Gateway request.");
    } finally {
      requestInFlight.current = false;
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (model.integrationMode !== "gateway" || initialGatewayRequestSent.current) {
      return;
    }

    initialGatewayRequestSent.current = true;
    void selectScenario(model.scenarios[0].scenarioId);
  }, [model.integrationMode, model.scenarios, selectScenario]);

  return (
    <main className="customer-demo-shell">
      <header className="customer-demo-header">
        <Link className="customer-demo-brand" href="/">
          <span>AC</span>
          <strong>Acme Support Desk</strong>
        </Link>
        <div className="customer-demo-header-meta">
          <span>{model.integrationMode === "gateway" ? "Gateway live mode" : "Gateway fixture mode"}</span>
          <Link href={`/tenants/${model.tenantId}/dashboard`}>Web Console</Link>
        </div>
      </header>

      <section className="customer-demo-hero">
        <div>
          <p className="console-kicker">customer demo app</p>
          <h1>Support operations through GateLM</h1>
          <p>
            This app sends OpenAI-compatible requests through the Gateway and
            surfaces the returned governance metadata.
          </p>
        </div>
        <div className="customer-demo-hero-side">
          <GatewayTopology />
          <dl className="customer-demo-context" aria-label="Demo application context">
            <div>
              <dt>Tenant</dt>
              <dd>{model.tenantId}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{model.projectId}</dd>
            </div>
            <div>
              <dt>Application</dt>
              <dd>{model.applicationId}</dd>
            </div>
          </dl>
        </div>
      </section>

      <OutcomeSummary exchange={exchange} />

      <section className="customer-demo-layout" aria-label="Customer demo scenarios">
        <aside className="customer-demo-scenarios" aria-label="Scenario selector">
          {model.scenarios.map((scenario) => (
            <button
              className="customer-demo-scenario"
              data-active={scenario.scenarioId === exchange.scenarioId}
              data-status={scenario.status}
              key={scenario.scenarioId}
              onClick={() => selectScenario(scenario.scenarioId)}
              disabled={isLoading}
              type="button"
            >
              <span>
                <i aria-hidden="true" />
                {scenario.httpStatus}
              </span>
              <strong>{scenario.title}</strong>
              <small>{scenario.description}</small>
            </button>
          ))}
        </aside>

        <section
          className="customer-demo-chat"
          aria-busy={isLoading}
          aria-label="Text-only chat preview"
        >
          <div className="panel-heading">
            <div>
              <p className="console-kicker">chat preview</p>
              <h2>{exchange.title}</h2>
            </div>
            <span className="status-badge" data-status={exchange.status}>
              {exchange.status}
            </span>
          </div>

          <GatewayFlow exchange={exchange} />

          <div className="chat-window">
            {loadError ? <p className="customer-demo-error">{loadError}</p> : null}
            <article className="chat-bubble chat-bubble-user">
              <span>Customer message</span>
              <p>{exchange.request.body.messages[1]?.content ?? "No prompt preview stored."}</p>
            </article>
            <article className="chat-bubble chat-bubble-assistant" data-status={exchange.status}>
              <span>Assistant / Gateway outcome</span>
              <p>{exchange.assistantMessage}</p>
            </article>
          </div>

          <div className="customer-demo-actions">
            <button
              className="primary-button"
              disabled={isLoading}
              onClick={() => selectScenario(exchange.scenarioId)}
              type="button"
            >
              {isLoading
                ? model.integrationMode === "gateway"
                  ? "Sending Gateway request..."
                  : "Loading fixture..."
                : model.integrationMode === "gateway"
                  ? "Send Gateway request"
                  : "Replay fixture request"}
            </button>
            <Link className="secondary-button" href={exchange.requestLogHref}>
              Open request detail
            </Link>
          </div>
        </section>

        <section className="customer-demo-inspector" aria-label="Gateway request inspector">
          <article className="console-panel">
            <div className="panel-heading">
              <h3>Gateway request</h3>
              <p>Header values are redacted; only prefix/last4 style previews are shown.</p>
            </div>
            <div className="request-line">
              <span>{exchange.request.method}</span>
              <code>{exchange.request.endpoint}</code>
            </div>
            <HeaderList headers={exchange.request.headers} />
            <JsonPreview label="Payload preview" value={exchange.request.body} />
          </article>

          <article className="console-panel">
            <div className="panel-heading">
              <h3>Gateway result</h3>
              <p>Response headers and metadata are returned by the Gateway path.</p>
            </div>
            <dl className="customer-demo-metrics">
              <Metric label="HTTP" value={String(exchange.httpStatus)} />
              <Metric label="Request ID" value={exchange.requestId} />
              <Metric label="Cache" value={exchange.cacheStatus} />
              <Metric label="Masking" value={exchange.maskingAction} />
              <Metric label="Provider" value={exchange.providerCall} />
              <Metric label="Latency" value={`${exchange.latencyMs} ms`} />
              <Metric
                label="Detected"
                value={exchange.detectedTypes.length > 0 ? exchange.detectedTypes.join(", ") : "none"}
              />
            </dl>
            <HeaderList headers={exchange.response.headers} />
            <JsonPreview label="Response preview" value={exchange.response.body} />
          </article>
        </section>
      </section>
    </main>
  );
}

function buildInitialExchange(model: CustomerDemoModel): CustomerDemoExchange {
  const base = model.scenarios[0];

  if (model.integrationMode !== "gateway") {
    return base;
  }

  return {
    ...base,
    assistantMessage: "Waiting for the first live Gateway response.",
    cacheStatus: "pending",
    description: "Live Gateway request is being prepared for this tenant application.",
    detectedTypes: [],
    httpStatus: 0,
    latencyMs: 0,
    maskingAction: "none",
    providerCall: "skipped",
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
          name: "Content-Type",
          value: "application/json"
        }
      ],
      body: {
        model: "auto",
        messages: [
          {
            role: "system",
            content: "You are a helpful customer support assistant."
          },
          {
            role: "user",
            content: "A live Gateway request will be sent from the selected scenario."
          }
        ],
        max_tokens: 128,
        temperature: 0.2,
        stream: false,
        metadata: {
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
      }
    },
    requestId: "pending-live-request",
    requestLogHref: `/tenants/${model.tenantId}/request-logs`,
    response: {
      body: {
        status: "pending"
      },
      headers: [],
      statusCode: 0
    },
    status: "pending",
    title: "Gateway live request"
  };
}

function GatewayTopology() {
  return (
    <div className="gateway-topology" aria-label="Live Gateway path">
      {["Client", "Gateway", "Policy", "Provider", "Logs"].map((label) => (
        <div key={label}>
          <span aria-hidden="true" />
          <strong>{label}</strong>
        </div>
      ))}
    </div>
  );
}

function OutcomeSummary({ exchange }: { exchange: CustomerDemoExchange }) {
  const detected = exchange.detectedTypes.length > 0 ? exchange.detectedTypes.join(", ") : "none";

  return (
    <section className="customer-demo-outcome" aria-label="Current Gateway outcome">
      <OutcomeCard label="HTTP" value={String(exchange.httpStatus)} tone={exchange.status} />
      <OutcomeCard label="Cache" value={exchange.cacheStatus} tone={exchange.cacheStatus} />
      <OutcomeCard label="Masking" value={exchange.maskingAction} tone={exchange.maskingAction} />
      <OutcomeCard label="Provider" value={exchange.providerCall} tone={exchange.providerCall} />
      <OutcomeCard label="Detected" value={detected} tone={exchange.maskingAction} />
    </section>
  );
}

function OutcomeCard({ label, tone, value }: { label: string; tone: string; value: string }) {
  return (
    <article className="outcome-card" data-tone={tone}>
      <span aria-hidden="true" />
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function GatewayFlow({ exchange }: { exchange: CustomerDemoExchange }) {
  const flow = [
    { label: "Client", state: "done", value: exchange.request.method },
    { label: "Auth", state: "done", value: "scoped" },
    {
      label: "Safety",
      state: exchange.maskingAction === "blocked" ? "blocked" : "done",
      value: exchange.maskingAction
    },
    {
      label: "Cache",
      state: exchange.cacheStatus === "hit" ? "hit" : exchange.cacheStatus === "bypass" ? "skipped" : "done",
      value: exchange.cacheStatus
    },
    {
      label: "Provider",
      state: exchange.providerCall === "called" ? "done" : "skipped",
      value: exchange.providerCall
    },
    { label: "Log", state: "done", value: "requestId" }
  ];

  return (
    <div className="gateway-flow" aria-label="Gateway execution path">
      {flow.map((step) => (
        <div className="gateway-flow-step" data-state={step.state} key={step.label}>
          <span aria-hidden="true" />
          <strong>{step.label}</strong>
          <small>{step.value}</small>
        </div>
      ))}
    </div>
  );
}

function HeaderList({ headers }: { headers: CustomerDemoHeader[] }) {
  return (
    <dl className="header-list">
      {headers.map((header) => (
        <div key={header.name}>
          <dt>{header.name}</dt>
          <dd>{header.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function JsonPreview({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="json-preview">
      <h4>{label}</h4>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
