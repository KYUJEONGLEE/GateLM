"use client";

import { Check, Copy, ScrollText, Settings2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type OnboardingIntegrationGuideProps = {
  gatewayBaseUrl: string;
  locale: Locale;
  project: ProjectRecord | null;
  selectedModelKey: string;
  tenantId: string;
};

const projectApiKeyPlaceholder = "<PROJECT_API_KEY>";

const integrationText: Record<
  Locale,
  {
    after: string;
    appInfo: string;
    before: string;
    budget: string;
    createdAt: string;
    endpoint: string;
    header: string;
    model: string;
    nextChecks: string;
    nextChecksDescription: string;
    projectPolicySettings: string;
    reviewLatestRequest: string;
    status: string;
    subtitle: string;
    test: string;
    title: string;
  }
> = {
  en: {
    after: "After",
    appInfo: "Project",
    before: "Before",
    budget: "Budget",
    createdAt: "Created",
    endpoint: "Change endpoint",
    header: "Add auth header",
    model: "Model",
    nextChecks: "Next checks",
    nextChecksDescription:
      "Use the latest Gateway log to confirm the test request, then tune the project policy.",
    projectPolicySettings: "Project Policy settings",
    reviewLatestRequest: "Review latest request",
    status: "Status",
    subtitle: "Connect existing LLM calls through the GateLM Gateway endpoint.",
    test: "Test request",
    title: "Integration guide"
  },
  ko: {
    after: "변경 후",
    appInfo: "Project",
    before: "변경 전",
    budget: "예산",
    createdAt: "생성",
    endpoint: "Endpoint 변경",
    header: "인증 헤더 추가",
    model: "모델",
    nextChecks: "다음 확인",
    nextChecksDescription:
      "최신 Gateway 로그에서 테스트 요청을 확인하고, 이어서 Project 정책을 조정하세요.",
    projectPolicySettings: "Project Policy 설정",
    reviewLatestRequest: "방금 보낸 요청 확인",
    status: "상태",
    subtitle: "기존 LLM 호출 endpoint를 GateLM Gateway로 바꿔 연결하세요.",
    test: "요청 테스트",
    title: "연동 가이드"
  }
};

export function OnboardingIntegrationGuide({
  gatewayBaseUrl,
  locale,
  project,
  selectedModelKey,
  tenantId
}: OnboardingIntegrationGuideProps) {
  const text = integrationText[locale];
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  const gatewayEndpoint = `${gatewayBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const latestRequestHref = getLatestRequestHref(tenantId, project);
  const projectPolicyHref = project?.id
    ? `/tenants/${tenantId}/projects/${project.id}/policies`
    : `/tenants/${tenantId}/projects`;

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
          <GuideStep number={1} title={text.endpoint}>
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

          <GuideStep number={2} title={text.header}>
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

          <GuideStep number={3} title={text.test}>
            <div className="integration-code-block">
              <div>
                <span>Gateway request</span>
                <button
                  aria-label="Copy Gateway request"
                  onClick={() =>
                    void copyValue(
                      "gateway-request",
                      getGatewayRequest(gatewayEndpoint, selectedModelKey)
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
                <code>{getGatewayRequest(gatewayEndpoint, selectedModelKey)}</code>
              </pre>
            </div>
          </GuideStep>
        </section>

        <aside className="integration-guide-side">
          <section className="integration-side-panel">
            <div className="integration-side-heading">
              <h4>{text.appInfo}</h4>
            </div>
            <dl className="integration-meta-list">
              <div>
                <dt>Name</dt>
                <dd>{project?.name ?? "Project"}</dd>
              </div>
              <div>
                <dt>{text.status}</dt>
                <dd>
                  <span className="integration-status-dot">{project?.status ?? "ACTIVE"}</span>
                </dd>
              </div>
              <div>
                <dt>{text.budget}</dt>
                <dd>${project?.totalBudgetUsd ?? 0} fixed</dd>
              </div>
              <div>
                <dt>{text.model}</dt>
                <dd>{selectedModelKey || "auto"}</dd>
              </div>
              <div>
                <dt>{text.createdAt}</dt>
                <dd>{project?.createdAt ? formatDateTime(project.createdAt) : "-"}</dd>
              </div>
            </dl>
          </section>

          <section className="integration-side-panel integration-next-panel">
            <div className="integration-side-heading">
              <h4>{text.nextChecks}</h4>
              <p>{text.nextChecksDescription}</p>
            </div>
            <div className="integration-next-actions">
              <Link className="primary-button" href={latestRequestHref}>
                <ScrollText aria-hidden="true" />
                {text.reviewLatestRequest}
              </Link>
              <Link className="secondary-button" href={projectPolicyHref}>
                <Settings2 aria-hidden="true" />
                {text.projectPolicySettings}
              </Link>
            </div>
          </section>
        </aside>
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

function getGatewayRequest(gatewayEndpoint: string, selectedModelKey: string) {
  const model = selectedModelKey.split("::")[1] || "auto";

  return [
    `curl -X POST ${gatewayEndpoint} \\`,
    `  -H "Authorization: Bearer ${projectApiKeyPlaceholder}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"<USER_MESSAGE>"}]}'`
  ].join("\n");
}

function getLatestRequestHref(tenantId: string, project: ProjectRecord | null) {
  const query = new URLSearchParams({
    latest: "project"
  });

  if (project?.id) {
    query.set("projectId", project.id);
  }

  if (project?.runtimeApplicationId) {
    query.set("applicationId", project.runtimeApplicationId);
  }

  return `/tenants/${tenantId}/request-logs?${query.toString()}`;
}
