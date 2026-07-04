import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/server-locale";

export default async function ApplicationPage() {
  const locale = await getRequestLocale();
  const text = locale === "ko" ? copy.ko : copy.en;

  return (
    <main className="application-launcher-shell">
      <section className="application-launcher-main" aria-labelledby="application-title">
        <header className="application-launcher-header">
          <div>
            <p>{text.eyebrow}</p>
            <h1 id="application-title">{text.title}</h1>
          </div>
        </header>

        <div className="application-grid" aria-label={text.gridLabel}>
          <Link className="application-card application-card-active" href="/chat">
            <span className="application-card-icon" aria-hidden="true">
              C
            </span>
            <span className="application-card-content">
              <strong>{text.chat.title}</strong>
              <small>{text.chat.description}</small>
            </span>
            <span className="application-card-status">{text.open}</span>
          </Link>

          <Link className="application-card application-card-active" href="/settings">
            <span className="application-card-icon" aria-hidden="true">
              S
            </span>
            <span className="application-card-content">
              <strong>{text.settings.title}</strong>
              <small>{text.settings.description}</small>
            </span>
            <span className="application-card-status">{text.open}</span>
          </Link>
        </div>
      </section>
    </main>
  );
}

const copy = {
  en: {
    chat: {
      description: "AI assistant for workspace conversations.",
      title: "Chat"
    },
    eyebrow: "Applications",
    gridLabel: "Available applications",
    open: "Open",
    settings: {
      description: "Gateway credential and endpoint status.",
      title: "Settings"
    },
    title: "Choose an application"
  },
  ko: {
    chat: {
      description: "업무 대화를 위한 AI 어시스턴트",
      title: "Chat"
    },
    eyebrow: "Applications",
    gridLabel: "사용 가능한 애플리케이션",
    open: "열기",
    settings: {
      description: "Gateway credential과 endpoint 상태",
      title: "Settings"
    },
    title: "애플리케이션 선택"
  }
};
