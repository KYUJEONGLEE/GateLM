"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  formatDisplayIdentifier,
  formatTenantDisplayName,
  sanitizeDisplayValue
} from "@/lib/formatting/display-identifiers";
import {
  FixtureGatewayChatClient,
  type CustomerDemoExchange,
  type CustomerDemoHeader,
  type CustomerDemoModel,
  type CustomerDemoScenarioId
} from "@/lib/gateway/customer-demo-client";
import type { Locale } from "@/lib/i18n/locale";

type CustomerDemoAppProps = {
  locale: Locale;
  model: CustomerDemoModel;
};

const customerDemoText: Record<
  Locale,
  {
    actions: {
      detail: string;
      loading: string;
      replay: string;
    };
    assistantLabel: string;
    chatPreview: string;
    context: {
      application: string;
      project: string;
      tenant: string;
    };
    detectedNone: string;
    error: string;
    gatewayRequest: string;
    gatewayResult: string;
    language: string;
    payloadPreview: string;
    responsePreview: string;
    scenarios: Record<
      CustomerDemoScenarioId,
      {
        assistantMessage: string;
        title: string;
      }
    >;
    scenarioSelector: string;
    summary: {
      application: string;
      cache: string;
      http: string;
      latency: string;
      masking: string;
    };
    title: string;
    userLabel: string;
    webConsole: string;
  }
> = {
  en: {
    actions: {
      detail: "Open request detail",
      loading: "Loading...",
      replay: "Run again"
    },
    assistantLabel: "Assistant / Gateway outcome",
    chatPreview: "conversation",
    context: {
      application: "Application",
      project: "Project",
      tenant: "Tenant"
    },
    detectedNone: "none",
    error: "Unable to load this request state.",
    gatewayRequest: "Gateway request",
    gatewayResult: "Gateway result",
    language: "Console language",
    payloadPreview: "Payload preview",
    responsePreview: "Response preview",
    scenarios: {
      blocked: {
        assistantMessage: "Request blocked.",
        title: "Blocked"
      },
      "cache-hit": {
        assistantMessage: "Cached answer returned.",
        title: "Cache hit"
      },
      redacted: {
        assistantMessage: "Sensitive values were redacted.",
        title: "Redaction"
      },
      safe: {
        assistantMessage: "Request completed.",
        title: "Safe request"
      }
    },
    scenarioSelector: "Request path",
    summary: {
      application: "Application",
      cache: "Cache",
      http: "HTTP status",
      latency: "Latency",
      masking: "Masking"
    },
    title: "Gateway request",
    userLabel: "Customer message",
    webConsole: "Web Console"
  },
  ko: {
    actions: {
      detail: "요청 상세 열기",
      loading: "처리 중...",
      replay: "다시 실행"
    },
    assistantLabel: "Assistant / Gateway 결과",
    chatPreview: "대화",
    context: {
      application: "애플리케이션",
      project: "프로젝트",
      tenant: "테넌트"
    },
    detectedNone: "없음",
    error: "요청 상태를 불러오지 못했습니다.",
    gatewayRequest: "Gateway 요청",
    gatewayResult: "Gateway 결과",
    language: "콘솔 언어",
    payloadPreview: "Payload preview",
    responsePreview: "Response preview",
    scenarios: {
      blocked: {
        assistantMessage: "요청이 차단되었습니다.",
        title: "차단"
      },
      "cache-hit": {
        assistantMessage: "캐시된 응답을 반환했습니다.",
        title: "캐시 적중"
      },
      redacted: {
        assistantMessage: "민감 값이 마스킹되었습니다.",
        title: "Redaction"
      },
      safe: {
        assistantMessage: "요청이 완료되었습니다.",
        title: "Safe 요청"
      }
    },
    scenarioSelector: "처리 유형",
    summary: {
      application: "애플리케이션",
      cache: "캐시",
      http: "HTTP 상태",
      latency: "지연 시간",
      masking: "마스킹"
    },
    title: "Gateway 요청",
    userLabel: "고객 메시지",
    webConsole: "웹 콘솔"
  }
};

export function CustomerDemoApp({ locale, model }: CustomerDemoAppProps) {
  const client = useMemo(() => new FixtureGatewayChatClient(model.scenarios), [model.scenarios]);
  const [exchange, setExchange] = useState<CustomerDemoExchange>(model.scenarios[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const text = customerDemoText[locale];
  const exchangeText = text.scenarios[exchange.scenarioId];
  const tenantLabel = formatTenantDisplayName(model.tenantId);

  async function selectScenario(scenarioId: CustomerDemoScenarioId) {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      setExchange(await client.sendChatCompletion(scenarioId));
    } catch {
      setLoadError(text.error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="customer-demo-shell">
      <header className="customer-demo-header">
        <Link className="customer-demo-brand" href="/">
          <span>AC</span>
          <strong>Acme Support Desk</strong>
        </Link>
        <div className="customer-demo-header-meta">
          <LanguageSwitcher ariaLabel={text.language} locale={locale} />
          <Link href={`/tenants/${model.tenantId}/dashboard`}>{text.webConsole}</Link>
        </div>
      </header>

      <section className="customer-demo-hero">
        <div>
          <p className="console-kicker">support desk</p>
          <h1>{text.title}</h1>
        </div>
        <dl className="customer-demo-context" aria-label="Application context">
          <div>
            <dt>{text.context.tenant}</dt>
            <dd>{tenantLabel}</dd>
          </div>
          <div>
            <dt>{text.context.project}</dt>
            <dd>{model.projectId}</dd>
          </div>
          <div>
            <dt>{text.context.application}</dt>
            <dd>{formatDisplayIdentifier(model.applicationId)}</dd>
          </div>
        </dl>
      </section>

      <section className="customer-demo-summary-grid" aria-label="Selected request summary">
        <DemoSummaryCard
          icon="↗"
          label={text.summary.http}
          tone={exchange.status}
          value={String(exchange.httpStatus)}
        />
        <DemoSummaryCard
          icon="◌"
          label={text.summary.cache}
          tone={exchange.cacheStatus}
          value={exchange.cacheStatus}
        />
        <DemoSummaryCard
          icon="◆"
          label={text.summary.masking}
          tone={exchange.maskingAction}
          value={exchange.maskingAction}
        />
        <DemoSummaryCard
          icon="●"
          label={text.summary.latency}
          tone="latency"
          value={`${exchange.latencyMs} ms`}
        />
      </section>

      <section className="customer-demo-layout" aria-label="Gateway request states">
        <aside className="customer-demo-scenarios" aria-label={text.scenarioSelector}>
          <div className="customer-demo-section-title">
            <h2>{text.scenarioSelector}</h2>
          </div>
          {model.scenarios.map((scenario) => {
            const scenarioText = text.scenarios[scenario.scenarioId];

            return (
              <Button
                className="customer-demo-scenario"
                data-active={scenario.scenarioId === exchange.scenarioId}
                data-status={scenario.status}
                variant="outline"
                key={scenario.scenarioId}
                onClick={() => selectScenario(scenario.scenarioId)}
                disabled={isLoading}
                type="button"
              >
                <Badge variant="secondary">{scenario.httpStatus}</Badge>
                <strong>{scenarioText.title}</strong>
              </Button>
            );
          })}
        </aside>

        <Card
          className="customer-demo-chat"
          aria-busy={isLoading}
          aria-label="Text-only chat preview"
        >
          <CardHeader className="panel-heading">
            <div>
              <p className="console-kicker">{text.chatPreview}</p>
              <CardTitle>{exchangeText.title}</CardTitle>
            </div>
            <Badge className="status-badge" data-status={exchange.status} variant="secondary">
              {exchange.status}
            </Badge>
          </CardHeader>

          <CardContent className="customer-demo-chat-content">
            <div className="chat-window">
              {loadError ? <p className="customer-demo-error">{loadError}</p> : null}
              <article className="chat-bubble chat-bubble-user">
                <span>{text.userLabel}</span>
                <p>{exchange.request.body.messages[1]?.content ?? text.detectedNone}</p>
              </article>
              <article className="chat-bubble chat-bubble-assistant" data-status={exchange.status}>
                <span>{text.assistantLabel}</span>
                <p>{exchangeText.assistantMessage}</p>
              </article>
            </div>

            <div className="customer-demo-actions">
              <Button
                className="primary-button"
                disabled={isLoading}
                onClick={() => selectScenario(exchange.scenarioId)}
                type="button"
              >
                {isLoading ? text.actions.loading : text.actions.replay}
              </Button>
              <Link className="secondary-button" href={exchange.requestLogHref}>
                {text.actions.detail}
              </Link>
            </div>
          </CardContent>
        </Card>

        <section className="customer-demo-inspector" aria-label="Gateway request inspector">
          <Card className="console-panel customer-demo-inspector-card">
            <CardHeader className="panel-heading">
              <div>
                <CardTitle>{text.gatewayRequest}</CardTitle>
              </div>
              <CardAction>
                <Badge variant="outline">{exchange.request.method}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="request-line">
                <span>{exchange.request.method}</span>
                <code>{exchange.request.endpoint}</code>
              </div>
              <HeaderList headers={exchange.request.headers} />
              <Separator className="customer-demo-separator" />
              <JsonPreview label={text.payloadPreview} value={exchange.request.body} />
            </CardContent>
          </Card>

          <Card className="console-panel customer-demo-inspector-card">
            <CardHeader className="panel-heading">
              <div>
                <CardTitle>{text.gatewayResult}</CardTitle>
              </div>
              <CardAction>
                <Badge variant={exchange.status === "success" ? "secondary" : "outline"}>
                  {exchange.status}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <dl className="customer-demo-metrics">
                <Metric label="HTTP" value={String(exchange.httpStatus)} />
                <Metric label="Request ID" value={formatDisplayIdentifier(exchange.requestId)} />
                <Metric label="Cache" value={exchange.cacheStatus} />
                <Metric label="Masking" value={exchange.maskingAction} />
                <Metric label="Provider" value={exchange.providerCall} />
                <Metric label="Latency" value={`${exchange.latencyMs} ms`} />
                <Metric
                  label="Detected"
                  value={
                    exchange.detectedTypes.length > 0
                      ? exchange.detectedTypes.join(", ")
                      : text.detectedNone
                  }
                />
              </dl>
              <HeaderList headers={exchange.response.headers} />
              <Separator className="customer-demo-separator" />
              <JsonPreview label={text.responsePreview} value={exchange.response.body} />
            </CardContent>
          </Card>
        </section>
      </section>
    </main>
  );
}

function DemoSummaryCard({
  icon,
  label,
  tone,
  value
}: {
  icon: string;
  label: string;
  tone: string;
  value: string;
}) {
  return (
    <Card className="customer-demo-summary-card" data-tone={tone}>
      <CardContent className="customer-demo-summary-content">
        <div>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
        <i aria-hidden="true">{icon}</i>
      </CardContent>
    </Card>
  );
}

function HeaderList({ headers }: { headers: CustomerDemoHeader[] }) {
  return (
    <dl className="header-list">
      {headers.map((header) => (
        <div key={header.name}>
          <dt>{header.name}</dt>
          <dd>{formatDisplayIdentifier(header.value)}</dd>
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
      <pre>{JSON.stringify(sanitizeDisplayValue(value), null, 2)}</pre>
    </div>
  );
}
