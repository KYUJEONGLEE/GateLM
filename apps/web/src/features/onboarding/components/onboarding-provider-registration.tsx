"use client";

import { Check, KeyRound, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  ProviderConnectionFormValues,
  ProviderConnectionRecord,
  ProviderConnectionsModel,
  ProviderModelDiscovery,
  ProviderPresetRecord
} from "@/lib/control-plane/provider-connections-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ProviderRegistrationResult = {
  provider: ProviderConnectionRecord;
  selectedModelKey: string;
};

type OnboardingProviderRegistrationProps = {
  locale: Locale;
  model: ProviderConnectionsModel;
  onProviderSaved: (result: ProviderRegistrationResult) => void;
};

type ProviderResponsePayload = {
  discovery?: ProviderModelDiscovery;
  error?: string;
  provider?: ProviderConnectionRecord;
  status?: number;
};

type ProviderDisplayRow = {
  connection: ProviderConnectionRecord | null;
  displayName: string;
  modelSummary: string;
  models: string[];
  providerKey: string;
  preset: ProviderPresetRecord | null;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ProviderDiscoveryPreview = {
  chatModels: string[];
  discoveredAt: string;
  providerKey: string;
  selectedModels: string[];
  skippedModelCount: number;
};

const emptyProviderForm: ProviderConnectionFormValues = {
  adapterType: "openai_compatible",
  apiVersion: "",
  baseUrl: "",
  credentialLast4: "",
  credentialPrefix: "",
  credentialRequired: true,
  credentialValue: "",
  displayName: "",
  failureMode: "fail_closed",
  models: "",
  modelsEndpointPath: "/models",
  provider: "",
  requestFormat: "openai_chat_completions",
  resolver: "environment",
  secretRef: "",
  status: "ACTIVE",
  timeoutMs: 30000
};

const onboardingProviderText: Record<
  Locale,
  {
    apiKey: string;
    apiKeyHelp: string;
    apiKeyRegistered: string;
    choose: string;
    description: string;
    providerRequired: string;
    registered: string;
    save: string;
    saving: string;
    selected: string;
    title: string;
  }
> = {
  en: {
    apiKey: "Provider API Key",
    apiKeyHelp: "GateLM stores the provider key server-side and issues a Project API Key for Gateway calls.",
    apiKeyRegistered: "Provider key saved. Choose models without entering it again.",
    choose: "Choose",
    description: "Select the Provider and model this project will use, then add the provider key.",
    providerRequired: "Choose a provider and enter the provider API key.",
    registered: "Provider saved.",
    save: "Add selected model key",
    saving: "Saving...",
    selected: "Selected",
    title: "Register Provider model key (optional)"
  },
  ko: {
    apiKey: "Provider API Key",
    apiKeyHelp: "GateLM은 provider credential을 직접 노출하지 않고, 팀 전용 Gateway API Key만 발급합니다.",
    apiKeyRegistered: "Provider key가 저장되어 있습니다. 다시 입력하지 않고 모델을 선택할 수 있습니다.",
    choose: "선택",
    description: "이 팀에서 사용할 Provider와 모델을 선택하고, API Key를 추가합니다.",
    providerRequired: "Provider를 선택하고 Provider API Key를 입력하세요.",
    registered: "Provider가 저장되었습니다.",
    save: "선택한 모델 Key 추가",
    saving: "저장 중...",
    selected: "선택됨",
    title: "Provider 모델 Key 등록 (선택)"
  }
};

const preferredProviderOrder = ["openai", "claude", "anthropic", "gemini", "cohere", "local", "mock"];

export function OnboardingProviderRegistration({
  locale,
  model,
  onProviderSaved
}: OnboardingProviderRegistrationProps) {
  const text = onboardingProviderText[locale];
  const [providers, setProviders] = useState<ProviderConnectionRecord[]>(model.providers);
  const providerRows = useMemo(
    () => getProviderRows(providers, model.providerPresets.items),
    [model.providerPresets.items, providers]
  );
  const [selectedProviderKey, setSelectedProviderKey] = useState(
    () => providerRows[0]?.providerKey ?? ""
  );
  const selectedRow =
    providerRows.find((row) => row.providerKey === selectedProviderKey) ?? providerRows[0] ?? null;
  const [selectedModel, setSelectedModel] = useState(() => selectedRow?.models[0] ?? "");
  const [formValues, setFormValues] = useState<ProviderConnectionFormValues>(() =>
    selectedRow ? getProviderFormValuesForRow(selectedRow, selectedRow.models[0] ?? "") : emptyProviderForm
  );
  const [pendingAction, setPendingAction] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const [discoveryPreviewByProvider, setDiscoveryPreviewByProvider] = useState<
    Record<string, ProviderDiscoveryPreview>
  >({});
  const discoveryPreview = selectedProviderKey
    ? discoveryPreviewByProvider[selectedProviderKey] ?? null
    : null;

  function selectProvider(row: ProviderDisplayRow) {
    const cachedPreview = discoveryPreviewByProvider[row.providerKey];
    const nextModel =
      cachedPreview?.selectedModels[0] ?? cachedPreview?.chatModels[0] ?? row.models[0] ?? "";

    setSelectedProviderKey(row.providerKey);
    setSelectedModel(nextModel);
    setFormValues(getProviderFormValuesForRow(row, nextModel));
    setSubmitState({ message: "", status: "idle" });
  }

  async function submitProvider() {
    if (!selectedRow || !formValues.provider.trim() || !selectedModel.trim()) {
      setSubmitState({ message: text.providerRequired, status: "error" });
      return;
    }

    const requiresCredential = formValues.credentialRequired;

    if (requiresCredential && !formValues.credentialValue?.trim()) {
      setSubmitState({ message: text.providerRequired, status: "error" });
      return;
    }

    setPendingAction(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/provider-connections", {
      body: JSON.stringify({
        action: "upsert",
        values: {
          ...formValues,
          isEdit: isRegisteredProvider(providers, formValues.provider),
          models: selectedModel
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProviderResponsePayload;

    if (!response.ok || !payload.provider) {
      setFormValues((current) => ({
        ...current,
        credentialValue: ""
      }));
      setSubmitState({
        message: payload.error ?? "Provider registration failed.",
        status: "error"
      });
      setPendingAction(false);
      return;
    }

    const savedProvider = payload.provider;
    const savedModel = selectedModel.trim();

    setProviders((current) => [
      ...current.filter((provider) => provider.provider !== savedProvider.provider),
      savedProvider
    ]);
    setFormValues({
      ...getProviderFormValues(savedProvider),
      credentialValue: "",
      models: savedModel
    });
    setSelectedProviderKey(savedProvider.provider);
    setSelectedModel(savedModel);
    onProviderSaved({
      provider: savedProvider,
      selectedModelKey: `${savedProvider.provider}::${savedModel}`
    });
    const discoveredModels = await discoverModelsForProvider(savedProvider, savedModel);
    if (discoveredModels) {
      setSubmitState({ message: text.registered, status: "success" });
    }
    setPendingAction(false);
  }

  async function discoverModelsForProvider(
    provider: ProviderConnectionRecord,
    defaultModel: string
  ) {
    const response = await fetch("/api/control-plane/provider-connections", {
      body: JSON.stringify({
        action: "discover-models",
        values: {
          provider: provider.provider
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProviderResponsePayload;

    if (!response.ok || !payload.discovery) {
      setDiscoveryPreviewByProvider((current) => {
        const next = { ...current };
        delete next[provider.provider];
        return next;
      });
      setSubmitState({
        message: payload.error ?? "Provider model discovery failed.",
        status: "error"
      });
      return false;
    }

    const discoveredModels = payload.discovery.models.map((item) =>
      normalizeDiscoveredModelName(item.modelName)
    );
    const chatModels = getUniqueChatModels(discoveredModels);
    const selectedModels = defaultModel && chatModels.includes(defaultModel) ? [defaultModel] : [];

    setDiscoveryPreviewByProvider((current) => ({
      ...current,
      [provider.provider]: {
        chatModels,
        discoveredAt: payload.discovery?.discoveredAt ?? new Date().toISOString(),
        providerKey: provider.provider,
        selectedModels,
        skippedModelCount: discoveredModels.length - chatModels.length
      }
    }));
    return true;
  }

  function setAllDiscoveredModels(checked: boolean) {
    const providerKey = discoveryPreview?.providerKey;

    if (!providerKey) {
      return;
    }

    setDiscoveryPreviewByProvider((current) => {
      const preview = current[providerKey];

      if (!preview) {
        return current;
      }

      return {
        ...current,
        [providerKey]: {
          ...preview,
          selectedModels: checked ? preview.chatModels : []
        }
      };
    });
  }

  function toggleDiscoveredModel(modelName: string, checked: boolean) {
    const providerKey = discoveryPreview?.providerKey;

    if (!providerKey) {
      return;
    }

    setDiscoveryPreviewByProvider((current) => {
      const preview = current[providerKey];

      if (!preview) {
        return current;
      }

      const selected = new Set(preview.selectedModels);

      if (checked) {
        selected.add(modelName);
      } else {
        selected.delete(modelName);
      }

      return {
        ...current,
        [providerKey]: {
          ...preview,
          selectedModels: preview.chatModels.filter((item) => selected.has(item))
        }
      };
    });
  }

  async function saveDiscoveredModels() {
    if (!discoveryPreview) {
      return;
    }

    const provider = providers.find((item) => item.provider === discoveryPreview.providerKey);

    if (!provider) {
      setSubmitState({
        message: "Provider connection not found.",
        status: "error"
      });
      return;
    }

    setPendingAction(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/provider-connections", {
      body: JSON.stringify({
        action: "upsert",
        values: {
          ...getProviderFormValues(provider),
          isEdit: true,
          models: discoveryPreview.selectedModels.join(", ")
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
        message: payload.error ?? "Provider model save failed.",
        status: "error"
      });
      setPendingAction(false);
      return;
    }

    const savedProvider = payload.provider;
    const nextSelectedModel =
      discoveryPreview.selectedModels.includes(selectedModel)
        ? selectedModel
        : discoveryPreview.selectedModels[0] ?? selectedModel;

    setProviders((current) => [
      ...current.filter((item) => item.provider !== savedProvider.provider),
      savedProvider
    ]);
    setFormValues({
      ...getProviderFormValues(savedProvider),
      credentialValue: "",
      models: discoveryPreview.selectedModels.join(", ")
    });
    setSelectedModel(nextSelectedModel);
    setSubmitState({
      message: locale === "ko" ? "선택 모델을 저장했습니다." : "Selected provider models saved.",
      status: "success"
    });
    setPendingAction(false);
    onProviderSaved({
      provider: savedProvider,
      selectedModelKey: `${savedProvider.provider}::${nextSelectedModel}`
    });
  }

  if (providerRows.length === 0) {
    return (
      <div className="onboarding-provider-stack">
        <div>
          <h3>{text.title}</h3>
          <p>{text.description}</p>
        </div>
        <p className="project-empty">No provider presets are available.</p>
      </div>
    );
  }

  return (
    <div className="onboarding-provider-stack">
      <div className="onboarding-provider-heading">
        <div>
          <h3>{text.title}</h3>
          <p>{text.description}</p>
        </div>
        <KeyRound aria-hidden="true" />
      </div>

      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="onboarding-provider-list" aria-label={text.title}>
        {providerRows.map((row) => {
          const isSelected = row.providerKey === selectedProviderKey;

          return (
            <button
              aria-label={`Choose ${row.displayName}`}
              aria-selected={isSelected}
              className="onboarding-provider-option"
              data-selected={isSelected}
              key={row.providerKey}
              onClick={() => selectProvider(row)}
              type="button"
            >
              <span className="onboarding-provider-radio" aria-hidden="true">
                {isSelected ? <Check aria-hidden="true" /> : null}
              </span>
              <span className="onboarding-provider-logo" aria-hidden="true">
                {getProviderLogoText(row.providerKey, row.displayName)}
              </span>
              <span className="onboarding-provider-copy">
                <strong>{row.displayName}</strong>
                <small>{row.modelSummary}</small>
              </span>
              <span className="onboarding-provider-choice">
                {isSelected ? text.selected : text.choose}
              </span>
            </button>
          );
        })}
      </div>

      {formValues.credentialRequired ? (
        <label className="onboarding-field">
          <span>{text.apiKey}</span>
          <input
            autoComplete="off"
            maxLength={8192}
            onChange={(event) =>
              setFormValues((current) => ({
                ...current,
                credentialValue: event.target.value
              }))
            }
            placeholder={getProviderKeyPlaceholder(selectedRow?.providerKey ?? "")}
            type="password"
            value={formValues.credentialValue}
          />
        </label>
      ) : null}

      <p className="onboarding-provider-note">{text.apiKeyHelp}</p>

      <button
        className="primary-button onboarding-provider-submit"
        disabled={pendingAction || !selectedModel.trim()}
        onClick={() => void submitProvider()}
        type="button"
      >
        <Sparkles aria-hidden="true" />
        {pendingAction ? text.saving : text.save}
      </button>

      {discoveryPreview ? (
        <section
          aria-label={locale === "ko" ? "Provider 모델 선택" : "Provider selectable models"}
          className="provider-discovery-panel onboarding-provider-discovery-panel"
          role="group"
        >
          <div className="provider-model-selection-toolbar">
            <strong>
              {locale === "ko"
                ? `${discoveryPreview.selectedModels.length} / ${discoveryPreview.chatModels.length}개 선택`
                : `${discoveryPreview.selectedModels.length} / ${discoveryPreview.chatModels.length} selected`}
            </strong>
            <span className="project-muted">
              {locale === "ko"
                ? `제외된 비채팅 모델 ${discoveryPreview.skippedModelCount}개 • ${formatDateTime(discoveryPreview.discoveredAt)}`
                : `${discoveryPreview.skippedModelCount} non-chat models excluded • ${formatDateTime(discoveryPreview.discoveredAt)}`}
            </span>
            <div>
              <button onClick={() => setAllDiscoveredModels(true)} type="button">
                {locale === "ko" ? "전체 선택" : "Select all"}
              </button>
              <button onClick={() => setAllDiscoveredModels(false)} type="button">
                {locale === "ko" ? "전체 해제" : "Clear"}
              </button>
            </div>
          </div>
          <div className="provider-discovery-model-list">
            {discoveryPreview.chatModels.length > 0 ? (
              discoveryPreview.chatModels.map((modelName) => (
                <label className="provider-model-checkbox" key={modelName}>
                  <input
                    checked={discoveryPreview.selectedModels.includes(modelName)}
                    onChange={(event) => toggleDiscoveredModel(modelName, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{modelName}</span>
                </label>
              ))
            ) : (
              <p className="provider-model-empty">
                {locale === "ko"
                  ? "선택할 수 있는 chat 모델이 없습니다."
                  : "No chat models available to select."}
              </p>
            )}
          </div>
          <div className="provider-discovery-actions">
            <button
              className="primary-button"
              disabled={pendingAction || discoveryPreview.selectedModels.length === 0}
              onClick={() => void saveDiscoveredModels()}
              type="button"
            >
              {locale === "ko" ? "선택 모델 저장" : "Save selected models"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function getProviderRows(
  providers: ProviderConnectionRecord[],
  presets: ProviderPresetRecord[]
): ProviderDisplayRow[] {
  const providerMap = new Map(providers.map((provider) => [provider.provider, provider]));
  const rows = presets.map((preset) => {
    const connection = providerMap.get(preset.providerKey) ?? null;
    const models = getDisplayModels(connection, preset);

    return {
      connection,
      displayName: getProviderDisplayName(preset.providerKey, connection?.displayName ?? preset.displayName),
      modelSummary: models.length > 0 ? models.join(", ") : "model selection required",
      models,
      providerKey: preset.providerKey,
      preset
    };
  });
  const presetKeys = new Set(presets.map((preset) => preset.providerKey));
  const extraRows = providers
    .filter((provider) => !presetKeys.has(provider.provider))
    .map((provider) => {
      const models = getDisplayModels(provider, null);

      return {
        connection: provider,
        displayName: getProviderDisplayName(provider.provider, provider.displayName),
        modelSummary: models.length > 0 ? models.join(", ") : "model selection required",
        models,
        providerKey: provider.provider,
        preset: null
      };
    });

  return [...rows, ...extraRows].sort(
    (left, right) => getProviderOrder(left.providerKey) - getProviderOrder(right.providerKey)
  );
}

function getProviderOrder(providerKey: string) {
  const index = preferredProviderOrder.indexOf(providerKey);
  return index === -1 ? preferredProviderOrder.length : index;
}

function getProviderDisplayName(providerKey: string, fallback: string) {
  if (providerKey === "claude" || providerKey === "anthropic") {
    return "Anthropic";
  }

  if (providerKey === "gemini") {
    return "Google Gemini";
  }

  if (providerKey === "mock") {
    return "Mock Provider";
  }

  return fallback;
}

function getDisplayModels(
  connection: ProviderConnectionRecord | null,
  preset: ProviderPresetRecord | null
) {
  const configuredModels = connection
    ? getProviderConfigModels(connection.providerConfig)
    : getProviderConfigModels(preset?.providerConfig ?? null);

  return configuredModels.length > 0
    ? configuredModels
    : getPresetModelOptions(preset?.providerKey ?? connection?.provider ?? "");
}

function getProviderFormValuesForRow(row: ProviderDisplayRow, selectedModel: string) {
  if (row.connection) {
    return {
      ...getProviderFormValues(row.connection),
      models: selectedModel
    };
  }

  if (row.preset) {
    return {
      ...emptyProviderForm,
      adapterType: row.preset.adapterType,
      baseUrl: row.preset.baseUrl,
      credentialRequired: row.preset.credentialRequired,
      displayName: row.preset.displayName,
      models: selectedModel,
      modelsEndpointPath: row.preset.modelsEndpointPath,
      provider: row.preset.providerKey,
      requestFormat: getPresetRequestFormat(row.preset),
      resolver: row.preset.defaultResolver,
      timeoutMs: row.preset.defaultTimeoutMs
    };
  }

  return emptyProviderForm;
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
    credentialLast4: nullableText(provider.credentialPreview?.last4, ""),
    credentialPrefix: nullableText(provider.credentialPreview?.prefix, ""),
    credentialRequired: getProviderConfigBoolean(
      providerConfig,
      "credentialRequired",
      provider.resolver !== "none"
    ),
    credentialValue: "",
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

function getProviderConfigModels(providerConfig: Record<string, unknown> | null) {
  const models = providerConfig?.models;

  return Array.isArray(models)
    ? Array.from(
        new Set(
          models
            .map((model) => (typeof model === "string" ? normalizeDiscoveredModelName(model) : ""))
            .filter(Boolean)
            .filter(isChatCompletionModelName)
        )
      )
    : [];
}

function getPresetModelOptions(providerKey: string) {
  if (providerKey === "openai") {
    return ["gpt-4o-mini", "gpt-4o"];
  }

  if (providerKey === "gemini") {
    return ["gemini-1.5-flash", "gemini-1.5-pro"];
  }

  if (providerKey === "claude" || providerKey === "anthropic") {
    return ["claude-3.5-sonnet", "claude-3-haiku"];
  }

  if (providerKey === "cohere") {
    return ["command-r", "rerank"];
  }

  if (providerKey === "local") {
    return ["llama-3.1-local", "bge-embedding"];
  }

  if (providerKey === "mock") {
    return ["mock-fast", "mock-balanced"];
  }

  return [];
}

function normalizeDiscoveredModelName(modelName: string) {
  const normalized = modelName.trim();

  if (normalized.startsWith("models/gemini-")) {
    return normalized.slice("models/".length);
  }

  return normalized;
}

function getUniqueChatModels(models: string[]) {
  return Array.from(
    new Set(models.map((model) => normalizeDiscoveredModelName(model)).filter(Boolean))
  ).filter(isChatCompletionModelName);
}

function isChatCompletionModelName(modelName: string) {
  const normalizedModelName = modelName.toLowerCase();

  if (
    ["audio", "babbage", "codex", "dall-e", "embed", "image", "moderation", "tts", "whisper"].some(
      (token) => normalizedModelName.includes(token)
    )
  ) {
    return false;
  }

  return true;
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

  if (
    requestFormat === "openai_chat_completions" ||
    requestFormat === "anthropic_messages" ||
    requestFormat === "mock_chat_completions"
  ) {
    return requestFormat;
  }

  return getDefaultAdapterType(provider) === "anthropic"
    ? "anthropic_messages"
    : provider.provider === "mock"
      ? "mock_chat_completions"
      : "openai_chat_completions";
}

function getPresetRequestFormat(
  preset: ProviderPresetRecord
): ProviderConnectionFormValues["requestFormat"] {
  const requestFormat = preset.providerConfig?.requestFormat;

  if (
    requestFormat === "openai_chat_completions" ||
    requestFormat === "anthropic_messages" ||
    requestFormat === "mock_chat_completions"
  ) {
    return requestFormat;
  }

  return preset.adapterType === "anthropic"
    ? "anthropic_messages"
    : preset.adapterType === "mock"
      ? "mock_chat_completions"
      : "openai_chat_completions";
}

function getDefaultAdapterType(provider: ProviderConnectionRecord) {
  if (provider.provider === "mock") {
    return "mock";
  }

  return provider.provider === "claude" || provider.provider === "anthropic"
    ? "anthropic"
    : "openai_compatible";
}

function isRegisteredProvider(providers: ProviderConnectionRecord[], provider: string) {
  const normalizedProvider = provider.trim();

  return providers.some((item) => item.provider === normalizedProvider);
}

function getProviderLogoText(providerKey: string, displayName: string) {
  if (providerKey === "openai") {
    return "◎";
  }

  if (providerKey === "gemini") {
    return "✦";
  }

  if (providerKey === "claude" || providerKey === "anthropic") {
    return "AI";
  }

  return (displayName ?? "").slice(0, 2).toUpperCase();
}

function getProviderKeyPlaceholder(providerKey: string) {
  if (providerKey === "cohere") {
    return "co-live-...";
  }

  if (providerKey === "gemini") {
    return "AIza...";
  }

  return "sk-...";
}
