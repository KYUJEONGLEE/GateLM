import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/server-locale";

const gatewayUrlKeys = ["GATELM_GATEWAY_BASE_URL", "GATEWAY_BASE_URL"] as const;
const explicitApiKeyKeys = ["GATELM_GATEWAY_API_KEY", "GATEWAY_API_KEY"] as const;
const localApiKeyKeys = [
  "GATELM_GATEWAY_API_KEY",
  "GATEWAY_API_KEY",
  "GATELM_DEMO_API_KEY"
] as const;
const streamingKeys = [
  "GATELM_APPLICATION_CHAT_STREAMING_ENABLED",
  "GATEWAY_APPLICATION_CHAT_STREAMING_ENABLED"
] as const;

export default async function ApplicationSettingsPage() {
  const locale = await getRequestLocale();
  const text = locale === "ko" ? copy.ko : copy.en;
  const gatewayUrl = getEnvStatus(gatewayUrlKeys, "http://localhost:8080");
  const apiKey = getSecretEnvStatus(
    isProductionLikeEnv() ? explicitApiKeyKeys : localApiKeyKeys
  );
  const streaming = getEnvStatus(streamingKeys, "true");
  const streamingMode = parseBooleanString(streaming.value, true) ? text.enabled : text.disabled;

  return (
    <main className="application-launcher-shell">
      <section className="application-launcher-main" aria-labelledby="application-settings-title">
        <header className="application-launcher-header application-settings-header">
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
            label={text.routing}
            status={text.policy}
            value={text.gatewayPolicyRouting}
          />
          <SettingRow
            label={text.streaming}
            status={streaming.configured ? text.configured : text.defaulted}
            value={streamingMode}
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

function getSecretEnvStatus(keys: readonly string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value && !isPlaceholderSecret(value)) {
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
    value: ""
  };
}

function isPlaceholderSecret(value: string) {
  const normalized = value.trim().toLowerCase();

  return (
    normalized.includes("replace-me") ||
    normalized === "gsk_live_replace_me" ||
    normalized === "glm_api_test_redacted" ||
    normalized === "replace_me" ||
    normalized === "your_gateway_api_key"
  );
}

function parseBooleanString(value: string, fallback: boolean) {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

function isProductionLikeEnv() {
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  if (
    process.env.AWS_EXECUTION_ENV ||
    process.env.ECS_CONTAINER_METADATA_URI ||
    process.env.ECS_CONTAINER_METADATA_URI_V4
  ) {
    return true;
  }

  const deploymentEnv = (
    process.env.GATELM_DEPLOYMENT_ENV ??
    process.env.APPLICATION_DEPLOYMENT_ENV ??
    process.env.DEPLOYMENT_ENV ??
    process.env.APP_ENV ??
    ""
  )
    .trim()
    .toLowerCase();

  return [
    "aws",
    "aws-triage",
    "prod",
    "production",
    "release",
    "selfhost",
    "staging",
    "stage"
  ].includes(deploymentEnv);
}

const copy = {
  en: {
    apiKey: "API Key",
    back: "Back",
    configured: "Configured",
    defaulted: "Default",
    disabled: "Disabled",
    enabled: "Enabled",
    eyebrow: "Application settings",
    gatewayUrl: "Gateway URL",
    missing: "Missing",
    policy: "Policy",
    routing: "Routing",
    gatewayPolicyRouting: "Gateway policy routing",
    secretConfigured: "Stored in server env",
    secretMissing: "Not configured",
    statusLabel: "Gateway settings status",
    streaming: "Streaming",
    title: "Gateway connection"
  },
  ko: {
    apiKey: "API Key",
    back: "뒤로",
    configured: "설정됨",
    defaulted: "기본값",
    disabled: "꺼짐",
    enabled: "켜짐",
    eyebrow: "Application settings",
    gatewayUrl: "Gateway URL",
    missing: "누락",
    policy: "정책",
    routing: "Routing",
    gatewayPolicyRouting: "Gateway policy routing",
    secretConfigured: "서버 env에 저장됨",
    secretMissing: "설정되지 않음",
    statusLabel: "Gateway 설정 상태",
    streaming: "Streaming",
    title: "Gateway 연결"
  }
};
