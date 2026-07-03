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
    discoveryOpenAiOnly: "Model discovery is enabled for OpenAI-compatible providers such as OpenAI and Gemini.",
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
    discoveryOpenAiOnly: "모델 조회는 OpenAI, Gemini 같은 OpenAI 호환 Provider에서 활성화됩니다.",
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
  const [formValues, setFormValues] = useState<ProviderConnectionFormValues>(emptyProviderForm);
  const [modelOptionsByProvider, setModelOptionsByProvider] = useState<Record<string, string[]>>(
    () => getInitialModelOptions(model.providers)
  );
  const [pendingAction, setPendingAction] = useState(false);
  const [discoveringProvider, setDiscoveringProvider] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const selectedModels = splitModelNames(formValues.models);
  const availableModels = getAvailableProviderModels(
    modelOptionsByProvider,
    formValues.provider,
    selectedModels
  );

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
        values: {
          ...formValues,
          isEdit: isRegisteredProvider(providers, formValues.provider)
        }
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
    setModelOptionsByProvider((current) => ({
      ...current,
      [savedProvider.provider]: current[savedProvider.provider]?.length
        ? current[savedProvider.provider]
        : getProviderConfigModels(savedProvider.providerConfig).filter(isChatCompletionModelName)
    }));
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
    const adapterType = baseValues?.adapterType ?? formValues.adapterType;

    if (!isDiscoverSupportedProvider(adapterType)) {
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
            : getProviderDiscoveryErrorMessage(payload.error, normalizedProvider, locale),
        status: "error"
      });
      setDiscoveringProvider(null);
      return;
    }

    const discoveredModels = payload.discovery.models.map((item) =>
      normalizeDiscoveredModelName(item.modelName)
    );
    const chatModels = filterChatCompletionModels(discoveredModels);
    const skippedModelCount = discoveredModels.length - chatModels.length;

    setModelOptionsByProvider((current) => ({
      ...current,
      [normalizedProvider]: chatModels
    }));
    setFormValues((current) => {
      return {
        ...baseValues,
        adapterType: payload.discovery?.adapterType ?? current.adapterType,
        baseUrl: payload.discovery?.baseUrl ?? current.baseUrl,
        credentialRequired: payload.discovery?.credentialRequired ?? current.credentialRequired,
        models: chatModels.join(", "),
        provider: normalizedProvider
      };
    });
    setSubmitState({
      message:
        locale === "ko"
          ? `${chatModels.length}개 chat 모델을 반영했습니다. 제외된 비채팅 모델: ${skippedModelCount}개.`
          : `${chatModels.length} chat models applied. Excluded non-chat models: ${skippedModelCount}.`,
      status: "success"
    });
    setDiscoveringProvider(null);
  }

  function editFromProvider(provider: ProviderConnectionRecord) {
    const providerModels = getProviderConfigModels(provider.providerConfig).filter(
      isChatCompletionModelName
    );

    setModelOptionsByProvider((current) => ({
      ...current,
      [provider.provider]: current[provider.provider]?.length
        ? current[provider.provider]
        : providerModels
    }));
    setFormValues(getProviderFormValues(provider));
    setSubmitState({ message: "", status: "idle" });
  }

  function applyProviderPreset(providerKey: string) {
    const preset = model.providerPresets.items.find((item) => item.providerKey === providerKey);

    if (!preset) {
      return;
    }

    const savedProvider = providers.find((provider) => provider.provider === providerKey);

    if (savedProvider) {
      editFromProvider(savedProvider);
      return;
    }

    setFormValues({
      ...emptyProviderForm,
      adapterType: preset.adapterType,
      baseUrl: preset.baseUrl,
      credentialRequired: preset.credentialRequired,
      displayName: preset.displayName,
      modelsEndpointPath: preset.modelsEndpointPath,
      provider: preset.providerKey,
      resolver: preset.defaultResolver,
      timeoutMs: preset.defaultTimeoutMs
    });
    setSubmitState({ message: "", status: "idle" });
  }

  function toggleModelSelection(modelName: string, checked: boolean) {
    const selectedModelSet = new Set(selectedModels);

    if (checked) {
      selectedModelSet.add(modelName);
    } else {
      selectedModelSet.delete(modelName);
    }

    setFormValues((current) => ({
      ...current,
      models: availableModels.filter((modelName) => selectedModelSet.has(modelName)).join(", ")
    }));
  }

  function setAllModelSelections(checked: boolean) {
    setFormValues((current) => ({
      ...current,
      models: checked ? availableModels.join(", ") : ""
    }));
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
              <option value="">
                {locale === "ko" ? "Provider 선택" : "Select provider"}
              </option>
              {model.providerPresets.items.map((preset) => (
                <option key={preset.providerKey} value={preset.providerKey}>
                  {preset.displayName}
                </option>
              ))}
            </select>
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
          <div className="policy-field provider-wide-field">
            <span>{locale === "ko" ? "연결 정보" : "Connection"}</span>
            <div className="provider-readonly-summary">
              <strong>
                {formValues.baseUrl ||
                  (locale === "ko" ? "Provider를 선택하세요." : "Select a provider.")}
              </strong>
              {formValues.provider ? (
                <small className="project-muted">
                  {formValues.provider} / {formValues.adapterType} / {formValues.resolver}
                </small>
              ) : null}
            </div>
          </div>
          <label className="policy-field provider-wide-field">
            <span>{locale === "ko" ? "사용 모델 선택" : "Model selection"}</span>
            <div className="provider-model-selection">
              {availableModels.length > 0 ? (
                <>
                  <div className="provider-model-selection-toolbar">
                    <strong>
                      {locale === "ko"
                        ? `${selectedModels.length} / ${availableModels.length}개 선택`
                        : `${selectedModels.length} / ${availableModels.length} selected`}
                    </strong>
                    <div>
                      <button onClick={() => setAllModelSelections(true)} type="button">
                        {locale === "ko" ? "전체 선택" : "Select all"}
                      </button>
                      <button onClick={() => setAllModelSelections(false)} type="button">
                        {locale === "ko" ? "전체 해제" : "Clear"}
                      </button>
                    </div>
                  </div>
                  <div className="provider-model-checkbox-grid">
                    {availableModels.map((modelName) => (
                      <label key={modelName} className="provider-model-checkbox">
                        <input
                          checked={selectedModels.includes(modelName)}
                          onChange={(event) =>
                            toggleModelSelection(modelName, event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>{modelName}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <p className="provider-model-empty">
                  {locale === "ko"
                    ? "Provider를 저장한 뒤 모델 조회를 누르면 선택 가능한 모델이 표시됩니다."
                    : "Save the provider, then discover models to choose from them."}
                </p>
              )}
            </div>
            <small className="project-muted">{text.discoveryOpenAiOnly}</small>
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
                !isDiscoverSupportedProvider(formValues.adapterType) ||
                !isRegisteredProvider(providers, formValues.provider)
              }
              onClick={() => void discoverModels()}
              type="button"
              variant="outline"
            >
              {discoveringProvider === formValues.provider ? "..." : text.discoverModels}
            </Button>
            <Button
              disabled={
                pendingAction ||
                !formValues.provider.trim() ||
                !formValues.displayName.trim() ||
                !formValues.baseUrl.trim()
              }
              onClick={() => void submitProvider()}
              type="button"
            >
              <PlugZap aria-hidden="true" />
              {text.save}
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
                            !isDiscoverSupportedProvider(
                              getProviderFormValues(provider).adapterType
                            )
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
    models: getProviderConfigModels(provider.providerConfig)
      .filter(isChatCompletionModelName)
      .join(", "),
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

function getInitialModelOptions(providers: ProviderConnectionRecord[]) {
  return Object.fromEntries(
    providers.map((provider) => [
      provider.provider,
      getProviderConfigModels(provider.providerConfig).filter(isChatCompletionModelName)
    ])
  );
}

function getAvailableProviderModels(
  modelOptionsByProvider: Record<string, string[]>,
  provider: string,
  selectedModels: string[]
) {
  const providerOptions = modelOptionsByProvider[provider.trim()] ?? [];

  return Array.from(
    new Set([...providerOptions, ...selectedModels].filter(isChatCompletionModelName))
  );
}

function isDiscoverSupportedProvider(adapterType: string) {
  return adapterType === "openai_compatible" || adapterType === "mock";
}

function getProviderDiscoveryErrorMessage(
  error: string | undefined,
  provider: string,
  locale: Locale
) {
  const message = error ?? "Provider model discovery failed.";

  if (
    provider === "gemini" &&
    message.includes("Provider credential reference is not bound")
  ) {
    return locale === "ko"
      ? "Gemini 모델 조회에는 GEMINI_API_KEY와 credential_ref_gemini_main=GEMINI_API_KEY binding이 필요합니다."
      : "Gemini model discovery requires GEMINI_API_KEY and credential_ref_gemini_main=GEMINI_API_KEY binding.";
  }

  return message;
}

function isRegisteredProvider(providers: ProviderConnectionRecord[], provider: string) {
  const normalizedProvider = provider.trim();

  return providers.some((item) => item.provider === normalizedProvider);
}

const nonChatModelNameTokens = [
  "audio",
  "babbage",
  "codex",
  "computer-use",
  "dall-e",
  "davinci",
  "embed",
  "image",
  "moderation",
  "realtime",
  "sora",
  "tts",
  "transcribe",
  "whisper"
];

function splitModelNames(value: string) {
  return value
    .split(/[\n,]/)
    .map((model) => normalizeDiscoveredModelName(model))
    .filter(Boolean)
    .filter(isChatCompletionModelName);
}

function filterChatCompletionModels(modelNames: string[]) {
  return Array.from(
    new Set(
      modelNames
        .map((modelName) => normalizeDiscoveredModelName(modelName))
        .filter(Boolean)
        .filter(isChatCompletionModelName)
    )
  );
}

function normalizeDiscoveredModelName(modelName: string) {
  const normalized = modelName.trim();

  if (normalized.startsWith("models/gemini-")) {
    return normalized.slice("models/".length);
  }

  return normalized;
}

function isChatCompletionModelName(modelName: string) {
  const normalizedModelName = modelName.toLowerCase();

  if (nonChatModelNameTokens.some((token) => normalizedModelName.includes(token))) {
    return false;
  }

  return (
    normalizedModelName.startsWith("gpt-") ||
    normalizedModelName.startsWith("o1") ||
    normalizedModelName.startsWith("o3") ||
    normalizedModelName.startsWith("o4") ||
    normalizedModelName.startsWith("gemini-") ||
    normalizedModelName.startsWith("chat-")
  );
}

function formatProviderStatus(status: ProviderConnectionStatus) {
  return status.toLowerCase();
}

function validateProviderForm(values: ProviderConnectionFormValues, locale: Locale) {
  if (!values.provider.trim() || !values.displayName.trim() || !values.baseUrl.trim()) {
    return locale === "ko"
      ? "Provider를 선택하고 표시 이름을 입력하세요."
      : "Select a provider and enter a display name.";
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
      ).map((model) => normalizeDiscoveredModelName(model))
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
