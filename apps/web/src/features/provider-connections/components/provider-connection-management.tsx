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
  ProviderConnectionStatus,
  ProviderModelDiscovery,
  ProviderPresetRecord
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
  discovery?: ProviderModelDiscovery;
  error?: string;
  provider?: ProviderConnectionRecord;
  status?: number;
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
  modelsEndpointPath: "/models",
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
    discoverModels: string;
    discoveryOpenAiOnly: string;
    empty: string;
    fixtureFallback: string;
    management: string;
    models: string;
    modelsEndpointPath: string;
    failureMode: string;
    projectId: string;
    provider: string;
    providerPreset: string;
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
    discoverModels: "Discover models",
    discoveryOpenAiOnly: "Model discovery is enabled for OpenAI providers first.",
    empty: "No provider connections found.",
    fixtureFallback: "Control Plane unavailable. Showing fixture provider connection.",
    management: "management",
    models: "Models",
    modelsEndpointPath: "Models endpoint",
    failureMode: "Failure mode",
    projectId: "Project ID",
    provider: "Provider key",
    providerPreset: "Provider preset",
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
    discoverModels: "모델 조회",
    discoveryOpenAiOnly: "모델 조회는 우선 OpenAI Provider에서만 활성화합니다.",
    empty: "Provider connection이 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture Provider connection을 표시 중입니다.",
    management: "관리",
    models: "Models",
    modelsEndpointPath: "Models endpoint",
    failureMode: "Failure mode",
    projectId: "Project ID",
    provider: "Provider key",
    providerPreset: "Provider preset",
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
  const [discoveringProvider, setDiscoveringProvider] = useState<string | null>(null);
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

  async function discoverModels(provider = formValues.provider) {
    const normalizedProvider = provider.trim();
    const providerRecord = providers.find((item) => item.provider === normalizedProvider);
    const baseValues = providerRecord ? getProviderFormValues(providerRecord) : null;

    if (!isDiscoverSupportedProvider(normalizedProvider)) {
      setSubmitState({
        message: text.discoveryOpenAiOnly,
        status: "error"
      });
      return;
    }

    if (!baseValues) {
      setSubmitState({
        message:
          locale === "ko"
            ? "Provider를 먼저 저장한 뒤 모델을 조회하세요."
            : "Save the provider before discovering models.",
        status: "error"
      });
      return;
    }

    setDiscoveringProvider(normalizedProvider);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/provider-connections", {
      body: JSON.stringify({
        action: "discover-models",
        values: {
          provider: normalizedProvider
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProviderResponsePayload;

    if (!response.ok || !payload.discovery) {
      setSubmitState({
        message:
          payload.status === 404
            ? locale === "ko"
              ? "현재 Control Plane 빌드에 모델 조회 API가 없습니다. Models 칸에 모델명을 직접 입력하세요."
              : "Model discovery API is not available in this Control Plane build. Enter model names manually."
            : payload.error ?? "Provider model discovery failed.",
        status: "error"
      });
      setDiscoveringProvider(null);
      return;
    }

    const discoveredModels = payload.discovery.models.map((item) => item.modelName);

    setFormValues((current) => {
      return {
        ...baseValues,
        adapterType: payload.discovery?.adapterType ?? current.adapterType,
        baseUrl: payload.discovery?.baseUrl ?? current.baseUrl,
        credentialRequired: payload.discovery?.credentialRequired ?? current.credentialRequired,
        models: mergeModelNames(baseValues.models, discoveredModels),
        provider: normalizedProvider
      };
    });
    setSubmitState({
      message:
        locale === "ko"
          ? `${discoveredModels.length}개 모델을 찾았습니다. 저장하면 Provider 설정에 반영됩니다.`
          : `${discoveredModels.length} models discovered. Save the provider to store them.`,
      status: "success"
    });
    setDiscoveringProvider(null);
  }

  function editFromProvider(provider: ProviderConnectionRecord) {
    setFormValues(getProviderFormValues(provider));
    setSubmitState({ message: "", status: "idle" });
  }

  function applyProviderPreset(providerKey: string) {
    const preset = model.providerPresets.items.find((item) => item.providerKey === providerKey);

    if (!preset) {
      return;
    }

    setFormValues((current) => ({
      ...current,
      adapterType: preset.adapterType,
      baseUrl: preset.baseUrl,
      credentialRequired: preset.credentialRequired,
      displayName: preset.displayName,
      modelsEndpointPath: preset.modelsEndpointPath,
      provider: preset.providerKey,
      resolver: preset.defaultResolver,
      timeoutMs: preset.defaultTimeoutMs
    }));
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
      {model.providerPresets.source === "fallback" && model.providerPresets.loadError ? (
        <p className="policy-alert" data-status="warning">
          {model.providerPresets.loadError}
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
            <span>{text.providerPreset}</span>
            <select
              onChange={(event) => applyProviderPreset(event.target.value)}
              value={getSelectedPresetKey(model.providerPresets.items, formValues.provider)}
            >
              <option value="">Custom</option>
              {model.providerPresets.items.map((preset) => (
                <option key={preset.providerKey} value={preset.providerKey}>
                  {preset.displayName}
                </option>
              ))}
            </select>
          </label>
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
            <span>{text.modelsEndpointPath}</span>
            <input
              maxLength={120}
              onChange={(event) =>
                setFormValues((current) => ({
                  ...current,
                  modelsEndpointPath: event.target.value.trim()
                }))
              }
              placeholder="/models"
              type="text"
              value={formValues.modelsEndpointPath}
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
            <small className="project-muted">{text.discoveryOpenAiOnly}</small>
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
            <Button
              disabled={
                pendingAction ||
                discoveringProvider !== null ||
                !isDiscoverSupportedProvider(formValues.provider) ||
                !isRegisteredProvider(providers, formValues.provider)
              }
              onClick={() => void discoverModels()}
              type="button"
              variant="outline"
            >
              {discoveringProvider === formValues.provider ? "..." : text.discoverModels}
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
                        {nullableText(provider.credentialPreview?.prefix, "none")}
                      </span>
                      <small className="project-muted">
                        last4: {nullableText(provider.credentialPreview?.last4, "none")}
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
                          disabled={pendingAction || discoveringProvider !== null}
                          onClick={() => editFromProvider(provider)}
                          type="button"
                          variant="outline"
                        >
                          <Save aria-hidden="true" />
                          {text.save}
                        </Button>
                        <Button
                          disabled={
                            pendingAction ||
                            discoveringProvider !== null ||
                            !isDiscoverSupportedProvider(provider.provider)
                          }
                          onClick={() => {
                            editFromProvider(provider);
                            void discoverModels(provider.provider);
                          }}
                          type="button"
                          variant="outline"
                        >
                          {discoveringProvider === provider.provider
                            ? "..."
                            : text.discoverModels}
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
    credentialLast4: nullableText(provider.credentialPreview?.last4, ""),
    credentialPrefix: nullableText(provider.credentialPreview?.prefix, ""),
    displayName: provider.displayName,
    failureMode: getProviderConfigFailureMode(providerConfig),
    models: getProviderConfigModels(provider.providerConfig).join(", "),
    modelsEndpointPath: getProviderConfigString(providerConfig, "modelsEndpointPath", "/models"),
    provider: provider.provider,
    requestFormat: getProviderConfigRequestFormat(providerConfig, provider),
    resolver: provider.resolver,
    secretRef: "",
    status: provider.status,
    timeoutMs: provider.timeoutMs
  };
}

function getSelectedPresetKey(presets: ProviderPresetRecord[], provider: string) {
  return presets.some((preset) => preset.providerKey === provider) ? provider : "";
}

function isDiscoverSupportedProvider(provider: string) {
  return provider.trim().startsWith("openai");
}

function isRegisteredProvider(providers: ProviderConnectionRecord[], provider: string) {
  const normalizedProvider = provider.trim();

  return providers.some((item) => item.provider === normalizedProvider);
}

function mergeModelNames(existingValue: string, discoveredModels: string[]) {
  const existingModels = existingValue
    .split(/[\n,]/)
    .map((model) => model.trim())
    .filter(Boolean);

  return Array.from(new Set([...existingModels, ...discoveredModels])).join(", ");
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
