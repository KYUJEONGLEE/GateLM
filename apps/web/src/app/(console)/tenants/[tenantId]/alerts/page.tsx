import type { Locale } from "@/lib/i18n/locale";
import { getRequestLocale } from "@/lib/i18n/server-locale";

const alertsPageText: Record<
  Locale,
  {
    body: string;
    comingSoon: string;
    kicker: string;
    title: string;
    teaser: string;
  }
> = {
  en: {
    body: "Budget, provider, latency, and safety alerts will be managed here.",
    comingSoon: "Coming soon",
    kicker: "Monitoring",
    teaser: "Alert rules and notification history will be shown here.",
    title: "Alerts"
  },
  ko: {
    body: "예산, Provider, 지연 시간, Safety 알림을 이곳에서 관리할 예정입니다.",
    comingSoon: "준비 중",
    kicker: "모니터링",
    teaser: "알림 규칙과 알림 이력이 이곳에 표시됩니다.",
    title: "알림"
  }
};

export default async function AlertsPage() {
  const locale = await getRequestLocale();
  const text = alertsPageText[locale];

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.kicker}</p>
          <h2>{text.title}</h2>
          <p>{text.body}</p>
        </div>
      </section>

      <section className="console-panel monitoring-placeholder-card">
        <div className="panel-heading">
          <h3>{text.comingSoon}</h3>
          <p>{text.teaser}</p>
        </div>
      </section>
    </main>
  );
}
