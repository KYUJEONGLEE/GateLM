"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  FixtureGatewayChatClient,
  type CustomerDemoExchange,
  type CustomerDemoHeader,
  type CustomerDemoModel,
  type CustomerDemoScenarioId
} from "@/lib/gateway/customer-demo-client";

type CustomerDemoAppProps = {
  model: CustomerDemoModel;
};

export function CustomerDemoApp({ model }: CustomerDemoAppProps) {
  const client = useMemo(() => new FixtureGatewayChatClient(model.scenarios), [model.scenarios]);
  const [exchange, setExchange] = useState<CustomerDemoExchange>(model.scenarios[0]);

  async function selectScenario(scenarioId: CustomerDemoScenarioId) {
    setExchange(await client.sendChatCompletion(scenarioId));
  }

  return (
    <main className="customer-demo-shell">
      <header className="customer-demo-header">
        <Link className="customer-demo-brand" href="/">
          <span>AC</span>
          <strong>Acme Support Desk</strong>
        </Link>
        <div className="customer-demo-header-meta">
          <span>Gateway fixture mode</span>
          <Link href={`/tenants/${model.tenantId}/dashboard`}>Web Console</Link>
        </div>
      </header>

      <section className="customer-demo-hero">
        <div>
          <p className="console-kicker">customer demo app</p>
          <h1>Text-only support assistant through GateLM</h1>
          <p>
            This app shows the customer-side request shape that will call only
            the Gateway. Scenarios are fixture-backed until the live Gateway
            integration PR.
          </p>
        </div>
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
      </section>

      <section className="customer-demo-layout" aria-label="Customer demo fixture scenarios">
        <aside className="customer-demo-scenarios" aria-label="Scenario selector">
          {model.scenarios.map((scenario) => (
            <button
              className="customer-demo-scenario"
              data-active={scenario.scenarioId === exchange.scenarioId}
              data-status={scenario.status}
              key={scenario.scenarioId}
              onClick={() => selectScenario(scenario.scenarioId)}
              type="button"
            >
              <span>{scenario.httpStatus}</span>
              <strong>{scenario.title}</strong>
              <small>{scenario.description}</small>
            </button>
          ))}
        </aside>

        <section className="customer-demo-chat" aria-label="Text-only chat preview">
          <div className="panel-heading">
            <div>
              <p className="console-kicker">chat preview</p>
              <h2>{exchange.title}</h2>
            </div>
            <span className="status-badge" data-status={exchange.status}>
              {exchange.status}
            </span>
          </div>

          <div className="chat-window">
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
              onClick={() => selectScenario(exchange.scenarioId)}
              type="button"
            >
              Replay fixture request
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
              <p>Fixture response metadata mirrors the v1 Gateway contract.</p>
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
