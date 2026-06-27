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
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
    fixtureMode: string;
    gatewayRequest: string;
    gatewayRequestCopy: string;
    gatewayResult: string;
    gatewayResultCopy: string;
    heroCopy: string;
    language: string;
    payloadPreview: string;
    responsePreview: string;
    scenarios: Record<
      CustomerDemoScenarioId,
      {
        assistantMessage: string;
        description: string;
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
      loading: "Loading fixture...",
      replay: "Replay fixture request"
    },
    assistantLabel: "Assistant / Gateway outcome",
    chatPreview: "chat preview",
    context: {
      application: "Application",
      project: "Project",
      tenant: "Tenant"
    },
    detectedNone: "none",
    error: "Unable to load this fixture scenario.",
    fixtureMode: "Gateway validation mode",
    gatewayRequest: "Gateway request",
    gatewayRequestCopy: "Header values are redacted; only prefix/last4 style previews are shown.",
    gatewayResult: "Gateway result",
    gatewayResultCopy: "Fixture response metadata mirrors the v1 Gateway contract.",
    heroCopy:
      "Validate the customer-side Gateway path with controlled governance outcomes before live Gateway integration is enabled.",
    language: "Demo language",
    payloadPreview: "Payload preview",
    responsePreview: "Response preview",
    scenarios: {
      blocked: {
        assistantMessage:
          "No assistant reply was generated because GateLM blocked the request before provider call.",
        description: "Credential-like content is blocked before routing, cache, and provider.",
        title: "Blocked"
      },
      "cache-hit": {
        assistantMessage: "Returned the cached safe answer. Provider call was skipped for this replay.",
        description: "Same safe request resolves to exact cache hit and provider bypass.",
        title: "Cache hit"
      },
      redacted: {
        assistantMessage:
          "Generated a support reply after email and phone placeholders replaced sensitive values.",
        description: "Rule-based safety redacts contact data before provider call.",
        title: "Redaction"
      },
      safe: {
        assistantMessage: "Drafted a concise support reply using the policy-routed mock model.",
        description: "Allowed request through Gateway governance with exact cache miss.",
        title: "Safe request"
      }
    },
    scenarioSelector: "Scenario selector",
    summary: {
      application: "Application",
      cache: "Cache",
      http: "HTTP status",
      latency: "Latency",
      masking: "Masking"
    },
    title: "Enterprise Gateway request validation",
    userLabel: "Customer message",
    webConsole: "Web Console"
  },
  ko: {
    actions: {
      detail: "요청 상세 열기",
      loading: "피스처 로딩 중...",
      replay: "피스처 요청 다시 실행"
    },
    assistantLabel: "Assistant / Gateway 결과",
    chatPreview: "채팅 미리보기",
    context: {
      application: "애플리케이션",
      project: "프로젝트",
      tenant: "테넌트"
    },
    detectedNone: "없음",
    error: "이 피스처 시나리오를 불러오지 못했습니다.",
    fixtureMode: "Gateway 검증 모드",
    gatewayRequest: "Gateway 요청",
    gatewayRequestCopy: "Header 값은 redacted 상태이며 prefix/last4 형식의 preview만 표시합니다.",
    gatewayResult: "Gateway 결과",
    gatewayResultCopy: "피스처 응답 metadata는 v1 Gateway 계약을 따릅니다.",
    heroCopy:
      "실제 Gateway 연동 전, 고객사 요청이 GateLM governance 경로에서 어떻게 판정되는지 통제된 시나리오로 검증합니다.",
    language: "데모 언어",
    payloadPreview: "Payload preview",
    responsePreview: "Response preview",
    scenarios: {
      blocked: {
        assistantMessage: "GateLM이 Provider 호출 전에 요청을 차단했기 때문에 assistant 응답은 생성되지 않았습니다.",
        description: "credential처럼 보이는 내용은 routing, cache, provider 전에 차단됩니다.",
        title: "차단"
      },
      "cache-hit": {
        assistantMessage: "캐시된 safe 응답을 반환했습니다. 이번 replay에서는 Provider 호출을 건너뜁니다.",
        description: "동일한 safe 요청이 exact cache hit와 provider bypass로 처리됩니다.",
        title: "캐시 적중"
      },
      redacted: {
        assistantMessage: "이메일과 전화번호가 placeholder로 대체된 뒤 고객 지원 답변을 생성했습니다.",
        description: "rule-based safety가 Provider 호출 전 연락처 데이터를 redaction합니다.",
        title: "Redaction"
      },
      safe: {
        assistantMessage: "정책 기반 routing을 거친 mock model로 간결한 지원 답변을 작성했습니다.",
        description: "Gateway governance를 통과한 허용 요청이며 exact cache miss입니다.",
        title: "Safe 요청"
      }
    },
    scenarioSelector: "시나리오 선택",
    summary: {
      application: "애플리케이션",
      cache: "캐시",
      http: "HTTP 상태",
      latency: "지연 시간",
      masking: "마스킹"
    },
    title: "엔터프라이즈 Gateway 요청 검증",
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
        <div className="customer-demo-search" aria-label={text.fixtureMode}>
          <span>{text.fixtureMode}</span>
        </div>
        <div className="customer-demo-header-meta">
          <LanguageSwitcher ariaLabel={text.language} locale={locale} />
          <Link href={`/tenants/${model.tenantId}/dashboard`}>{text.webConsole}</Link>
        </div>
      </header>

      <section className="customer-demo-hero">
        <div>
          <p className="console-kicker">customer demo app</p>
          <h1>{text.title}</h1>
          <p>{text.heroCopy}</p>
        </div>
        <dl className="customer-demo-context" aria-label="Demo application context">
          <div>
            <dt>{text.context.tenant}</dt>
            <dd>{model.tenantId}</dd>
          </div>
          <div>
            <dt>{text.context.project}</dt>
            <dd>{model.projectId}</dd>
          </div>
          <div>
            <dt>{text.context.application}</dt>
            <dd>{model.applicationId}</dd>
          </div>
        </dl>
      </section>

      <section className="customer-demo-summary-grid" aria-label="Selected scenario summary">
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

      <section className="customer-demo-layout" aria-label="Customer demo fixture scenarios">
        <aside className="customer-demo-scenarios" aria-label="Scenario selector">
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
                <small>{scenarioText.description}</small>
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
                <CardDescription>{text.gatewayRequestCopy}</CardDescription>
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
                <CardDescription>{text.gatewayResultCopy}</CardDescription>
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
                <Metric label="Request ID" value={exchange.requestId} />
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
