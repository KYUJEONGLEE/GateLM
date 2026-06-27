import Link from "next/link";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/lib/i18n/locale";

const readinessItems = [
  {
    label: "Workspace",
    value: "pnpm monorepo"
  },
  {
    label: "Runtime",
    value: "Node 22 / pnpm 9.15"
  },
  {
    label: "App Router",
    value: "enabled"
  }
];

const fixtureTenantId = "tenant_demo_acme";

type WebConsoleInitViewProps = {
  locale: Locale;
};

const initText: Record<
  Locale,
  {
    actions: {
      chat: string;
      dashboard: string;
      onboarding: string;
      requestLogs: string;
    };
    copy: string;
    language: string;
    title: string;
  }
> = {
  en: {
    actions: {
      chat: "Open customer demo",
      dashboard: "Open dashboard",
      onboarding: "Start onboarding",
      requestLogs: "View request logs"
    },
    copy: "Product experience and customer demo workspace for the v1.0.0 gateway baseline.",
    language: "Console language",
    title: "Web Console"
  },
  ko: {
    actions: {
      chat: "고객사 데모 열기",
      dashboard: "대시보드 열기",
      onboarding: "온보딩 시작",
      requestLogs: "요청 로그 보기"
    },
    copy: "v1.0.0 Gateway baseline을 설명하고 검증하기 위한 제품 경험 및 고객사 데모 작업 공간입니다.",
    language: "콘솔 언어",
    title: "웹 콘솔"
  }
};

export function WebConsoleInitView({ locale }: WebConsoleInitViewProps) {
  const text = initText[locale];

  return (
    <main className="init-shell">
      <section className="init-panel" aria-labelledby="init-title">
        <div>
          <div className="init-heading-row">
            <p className="init-label">GateLM</p>
            <LanguageSwitcher ariaLabel={text.language} locale={locale} />
          </div>
          <h1 id="init-title">{text.title}</h1>
          <p className="init-copy">{text.copy}</p>
          <div className="init-actions">
            <Link className="primary-link" href={`/tenants/${fixtureTenantId}/chat`}>
              {text.actions.chat}
            </Link>
            <Link className="primary-link" href={`/tenants/${fixtureTenantId}/onboarding`}>
              {text.actions.onboarding}
            </Link>
            <Link className="primary-link" href={`/tenants/${fixtureTenantId}/dashboard`}>
              {text.actions.dashboard}
            </Link>
            <Link className="back-link" href={`/tenants/${fixtureTenantId}/request-logs`}>
              {text.actions.requestLogs}
            </Link>
          </div>
        </div>

        <dl className="readiness-grid" aria-label="Web console setup status">
          {readinessItems.map((item) => (
            <div className="readiness-item" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
