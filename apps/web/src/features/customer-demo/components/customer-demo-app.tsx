"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Button } from "@/components/ui/button";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import {
  FixtureGatewayChatClient,
  RouteGatewayChatClient,
  type CustomerDemoExchange,
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
      loading: string;
      replay: string;
      send: string;
    };
    chatPreview: string;
    error: string;
    language: string;
    scenarios: Record<
      CustomerDemoScenarioId,
      {
        title: string;
      }
    >;
    summary: {
      cache: string;
      latency: string;
      masking: string;
    };
    title: string;
    withheld: {
      assistant: string;
      blocked: string;
      cacheHit: string;
      customer: string;
      error: string;
      pending: string;
      rateLimited: string;
      success: string;
    };
    webConsole: string;
  }
> = {
  en: {
    actions: {
      loading: "Processing...",
      replay: "Replay fixture request",
      send: "Send Gateway request"
    },
    chatPreview: "conversation",
    error: "Unable to load this request state.",
    language: "Console language",
    scenarios: {
      blocked: {
        title: "Blocked"
      },
      "cache-hit": {
        title: "Cache hit"
      },
      "rate-limited": {
        title: "Rate limit"
      },
      "provider-fallback": {
        title: "Provider fallback"
      },
      "provider-timeout": {
        title: "Provider timeout"
      },
      redacted: {
        title: "Redaction"
      },
      safe: {
        title: "Safe request"
      }
    },
    summary: {
      cache: "Cache",
      latency: "Latency",
      masking: "Masking"
    },
    title: "Gateway request",
    withheld: {
      assistant: "Gateway response content is withheld from the console. Use metadata and request detail for verification.",
      blocked: "Blocked before provider call.",
      cacheHit: "Served from exact cache.",
      customer: "Customer prompt content is withheld from the console.",
      error: "Gateway returned a sanitized error.",
      pending: "Ready to send through Gateway.",
      rateLimited: "Rate limit applied before provider call.",
      success: "Gateway request completed successfully."
    },
    webConsole: "Web Console"
  },
  ko: {
    actions: {
      loading: "처리 중...",
      replay: "Fixture 요청 재실행",
      send: "Gateway 요청 전송"
    },
    chatPreview: "대화",
    error: "요청 상태를 불러오지 못했습니다.",
    language: "콘솔 언어",
    scenarios: {
      blocked: {
        title: "차단"
      },
      "cache-hit": {
        title: "캐시 적중"
      },
      "rate-limited": {
        title: "Rate limit"
      },
      "provider-fallback": {
        title: "Provider fallback"
      },
      "provider-timeout": {
        title: "Provider timeout"
      },
      redacted: {
        title: "Redaction"
      },
      safe: {
        title: "Safe 요청"
      }
    },
    summary: {
      cache: "캐시",
      latency: "지연 시간",
      masking: "마스킹"
    },
    title: "Gateway 요청",
    withheld: {
      assistant: "Gateway 응답 원문은 콘솔에 표시하지 않습니다. 검증은 metadata와 요청 상세에서 확인합니다.",
      blocked: "Provider 호출 전에 차단되었습니다.",
      cacheHit: "Exact Cache에서 응답했습니다.",
      customer: "고객 prompt 원문은 콘솔에 표시하지 않습니다.",
      error: "Gateway가 정제된 오류만 반환했습니다.",
      pending: "Gateway로 전송할 준비가 되었습니다.",
      rateLimited: "Provider 호출 전에 Rate Limit이 적용되었습니다.",
      success: "Gateway 요청이 성공적으로 완료되었습니다."
    },
    webConsole: "웹 콘솔"
  }
};

type CustomerDemoCopy = (typeof customerDemoText)[Locale];

export function CustomerDemoApp({ locale, model }: CustomerDemoAppProps) {
  const client = useMemo(() => {
    if (model.integrationMode === "gateway") {
      return new RouteGatewayChatClient(model.tenantId);
    }

    return new FixtureGatewayChatClient(model.scenarios);
  }, [model.integrationMode, model.scenarios, model.tenantId]);
  const [exchange, setExchange] = useState<CustomerDemoExchange>(() => buildInitialExchange(model));
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const hasScenarios = model.scenarios.length > 0;
  const text = customerDemoText[locale];
  const exchangeText = text.scenarios[exchange.scenarioId];
  const chatMessages = getChatMessages(exchange, locale, text);

  const sendScenario = useCallback(async (
    scenarioId: CustomerDemoScenarioId,
    options: { stream?: boolean } = {}
  ) => {
    if (requestInFlight.current) {
      return;
    }

    const scenario = model.scenarios.find((item) => item.scenarioId === scenarioId);

    requestInFlight.current = true;
    setIsLoading(true);
    setLoadError(null);

    try {
      if (scenario && model.integrationMode === "gateway") {
        setExchange(buildPendingExchange(model, scenario, options));
      }

      setExchange(await client.sendChatCompletion(scenarioId, options));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : text.error);
    } finally {
      requestInFlight.current = false;
      setIsLoading(false);
    }
  }, [client, model, text.error]);

  return (
    <main className="customer-demo-shell customer-chat-shell">
      <header className="customer-demo-header">
        <Link className="customer-demo-brand" href="/">
          <span>AC</span>
          <strong>Acme Local Application</strong>
        </Link>
        <div className="customer-demo-header-meta">
          <LanguageSwitcher ariaLabel={text.language} locale={locale} />
          <Link href={`/tenants/${model.tenantId}/dashboard`}>{text.webConsole}</Link>
        </div>
      </header>

      <section className="customer-chat-stage" aria-label="Local application chat">
        <section className="customer-chat-phone" aria-busy={isLoading}>
          <header className="customer-chat-phone-header">
            <button aria-label="Back" className="customer-chat-icon-button" type="button">
              ‹
            </button>
            <div className="customer-chat-room">
              <div className="customer-chat-room-avatars" aria-hidden="true">
                <span>T</span>
                <span>M</span>
                <span>G</span>
              </div>
              <div>
                <h1>{text.title}</h1>
                <p>
                  {formatDisplayIdentifier(model.applicationId)} · {exchangeText.title}
                </p>
              </div>
            </div>
            <Link
              aria-label={text.webConsole}
              className="customer-chat-icon-button"
              href={`/tenants/${model.tenantId}/dashboard`}
            >
              ⋯
            </Link>
          </header>

          <div className="customer-chat-thread" aria-label={text.chatPreview}>
            {loadError ? <p className="customer-demo-error">{loadError}</p> : null}
            {chatMessages.map((message) => (
              <article
                className="customer-chat-message"
                data-side={message.side}
                key={message.id}
              >
                {message.side === "incoming" ? (
                  <span className="customer-chat-avatar" aria-hidden="true">
                    {message.avatar}
                  </span>
                ) : null}
                <div className="customer-chat-message-body">
                  <span>{message.author}</span>
                  <p>{message.body}</p>
                </div>
                {message.side === "outgoing" ? (
                  <span className="customer-chat-avatar" aria-hidden="true">
                    {message.avatar}
                  </span>
                ) : null}
              </article>
            ))}
            {isLoading ? (
              <div className="customer-chat-typing" aria-label={text.actions.loading}>
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </div>

          <footer className="customer-chat-composer">
            <div className="customer-chat-tools">
              <button aria-label="Add attachment" type="button">+</button>
              <button aria-label="Open camera" type="button">◉</button>
              <button aria-label="Open image picker" type="button">▧</button>
              <button aria-label="Record voice" type="button">♬</button>
            </div>
            <div className="customer-chat-input">
              <span>Aa</span>
              <strong>{text.withheld.customer}</strong>
            </div>
            <button className="customer-chat-emoji" type="button" aria-label="Emoji">
              ☺
            </button>
            <Button
              className="customer-chat-send-button"
              disabled={isLoading || !hasScenarios}
              onClick={() => sendScenario(exchange.scenarioId)}
              type="button"
            >
              {isLoading
                ? text.actions.loading
                : model.integrationMode === "gateway"
                  ? text.actions.send
                  : text.actions.replay}
            </Button>
          </footer>
        </section>
      </section>
    </main>
  );
}

function buildInitialExchange(model: CustomerDemoModel): CustomerDemoExchange {
  const base = model.scenarios[0] ?? buildEmptyExchange(model);

  if (model.integrationMode !== "gateway") {
    return base;
  }

  return buildPendingExchange(model, base);
}

function buildPendingExchange(
  model: CustomerDemoModel,
  scenario: CustomerDemoExchange,
  options: { stream?: boolean } = {}
): CustomerDemoExchange {
  const streamRequested = options.stream === true;

  return {
    ...scenario,
    assistantMessage: "Ready to send this scenario through the live Gateway.",
    cacheStatus: "pending",
    httpStatus: 0,
    latencyMs: 0,
    providerCall: "skipped",
    request: {
      ...scenario.request,
      body: {
        ...scenario.request.body,
        stream: streamRequested
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
    streaming: {
      completed: null,
      contentType: null,
      chunkCount: null,
      requested: streamRequested
    },
    title: scenario.title
  };
}

function buildEmptyExchange(model: CustomerDemoModel): CustomerDemoExchange {
  return {
    assistantMessage: "No customer demo scenario is configured.",
    cacheStatus: "not-configured",
    description: "Customer demo scenarios are not available for this tenant application.",
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
            content: "No customer demo scenario is configured."
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
    requestId: "not-configured",
    requestLogHref: `/tenants/${model.tenantId}/request-logs`,
    response: {
      body: {
        status: "not-configured"
      },
      headers: [],
      statusCode: 0
    },
    scenarioId: "safe",
    status: "not-configured",
    streaming: {
      completed: null,
      contentType: null,
      chunkCount: null,
      requested: false
    },
    title: "No scenario configured"
  };
}

function getChatMessages(
  exchange: CustomerDemoExchange,
  locale: Locale,
  text: CustomerDemoCopy
) {
  const isKorean = locale === "ko";

  return [
    {
      author: "Travis",
      avatar: "T",
      body: isKorean
        ? "오늘 고객 응대 문구를 Gateway 경로로 확인해보자."
        : "Let's run this support reply through the Gateway path.",
      id: "travis-open",
      side: "incoming" as const
    },
    {
      author: "You",
      avatar: "Y",
      body: text.withheld.customer,
      id: "user-prompt",
      side: "outgoing" as const
    },
    {
      author: "Michael",
      avatar: "M",
      body: getSafeOutcomeMessage(exchange, text.withheld),
      id: "michael-outcome",
      side: "incoming" as const
    },
    {
      author: "You",
      avatar: "Y",
      body: `${text.summary.cache}: ${exchange.cacheStatus} · ${text.summary.masking}: ${exchange.maskingAction}`,
      id: "user-metadata",
      side: "outgoing" as const
    },
    {
      author: "Gina",
      avatar: "G",
      body: `HTTP ${exchange.httpStatus} · ${text.summary.latency} ${exchange.latencyMs} ms`,
      id: "gina-status",
      side: "incoming" as const
    }
  ];
}

function getSafeOutcomeMessage(
  exchange: CustomerDemoExchange,
  text: {
    assistant: string;
    blocked: string;
    cacheHit: string;
    error: string;
    pending: string;
    rateLimited: string;
    success: string;
  }
) {
  if (exchange.status === "pending") {
    return text.pending;
  }

  if (exchange.status === "blocked") {
    return text.blocked;
  }

  if (exchange.status === "rate_limited") {
    return text.rateLimited;
  }

  if (exchange.status === "cache_hit") {
    return text.cacheHit;
  }

  if (exchange.status === "success") {
    return text.success;
  }

  if (exchange.status === "error") {
    return text.error;
  }

  return text.assistant;
}
