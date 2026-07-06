import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/server-locale";

const gatewayUrlKeys = ["GATELM_GATEWAY_BASE_URL", "GATEWAY_BASE_URL"] as const;
const apiKeyKeys = ["GATELM_GATEWAY_API_KEY", "GATEWAY_API_KEY", "GATELM_DEMO_API_KEY"] as const;
const appTokenKeys = [
  "GATELM_GATEWAY_APP_TOKEN",
  "GATEWAY_APP_TOKEN",
  "GATELM_DEMO_APP_TOKEN"
] as const;
const chatModelKeys = ["GATELM_APPLICATION_CHAT_MODEL", "GATEWAY_APPLICATION_CHAT_MODEL"] as const;

export default async function ApplicationSettingsPage() {
  const locale = await getRequestLocale();
  const text = locale === "ko" ? copy.ko : copy.en;
  const gatewayUrl = getEnvStatus(gatewayUrlKeys, "http://localhost:8080");
  const apiKey = getEnvStatus(apiKeyKeys);
  const appToken = getEnvStatus(appTokenKeys);
  const chatModel = getEnvStatus(chatModelKeys, "auto");
  const routingMode = chatModel.value === "auto" ? text.gatewayPolicyRouting : chatModel.value;

  return (
    <main className="application-launcher-shell">
      <section className="application-launcher-main" aria-labelledby="application-settings-title">
        <header className="application-launcher-header">
          <div>
            <p>{text.eyebrow}</p>
            <h1 id="application-settings-title">{text.title}</h1>
          </div>
          <Link className="application-settings-back" href="/">
            {text.back}
          </Link>
        </header>

        <section className="application-settings-panel" aria-label={text.statusLabel}>
          <SettingRow
            label={text.gatewayUrl}
            status={gatewayUrl.configured ? text.configured : text.defaulted}
            value={gatewayUrl.value}
          />
          <SettingRow
            label={text.apiKey}
            status={apiKey.configured ? text.configured : text.missing}
            value={apiKey.configured ? text.secretConfigured : text.secretMissing}
          />
          <SettingRow
            label={text.appToken}
            status={appToken.configured ? text.configured : text.missing}
            value={appToken.configured ? text.secretConfigured : text.secretMissing}
          />
          <SettingRow
            label={text.routing}
            status={chatModel.configured ? text.configured : text.defaulted}
            value={routingMode}
          />
        </section>
      </section>
    </main>
  );
}

function SettingRow({
  label,
  status,
  value
}: {
  label: string;
  status: string;
  value: string;
}) {
  return (
    <div className="application-settings-row">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{status}</em>
    </div>
  );
}

function getEnvStatus(keys: readonly string[], fallback = "") {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return {
        configured: true,
        key,
        value
      };
    }
  }

  return {
    configured: false,
    key: "",
    value: fallback
  };
}

const copy = {
  en: {
    apiKey: "API Key",
    appToken: "App Token",
    back: "Back",
    configured: "Configured",
    defaulted: "Default",
    eyebrow: "Application settings",
    gatewayUrl: "Gateway URL",
    missing: "Missing",
    routing: "Routing",
    gatewayPolicyRouting: "Gateway policy routing",
    secretConfigured: "Stored in server env",
    secretMissing: "Not configured",
    statusLabel: "Gateway settings status",
    title: "Gateway connection"
  },
  ko: {
    apiKey: "API Key",
    appToken: "App Token",
    back: "뒤로",
    configured: "설정됨",
    defaulted: "기본값",
    eyebrow: "Application settings",
    gatewayUrl: "Gateway URL",
    missing: "누락",
    routing: "Routing",
    gatewayPolicyRouting: "Gateway policy routing",
    secretConfigured: "서버 env에 저장됨",
    secretMissing: "설정되지 않음",
    statusLabel: "Gateway 설정 상태",
    title: "Gateway 연결"
  }
};
