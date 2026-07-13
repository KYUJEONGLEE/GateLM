import { ArrowLeft, CircleDollarSign, Clock3, MessageSquareText, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { getTenantEmployees } from "@/lib/control-plane/employees-client";
import {
  getTenantChatDashboard,
  getTenantChatInvocations
} from "@/lib/control-plane/tenant-chat-observability-client";
import {
  formatInteger,
  formatLatency,
  formatUsd
} from "@/lib/formatting/formatters";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type TenantChatPageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantChatPage({ params }: TenantChatPageProps) {
  const { tenantId } = await params;
  const [auth, locale] = await Promise.all([
    getCurrentConsoleAuth(),
    getRequestLocale()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  if (!effectiveTenantId) {
    notFound();
  }

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const [dashboard, invocations, employees] = await Promise.all([
    getTenantChatDashboard(effectiveTenantId, from.toISOString(), to.toISOString()),
    getTenantChatInvocations(effectiveTenantId, from.toISOString(), to.toISOString()),
    getTenantEmployees(effectiveTenantId)
  ]);
  const text = locale === "ko" ? koreanText : englishText;
  const employeeNames = new Map(
    employees.map((employee) => [employee.id, employee.name] as const)
  );

  if (!dashboard || !invocations) {
    return (
      <main className="console-content tenant-chat-observability">
        <header className="tenant-chat-observability-header">
          <h1>{text.title}</h1>
          <Link href={`/tenants/${effectiveTenantId}/dashboard`}>
            <ArrowLeft aria-hidden="true" size={17} />
            {text.back}
          </Link>
        </header>
        <p className="tenant-chat-observability-empty">{text.unavailable}</p>
      </main>
    );
  }

  const metrics = [
    {
      icon: MessageSquareText,
      label: text.requests,
      value: formatInteger(dashboard.requests.total)
    },
    {
      icon: Users,
      label: text.users,
      value: formatInteger(dashboard.requests.activeUsers)
    },
    {
      icon: CircleDollarSign,
      label: text.cost,
      value: formatMicroUsd(dashboard.usage.confirmedCostMicroUsd)
    },
    {
      icon: Clock3,
      label: text.latency,
      value: formatLatency(dashboard.latency.p95Ms)
    }
  ];

  return (
    <main className="console-content tenant-chat-observability">
      <header className="tenant-chat-observability-header">
        <div>
          <h1>{text.title}</h1>
          <span data-state={dashboard.freshness.state}>{text.freshness[dashboard.freshness.state]}</span>
        </div>
        <Link href={`/tenants/${effectiveTenantId}/dashboard`}>
          <ArrowLeft aria-hidden="true" size={17} />
          {text.back}
        </Link>
      </header>

      <section className="tenant-chat-metrics" aria-label={text.summary}>
        {metrics.map(({ icon: Icon, label, value }) => (
          <div key={label}>
            <span><Icon aria-hidden="true" size={18} />{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="tenant-chat-policy-summary" aria-label={text.policy}>
        <div><span>{text.tokens}</span><strong>{formatInteger(dashboard.usage.confirmedTotalTokens)}</strong></div>
        <div><span>{text.economy}</span><strong>{formatInteger(dashboard.policyStates.quota.economy)}</strong></div>
        <div><span>{text.fallback}</span><strong>{formatInteger(dashboard.requests.fallbackSucceeded)}</strong></div>
        <div><span>{text.unconfirmed}</span><strong>{formatInteger(dashboard.usage.unconfirmedIncidentCount)}</strong></div>
      </section>

      <section className="tenant-chat-invocations">
        <div className="tenant-chat-invocations-heading">
          <h2>{text.recent}</h2>
          <span>{text.last24Hours}</span>
        </div>
        <div className="tenant-chat-invocation-table" role="table" aria-label={text.recent}>
          <div className="tenant-chat-invocation-row tenant-chat-invocation-columns" role="row">
            <span>{text.time}</span><span>{text.employee}</span><span>{text.model}</span>
            <span>{text.tokens}</span><span>{text.cost}</span><span>{text.state}</span>
          </div>
          {invocations.length === 0 ? (
            <p className="tenant-chat-observability-empty">{text.empty}</p>
          ) : invocations.map((invocation) => (
            <div className="tenant-chat-invocation-row" role="row" key={invocation.requestId}>
              <span>{formatTime(invocation.completedAt, locale)}</span>
              <strong>{invocation.employeeId ? employeeNames.get(invocation.employeeId) ?? text.unknownEmployee : text.admin}</strong>
              <span>{[invocation.providerId, invocation.modelKey].filter(Boolean).join(" / ") || "-"}</span>
              <span>{formatInteger(invocation.confirmedTotalTokens)}</span>
              <span>{formatMicroUsd(invocation.confirmedCostMicroUsd)}</span>
              <span data-policy-state={invocation.quotaState}>{invocation.quotaState}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const koreanText = {
  title: "Tenant Chat",
  back: "프로젝트 대시보드",
  summary: "Tenant Chat 요약",
  requests: "요청",
  users: "사용자",
  cost: "확정 비용",
  latency: "P95 지연",
  policy: "사용량 상태",
  tokens: "확정 토큰",
  economy: "절약 모드",
  fallback: "Fallback 성공",
  unconfirmed: "미확정 사용량",
  recent: "최근 요청",
  last24Hours: "최근 24시간",
  time: "요청 시각",
  employee: "직원",
  model: "Provider / 모델",
  state: "Quota 상태",
  admin: "Tenant 관리자",
  unknownEmployee: "알 수 없는 직원",
  empty: "최근 Tenant Chat 요청이 없습니다.",
  unavailable: "Tenant Chat 집계 데이터를 불러올 수 없습니다.",
  freshness: { fresh: "최신", stale: "지연", partial: "일부 처리 중" }
} as const;

const englishText = {
  ...koreanText,
  back: "Project dashboard",
  summary: "Tenant Chat summary",
  requests: "Requests",
  users: "Users",
  cost: "Confirmed cost",
  latency: "P95 latency",
  policy: "Usage state",
  tokens: "Confirmed tokens",
  economy: "Economy mode",
  fallback: "Fallback success",
  unconfirmed: "Unconfirmed usage",
  recent: "Recent requests",
  last24Hours: "Last 24 hours",
  time: "Time",
  employee: "Employee",
  model: "Provider / model",
  state: "Quota state",
  admin: "Tenant admin",
  unknownEmployee: "Unknown employee",
  empty: "No recent Tenant Chat requests.",
  unavailable: "Tenant Chat aggregates are unavailable.",
  freshness: { fresh: "Fresh", stale: "Delayed", partial: "Processing" }
} as const;

function formatTime(value: string, locale: "ko" | "en") {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function formatMicroUsd(value: number) {
  return formatUsd((value / 1_000_000).toFixed(value > 0 && value < 1_000_000 ? 6 : 2));
}
