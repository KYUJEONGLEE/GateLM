"use client";

import { PlugZap, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ProviderConnectionFormValues,
  ProviderConnectionRecord,
  ProviderConnectionsModel,
  ProviderConnectionStatus
} from "@/lib/control-plane/provider-connections-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ProviderConnectionManagementProps = {
  locale: Locale;
  model: ProviderConnectionsModel;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ProviderResponsePayload = {
  error?: string;
  provider?: ProviderConnectionRecord;
};

const providerStatuses: ProviderConnectionStatus[] = ["ACTIVE", "DEGRADED", "DISABLED"];
const providerKeyPattern = /^[a-z][a-z0-9_-]{1,63}$/;
const minProviderTimeoutMs = 1000;
const maxProviderTimeoutMs = 120000;

const emptyProviderForm: ProviderConnectionFormValues = {
  adapterType: "openai_compatible",
  apiVersion: "",
  baseUrl: "",
  credentialRequired: true,
  credentialLast4: "",
  credentialPrefix: "",
  displayName: "",
  failureMode: "fail_closed",
  models: "",
  provider: "",
  requestFormat: "openai_chat_completions",
  resolver: "none",
  secretRef: "",
  status: "ACTIVE",
  timeoutMs: 30000
};

const providerText: Record<
  Locale,
  {
    adapterType: string;
    apiVersion: string;
    baseUrl: string;
    created: string;
    credential: string;
    credentialRequired: string;
    credentialLast4: string;
    credentialPrefix: string;
    displayName: string;
    empty: string;
    fixtureFallback: string;
    management: string;
    models: string;
    failureMode: string;
    projectId: string;
    provider: string;
    providerConfig: string;
    providerId: string;
    register: string;
    requestFormat: string;
    resolver: string;
    save: string;
    secretRef: string;
    source: string;
    status: string;
    timeoutMs: string;
    title: string;
    updated: string;
  }
> = {
  en: {
    adapterType: "Adapter type",
    apiVersion: "API version",
    baseUrl: "Base URL",
    created: "Created",
    credential: "Credential preview",
    credentialRequired: "Credential required",
    credentialLast4: "Credential last 4",
    credentialPrefix: "Credential prefix",
    displayName: "Display name",
    empty: "No provider connections found.",
    fixtureFallback: "Control Plane unavailable. Showing fixture provider connection.",
    management: "management",
    models: "Models",
    failureMode: "Failure mode",
    projectId: "Project ID",
    provider: "Provider key",
    providerConfig: "Provider config",
    providerId: "Provider ID",
    register: "Register provider",
    requestFormat: "Request format",
    resolver: "Resolver",
    save: "Save",
    secretRef: "Secret reference",
    source: "Source",
    status: "Status",
    timeoutMs: "Timeout ms",
    title: "Providers",
    updated: "Updated"
  },
  ko: {
    adapterType: "Adapter type",
    apiVersion: "API version",
    baseUrl: "Base URL",
    created: "생성",
    credential: "Credential preview",
    credentialRequired: "Credential required",
    credentialLast4: "Credential last 4",
    credentialPrefix: "Credential prefix",
    displayName: "표시 이름",
    empty: "Provider connection이 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture Provider connection을 표시 중입니다.",
    management: "관리",
    models: "Models",
    failureMode: "Failure mode",
    projectId: "Project ID",
    provider: "Provider key",
    providerConfig: "Provider config",
    providerId: "Provider ID",
    register: "Provider 등록",
    requestFormat: "Request format",
    resolver: "Resolver",
    save: "저장",
    secretRef: "Secret reference",
    source: "출처",
    status: "상태",
    timeoutMs: "Timeout ms",
    title: "Provider",
    updated: "수정"
  }
};

export function ProviderConnectionManagement({
  locale,
  model
}: ProviderConnectionManagementProps) {
  const router = useRouter();
  const text = providerText[locale];
  const [providers, setProviders] = useState<ProviderConnectionRecord[]>(model.providers);
  const [formValues, setFormValues] =
    useState<ProviderConnectionFormValues>(getInitialProviderForm(model.providers));
  const [pendingAction, setPendingAction] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });

  async function submitProvider() {
    const validationError = validateProviderForm(formValues, locale);

    if (validationError) {
      setSubmitState({ message: validationError, status: "error" });
      return;
    }

    setPendingAction(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/provider-connections", {
      body: JSON.stringify({
        action: "upsert",
        values: formValues
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProviderResponsePayload;

    if (!response.ok || !payload.provider) {
      setSubmitState({
        message: payload.error ?? "Provider registration failed.",
        status: "error"
      });
      setPendingAction(false);
      return;
    }

    const savedProvider = payload.provider;

    setProviders((current) => [
      ...current.filter((provider) => provider.provider !== savedProvider.provider),
      savedProvider
    ]);
    setFormValues(getProviderFormValues(savedProvider));
    setSubmitState({
      message: locale === "ko" ? "Provider가 저장되었습니다." : "Provider saved.",
      status: "success"
    });
    setPendingAction(false);
    router.refresh();
  }

  function editFromProvider(provider: ProviderConnectionRecord) {
    setFormValues(getProviderFormValues(provider));
    setSubmitState({ message: "", status: "idle" });
  }

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.source === "fixture" ? (
        <p className="policy-alert" data-status="warning">
          {text.fixtureFallback} {model.loadError}
        </p>
      ) : null}
      {submitState.message ? (
        <p className="policy-alert" data-status={submitState.status}>
          {submitState.message}
        </p>
      ) : null}

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.register}</h3>
        </div>
        <div className="provider-form-grid">
          <label className="policy-field">
            <span>{text.provider}</span>
            <input
              maxLength={64}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  provider: event.target.value.trim()
                }))
              }
              pattern="^[a-z][a-z0-9_-]{1,63}$"
              type="text"
              value={formValues.provider}
            />
          </label>
          <label className="policy-field">
            <span>{text.displayName}</span>
            <input
              maxLength={120}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  displayName: event.target.value
                }))
              }
              type="text"
              value={formValues.displayName}
            />
          </label>
          <label className="policy-field provider-wide-field">
            <span>{text.baseUrl}</span>
            <input
              maxLength={2048}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  baseUrl: event.target.value
                }))
              }
              type="url"
              value={formValues.baseUrl}
            />
          </label>
          <label className="policy-field">
            <span>{text.status}</span>
            <select
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  status: event.target.value as ProviderConnectionStatus
                }))
              }
              value={formValues.status}
            >
              {providerStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatProviderStatus(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="policy-field">
            <span>{text.timeoutMs}</span>
            <input
              max={maxProviderTimeoutMs}
              min={minProviderTimeoutMs}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  timeoutMs: Number(event.target.value)
                }))
              }
              type="number"
              value={formValues.timeoutMs}
            />
          </label>
          <label className="policy-field">
            <span>{text.adapterType}</span>
            <input
              maxLength={80}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  adapterType: event.target.value.trim()
                }))
              }
              placeholder="openai_compatible"
              type="text"
              value={formValues.adapterType}
            />
          </label>
          <label className="policy-field">
            <span>{text.requestFormat}</span>
            <select
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  requestFormat:
                    event.target.value === "mock_chat_completions"
                      ? "mock_chat_completions"
                      : "openai_chat_completions"
                }))
              }
              value={formValues.requestFormat}
            >
              <option value="openai_chat_completions">openai_chat_completions</option>
              <option value="mock_chat_completions">mock_chat_completions</option>
            </select>
          </label>
          <label className="policy-field">
            <span>{text.apiVersion}</span>
            <input
              maxLength={80}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  apiVersion: event.target.value.trim()
                }))
              }
              placeholder="optional"
              type="text"
              value={formValues.apiVersion}
            />
          </label>
          <label className="policy-field">
            <span>{text.failureMode}</span>
            <select
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  failureMode:
                    event.target.value === "fail_open_to_fallback"
                      ? "fail_open_to_fallback"
                      : "fail_closed"
                }))
              }
              value={formValues.failureMode}
            >
              <option value="fail_closed">fail_closed</option>
              <option value="fail_open_to_fallback">fail_open_to_fallback</option>
            </select>
          </label>
          <label className="policy-toggle-row provider-form-toggle">
            <input
              checked={formValues.credentialRequired}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  credentialRequired: event.target.checked
                }))
              }
              type="checkbox"
            />
            <span>{text.credentialRequired}</span>
          </label>
          <label className="policy-field">
            <span>{text.resolver}</span>
            <input
              maxLength={80}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  resolver: event.target.value
                }))
              }
              type="text"
              value={formValues.resolver}
            />
          </label>
          <label className="policy-field provider-wide-field">
            <span>{text.secretRef}</span>
            <input
              maxLength={200}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  secretRef: event.target.value
                }))
              }
              type="text"
              value={formValues.secretRef}
            />
          </label>
          <label className="policy-field provider-wide-field">
            <span>{text.models}</span>
            <textarea
              maxLength={1200}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  models: event.target.value
                }))
              }
              placeholder="gpt-4o-mini, gpt-4o"
              value={formValues.models}
            />
          </label>
          <label className="policy-field">
            <span>{text.credentialPrefix}</span>
            <input
              maxLength={40}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  credentialPrefix: event.target.value
                }))
              }
              type="text"
              value={formValues.credentialPrefix}
            />
          </label>
          <label className="policy-field">
            <span>{text.credentialLast4}</span>
            <input
              maxLength={16}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  credentialLast4: event.target.value
                }))
              }
              type="text"
              value={formValues.credentialLast4}
            />
          </label>
          <div className="provider-form-actions">
            <Button
              disabled={pendingAction}
              onClick={() => setFormValues(emptyProviderForm)}
              type="button"
              variant="outline"
            >
              {locale === "ko" ? "초기화" : "Reset"}
            </Button>
            <Button disabled={pendingAction} onClick={() => void submitProvider()} type="button">
              <PlugZap aria-hidden="true" />
              {text.register}
            </Button>
          </div>
        </div>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.title}</h3>
        </div>
        {providers.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table provider-table">
              <thead>
                <tr>
                  <th>{text.provider}</th>
                  <th>{text.baseUrl}</th>
                  <th>{text.status}</th>
                  <th>{text.credential}</th>
                  <th>{text.updated}</th>
                  <th>{text.providerId}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => (
                  <tr key={provider.id}>
                    <td>
                      <strong className="provider-name">{provider.displayName}</strong>
                      <span className="project-muted">{provider.provider}</span>
                    </td>
                    <td>
                      <code className="project-code">{provider.baseUrl}</code>
                      <small className="project-muted">
                        {text.timeoutMs}: {provider.timeoutMs} / {text.resolver}: {provider.resolver}
                      </small>
                      <small className="project-muted">
                        {text.models}: {formatProviderModels(provider.providerConfig)}
                      </small>
                      <small className="project-muted">
                        {text.providerConfig}: {formatProviderConfig(provider.providerConfig)}
                      </small>
                    </td>
                    <td>
                      <Badge
                        className="project-status-badge"
                        data-status={provider.status}
                        variant="outline"
                      >
                        {formatProviderStatus(provider.status)}
                      </Badge>
                    </td>
                    <td>
                      <span className="project-muted">
                        {nullableText(provider.credentialPreview.prefix, "none")}
                      </span>
                      <small className="project-muted">
                        last4: {nullableText(provider.credentialPreview.last4, "none")}
                      </small>
                    </td>
                    <td>
                      <span className="project-muted">{formatDateTime(provider.updatedAt)}</span>
                      <small className="project-muted">
                        {text.created}: {formatDateTime(provider.createdAt)}
                      </small>
                    </td>
                    <td>
                      <code className="project-code">{provider.id}</code>
                    </td>
                    <td>
                      <div className="project-row-actions">
                        <Button
                          disabled={pendingAction}
                          onClick={() => editFromProvider(provider)}
                          type="button"
                          variant="outline"
                        >
                          <Save aria-hidden="true" />
                          {text.save}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function getInitialProviderForm(providers: ProviderConnectionRecord[]) {
  return providers[0] ? getProviderFormValues(providers[0]) : emptyProviderForm;
}

function getProviderFormValues(provider: ProviderConnectionRecord): ProviderConnectionFormValues {
  const providerConfig = provider.providerConfig;

  return {
    adapterType: getProviderConfigString(
      providerConfig,
      "adapterType",
      getDefaultAdapterType(provider)
    ),
    apiVersion: getProviderConfigString(providerConfig, "apiVersion", ""),
    baseUrl: provider.baseUrl,
    credentialRequired: getProviderConfigBoolean(
      providerConfig,
      "credentialRequired",
      provider.resolver !== "none"
    ),
    credentialLast4: nullableText(provider.credentialPreview.last4, ""),
    credentialPrefix: nullableText(provider.credentialPreview.prefix, ""),
    displayName: provider.displayName,
    failureMode: getProviderConfigFailureMode(providerConfig),
    models: getProviderConfigModels(provider.providerConfig).join(", "),
    provider: provider.provider,
    requestFormat: getProviderConfigRequestFormat(providerConfig, provider),
    resolver: provider.resolver,
    secretRef: "",
    status: provider.status,
    timeoutMs: provider.timeoutMs
  };
}

function formatProviderStatus(status: ProviderConnectionStatus) {
  return status.toLowerCase();
}

function validateProviderForm(values: ProviderConnectionFormValues, locale: Locale) {
  if (!values.provider.trim() || !values.displayName.trim() || !values.baseUrl.trim()) {
    return locale === "ko"
      ? "Provider key, 표시 이름, Base URL을 입력하세요."
      : "Provider key, display name, and base URL are required.";
  }

  if (!providerKeyPattern.test(values.provider)) {
    return locale === "ko"
      ? "Provider key는 소문자로 시작하고 영문/숫자/_/- 조합 2~64자여야 합니다."
      : "Provider key must start with a lowercase letter and use only lowercase letters, numbers, underscores, or hyphens, 2-64 characters.";
  }

  if (
    !Number.isInteger(values.timeoutMs) ||
    values.timeoutMs < minProviderTimeoutMs ||
    values.timeoutMs > maxProviderTimeoutMs
  ) {
    return locale === "ko"
      ? "Timeout은 1,000ms에서 120,000ms 사이의 정수여야 합니다."
      : "Timeout must be an integer between 1,000ms and 120,000ms.";
  }

  return null;
}

function getProviderConfigString(
  providerConfig: Record<string, unknown> | null,
  key: string,
  fallback: string
) {
  const value = providerConfig?.[key];

  return typeof value === "string" ? value : fallback;
}

function getProviderConfigBoolean(
  providerConfig: Record<string, unknown> | null,
  key: string,
  fallback: boolean
) {
  const value = providerConfig?.[key];

  return typeof value === "boolean" ? value : fallback;
}

function getProviderConfigFailureMode(
  providerConfig: Record<string, unknown> | null
): ProviderConnectionFormValues["failureMode"] {
  return providerConfig?.failureMode === "fail_open_to_fallback"
    ? "fail_open_to_fallback"
    : "fail_closed";
}

function getProviderConfigRequestFormat(
  providerConfig: Record<string, unknown> | null,
  provider: ProviderConnectionRecord
): ProviderConnectionFormValues["requestFormat"] {
  const requestFormat = providerConfig?.requestFormat;

  if (requestFormat === "mock_chat_completions") {
    return "mock_chat_completions";
  }

  if (requestFormat === "openai_chat_completions") {
    return "openai_chat_completions";
  }

  return provider.provider === "mock"
    ? "mock_chat_completions"
    : "openai_chat_completions";
}

function getDefaultAdapterType(provider: ProviderConnectionRecord) {
  return provider.provider === "mock" ? "mock" : "openai_compatible";
}

function getProviderConfigModels(providerConfig: Record<string, unknown> | null) {
  const models = providerConfig?.models;

  return Array.isArray(models)
    ? models.filter(
        (model): model is string => typeof model === "string" && model.trim().length > 0
      )
    : [];
}

function formatProviderModels(providerConfig: Record<string, unknown> | null) {
  const models = getProviderConfigModels(providerConfig);

  return models.length > 0 ? models.join(", ") : "none";
}

function formatProviderConfig(providerConfig: Record<string, unknown> | null) {
  if (!providerConfig) {
    return "default";
  }

  const adapterType = getProviderConfigString(providerConfig, "adapterType", "default");
  const credentialRequired = getProviderConfigBoolean(
    providerConfig,
    "credentialRequired",
    true
  );
  const requestFormat = getProviderConfigString(providerConfig, "requestFormat", "default");
  const failureMode = getProviderConfigFailureMode(providerConfig);

  return `${adapterType} / ${requestFormat} / credential ${
    credentialRequired ? "required" : "not_required"
  } / ${failureMode}`;
}
