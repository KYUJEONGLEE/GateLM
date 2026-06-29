import Link from "next/link";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/lib/i18n/locale";

const defaultTenantId = "tenant_demo_acme";

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
    language: string;
    title: string;
  }
> = {
  en: {
    actions: {
      chat: "Gateway request",
      dashboard: "Dashboard",
      onboarding: "Management",
      requestLogs: "Request logs"
    },
    language: "Console language",
    title: "Web Console"
  },
  ko: {
    actions: {
      chat: "Gateway 요청",
      dashboard: "대시보드",
      onboarding: "관리",
      requestLogs: "요청 로그"
    },
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
          <div className="init-actions">
            <Link className="primary-link" href={`/tenants/${defaultTenantId}/chat`}>
              {text.actions.chat}
            </Link>
            <Link className="primary-link" href={`/tenants/${defaultTenantId}/onboarding`}>
              {text.actions.onboarding}
            </Link>
            <Link className="primary-link" href={`/tenants/${defaultTenantId}/dashboard`}>
              {text.actions.dashboard}
            </Link>
            <Link className="back-link" href={`/tenants/${defaultTenantId}/request-logs`}>
              {text.actions.requestLogs}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
