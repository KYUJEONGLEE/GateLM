"use client";

import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { Locale } from "@/lib/i18n/locale";

type OnboardingIntegrationGuideProps = {
  apiKeyStepContent: ReactNode;
  gatewayBaseUrl: string;
  locale: Locale;
  project: ProjectRecord | null;
  selectedModelKey: string;
};

const projectApiKeyPlaceholder = "<PROJECT_API_KEY>";

const integrationText: Record<
  Locale,
  {
    after: string;
    apiKeySave: string;
    apiKeySaveDescription: string;
    before: string;
    endpoint: string;
    header: string;
    subtitle: string;
    test: string;
    title: string;
  }
> = {
  en: {
    after: "After",
    apiKeySave: "Save API Key",
    apiKeySaveDescription: "Create the Project API Key and store the one-time value before changing the application.",
    before: "Before",
    endpoint: "Change endpoint",
    header: "Add auth header",
    subtitle: "Connect existing LLM calls through the GateLM Gateway endpoint.",
    test: "Test request",
    title: "Integration guide"
  },
  ko: {
    after: "변경 후",
    apiKeySave: "API Key 저장",
    apiKeySaveDescription: "애플리케이션 연동 전에 Project API Key를 발급하고 1회 표시 값을 저장하세요.",
    before: "변경 전",
    endpoint: "Endpoint 변경",
    header: "인증 헤더 추가",
    subtitle: "기존 LLM 호출 endpoint를 GateLM Gateway로 바꿔 연결하세요.",
    test: "요청 테스트",
    title: "연동 가이드"
  }
};

export function OnboardingIntegrationGuide({
  apiKeyStepContent,
  gatewayBaseUrl,
  locale,
  project,
  selectedModelKey
}: OnboardingIntegrationGuideProps) {
  const text = integrationText[locale];
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  const gatewayEndpoint = `${gatewayBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const hasSelectedModel = Boolean(selectedModelKey.trim());
  const providerSetupRequired =
    locale === "ko"
      ? "Provider를 등록한 후 모델을 선택하면 테스트 요청을 사용할 수 있습니다."
      : "Register a Provider and select a model to enable the test request.";

  async function copyValue(target: string, value: string) {
    if (!navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedTarget(target);
    } catch {
      setCopiedTarget(null);
    }
  }

  return (
    <div className="integration-guide-shell">
      <div className="integration-guide-titlebar">
        <div>
          <p className="integration-breadcrumb">
            Projects / {project?.name ?? "Project"} / {text.title}
          </p>
          <h3>{text.title}</h3>
          <p>{text.subtitle}</p>
        </div>
      </div>

      <div className="integration-guide-layout">
        <section className="integration-guide-steps" aria-label={text.title}>
          <GuideStep number={1} title={text.apiKeySave}>
            <div className="integration-guide-step-copy">
              <p>{text.apiKeySaveDescription}</p>
            </div>
            {apiKeyStepContent}
          </GuideStep>

          <GuideStep number={2} title={text.endpoint}>
            <div className="integration-value-table">
              <GuideCopyRow
                copied={copiedTarget === "before-endpoint"}
                label={text.before}
                onCopy={() =>
                  void copyValue(
                    "before-endpoint",
                    "https://api.openai.com/v1/chat/completions"
                  )
                }
                value="https://api.openai.com/v1/chat/completions"
              />
              <GuideCopyRow
                copied={copiedTarget === "gateway-endpoint"}
                label={text.after}
                onCopy={() => void copyValue("gateway-endpoint", gatewayEndpoint)}
                value={gatewayEndpoint}
              />
            </div>
          </GuideStep>

          <GuideStep number={3} title={text.header}>
            <div className="integration-header-list">
              <GuideCopyRow
                copied={copiedTarget === "auth-header"}
                label="Authorization"
                onCopy={() =>
                  void copyValue(
                    "auth-header",
                    `Authorization: Bearer ${projectApiKeyPlaceholder}`
                  )
                }
                value={`Authorization: Bearer ${projectApiKeyPlaceholder}`}
              />
            </div>
          </GuideStep>

          <GuideStep number={4} title={text.test}>
            {hasSelectedModel ? (
              <div className="integration-code-block">
                <div>
                  <span>Gateway request</span>
                  <button
                    aria-label="Copy Gateway request"
                    onClick={() =>
                      void copyValue(
                        "gateway-request",
                        getGatewayRequest(gatewayEndpoint)
                      )
                    }
                    type="button"
                  >
                    {copiedTarget === "gateway-request" ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                  </button>
                </div>
                <pre>
                  <code>{getGatewayRequest(gatewayEndpoint)}</code>
                </pre>
              </div>
            ) : (
              <div className="integration-guide-step-copy">
                <p>{providerSetupRequired}</p>
              </div>
            )}
          </GuideStep>
        </section>
      </div>
    </div>
  );
}

function GuideStep({
  children,
  number,
  title
}: {
  children: ReactNode;
  number: number;
  title: string;
}) {
  return (
    <article className="integration-step">
      <div className="integration-step-marker">{number}</div>
      <div className="integration-step-body">
        <h4>{title}</h4>
        {children}
      </div>
    </article>
  );
}

function GuideCopyRow({
  copied,
  label,
  onCopy,
  value
}: {
  copied: boolean;
  label: string;
  onCopy: () => void;
  value: string;
}) {
  return (
    <div className="integration-copy-row">
      <span>{label}</span>
      <code>{value}</code>
      <button aria-label={`Copy ${label}`} onClick={onCopy} type="button">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
    </div>
  );
}

function getGatewayRequest(gatewayEndpoint: string) {
  return [
    `curl -X POST ${gatewayEndpoint} \\`,
    `  -H "Authorization: Bearer ${projectApiKeyPlaceholder}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"auto","messages":[{"role":"user","content":"<USER_MESSAGE>"}]}'`
  ].join("\n");
}
