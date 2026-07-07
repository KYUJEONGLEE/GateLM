"use client";

import { Check, KeyRound, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  getProviderConnectionFamily,
  getProviderFamilyFromKey,
  ProviderFamilyIcon
} from "@/features/provider-connections/components/provider-family-icon";
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
  family: string;
  kind: "registered" | "unregistered";
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
  presetProviderKey: "openai",
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
const providerModelSummaryVisibleCount = 3;
const onboardingPresetProviderKeys = ["openai", "gemini"];
const onboardingProviderModelPageSize = 10;
const onboardingDefaultProviderModels: Record<string, string[]> = {
  gemini: ["gemini-3.5-flash", "gemini-2.5-pro"],
  openai: ["chat-latest", "gpt-4o", "gpt-4o-mini"]
};

export function OnboardingProviderRegistration({
  locale,
  model,
  onProviderSaved
}: OnboardingProviderRegistrationProps) {
  const text = onboardingProviderText[locale];
  const [providers, setProviders] = useState<ProviderConnectionRecord[]>(model.providers);
  const registeredProviderRows = useMemo(
    () => getProviderRows(providers, model.providerPresets.items, locale, model.controlPlaneTenantId),
    [locale, model.controlPlaneTenantId, model.providerPresets.items, providers]
  );
  const presetProviderRows = useMemo(
    () => getPresetProviderRows(model.providerPresets.items),
    [model.providerPresets.items]
  );
  const providerRows = useMemo(
    () => [...presetProviderRows, ...registeredProviderRows],
    [registeredProviderRows, presetProviderRows]
  );
  const [selectedProviderKey, setSelectedProviderKey] = useState(
    () => presetProviderRows[0]?.providerKey ?? registeredProviderRows[0]?.providerKey ?? ""
  );
  const selectedRow =
    providerRows.find((row) => row.providerKey === selectedProviderKey) ?? providerRows[0] ?? null;
  const [selectedModel, setSelectedModel] = useState(() => selectedRow?.models[0] ?? "");
  const [formValues, setFormValues] = useState<ProviderConnectionFormValues>(() =>
    selectedRow
      ? getProviderFormValuesForRow(selectedRow, selectedRow.models[0] ?? "", providers)
      : emptyProviderForm
  );
  const [pendingAction, setPendingAction] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const [discoveryPreviewByProvider, setDiscoveryPreviewByProvider] = useState<
    Record<string, ProviderDiscoveryPreview>
  >({});
  const [visibleModelCountByProvider, setVisibleModelCountByProvider] = useState<Record<string, number>>({});
  const discoveryPreview = selectedProviderKey
    ? discoveryPreviewByProvider[selectedProviderKey] ?? null
    : null;
  const discoveryModelList = discoveryPreview
    ? getModelDisplayList(
        discoveryPreview.chatModels,
        selectedRow?.family ?? getProviderFamilyFromKey(discoveryPreview.providerKey),
        visibleModelCountByProvider[discoveryPreview.providerKey] ?? onboardingProviderModelPageSize
      )
    : null;

  function selectProvider(row: ProviderDisplayRow) {
    const cachedPreview = discoveryPreviewByProvider[row.providerKey];
    const nextModel =
      cachedPreview?.selectedModels[0] ?? cachedPreview?.chatModels[0] ?? row.models[0] ?? "";

    setSelectedProviderKey(row.providerKey);
    setSelectedModel(nextModel);
    setFormValues(getProviderFormValuesForRow(row, nextModel, providers));
    setSubmitState({ message: "", status: "idle" });

    if (row.kind === "registered" && row.connection) {
      onProviderSaved({
        provider: row.connection,
        selectedModelKey: nextModel.trim()
          ? `${row.connection.provider}::${nextModel.trim()}`
          : ""
      });
    }
  }

  async function submitProvider() {
    if (!selectedRow || !formValues.provider.trim() || !selectedModel.trim()) {
      setSubmitState({ message: text.providerRequired, status: "error" });
      return;
    }

    if (selectedRow.kind === "registered" && selectedRow.connection) {
      onProviderSaved({
        provider: selectedRow.connection,
        selectedModelKey: `${selectedRow.connection.provider}::${selectedModel.trim()}`
      });
      setSubmitState({ message: text.registered, status: "success" });
      return;
    }

    const registeringProvider = providers.find(
      (provider) => provider.provider === formValues.provider.trim()
    );
    const requiresCredential =
      selectedRow.kind === "unregistered" &&
      formValues.credentialRequired && !hasProviderKeyRegistered(registeringProvider);

    if (requiresCredential && !formValues.credentialValue?.trim()) {
      setSubmitState({ message: text.providerRequired, status: "error" });
      return;
    }

    setPendingAction(true);
    setSubmitState({ message: "", status: "idle" });

    const selectedModels = getOnboardingDefaultSelectedModels(
      formValues.presetProviderKey || selectedRow.family,
      selectedModel
    );

    const response = await fetch("/api/control-plane/provider-connections", {
      body: JSON.stringify({
        action: "upsert",
        tenantId: model.routeTenantId,
        values: {
          ...formValues,
          isEdit: isRegisteredProvider(providers, formValues.provider),
          models: selectedModels.join(", ")
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
    const savedModel = selectedModels[0] ?? selectedModel.trim();

    setProviders((current) => [
      ...current.filter((provider) => provider.provider !== savedProvider.provider),
      savedProvider
    ]);
    setFormValues({
      ...getProviderFormValues(savedProvider),
      credentialValue: "",
      models: selectedModels.join(", ")
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
        tenantId: model.routeTenantId,
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

    const discoveredModels = (payload.discovery?.models ?? []).map((item) =>
      normalizeDiscoveredModelName(item.modelName)
    );
    const chatModels = getUniqueChatModels(discoveredModels);
    const preferredModels = getPreferredVisibleModels(
      chatModels,
      getProviderFamilyFromKey(provider.provider, provider.baseUrl)
    );
    const selectedModels =
      defaultModel && chatModels.includes(defaultModel)
        ? [defaultModel]
        : preferredModels.length > 0
          ? preferredModels
          : chatModels.slice(0, getDefaultVisibleModelLimit(provider.provider));

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
    setVisibleModelCountByProvider((current) => ({
      ...current,
      [provider.provider]: getInitialVisibleModelCount(
        chatModels,
        getProviderFamilyFromKey(provider.provider, provider.baseUrl)
      )
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
        tenantId: model.routeTenantId,
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
              aria-pressed={isSelected}
              className="onboarding-provider-option"
              data-kind={row.kind}
              data-selected={isSelected}
              key={row.providerKey}
              onClick={() => selectProvider(row)}
              type="button"
            >
              <span className="onboarding-provider-radio" aria-hidden="true">
                {isSelected ? <Check aria-hidden="true" /> : null}
              </span>
              <ProviderFamilyIcon className="onboarding-provider-logo" family={row.family} size={24} />
              <span className="onboarding-provider-copy">
                <strong>{row.displayName}</strong>
                {row.kind === "registered" && row.modelSummary ? (
                  <small>{row.modelSummary}</small>
                ) : null}
              </span>
              {row.kind === "unregistered" ? (
                <span className="onboarding-provider-choice">
                  {isSelected ? text.selected : text.choose}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selectedRow?.kind === "unregistered" && formValues.credentialRequired ? (
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
            placeholder={getProviderKeyPlaceholder(formValues.presetProviderKey)}
            type="password"
            value={formValues.credentialValue}
          />
        </label>
      ) : null}

      <p className="onboarding-provider-note">
        {selectedRow?.kind === "unregistered" ? text.apiKeyHelp : text.apiKeyRegistered}
      </p>

      {selectedRow?.kind === "unregistered" ? (
        <button
          className="primary-button onboarding-provider-submit"
          disabled={pendingAction || !selectedModel.trim()}
          onClick={() => void submitProvider()}
          type="button"
        >
          <Sparkles aria-hidden="true" />
          {pendingAction ? text.saving : text.save}
        </button>
      ) : null}

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
          <div className="provider-discovery-model-list provider-model-selection-table onboarding-provider-model-selection-table">
            {discoveryPreview.chatModels.length > 0 ? (
              <div className="provider-model-table-wrap provider-model-selection-table-wrap onboarding-provider-model-table-wrap">
                <table className="provider-model-table">
                  <thead>
                    <tr>
                      <th>{locale === "ko" ? "모델" : "Model"}</th>
                      <th>{locale === "ko" ? "기능" : "Capabilities"}</th>
                      <th>{locale === "ko" ? "컨텍스트" : "Context"}</th>
                      <th>{locale === "ko" ? "추천" : "Recommended"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discoveryModelList?.visibleModels.map((modelName) => {
                      const isSelected = discoveryPreview.selectedModels.includes(modelName);
                      const isRecommended = isRecommendedModel(
                        modelName,
                        selectedRow?.family ?? getProviderFamilyFromKey(discoveryPreview.providerKey)
                      );
                      const capabilities = getModelCapabilities(modelName);

                      return (
                        <tr
                          className="provider-model-select-row"
                          data-selected={isSelected}
                          key={modelName}
                          onClick={() => toggleDiscoveredModel(modelName, !isSelected)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleDiscoveredModel(modelName, !isSelected);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <td>
                            <span className="provider-model-name-with-check">
                              <input
                                checked={isSelected}
                                onChange={(event) =>
                                  toggleDiscoveredModel(modelName, event.target.checked)
                                }
                                onClick={(event) => event.stopPropagation()}
                                type="checkbox"
                              />
                              <strong>{modelName}</strong>
                            </span>
                          </td>
                          <td>
                            <span className="provider-model-capability-list">
                              {capabilities.map((capability) => (
                                <em key={capability}>{capability}</em>
                              ))}
                            </span>
                          </td>
                          <td>{getModelContextWindow(modelName)}</td>
                          <td>
                            <span className="provider-model-route" data-enabled={isRecommended}>
                              {isRecommended
                                ? locale === "ko"
                                  ? "추천"
                                  : "Recommended"
                                : "-"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {discoveryModelList && discoveryModelList.remainingCount > 0 ? (
                      <tr className="provider-model-more-table-row">
                        <td colSpan={4}>
                          <button
                            className="provider-model-more-button"
                            onClick={() =>
                              setVisibleModelCountByProvider((current) => ({
                                ...current,
                                [discoveryPreview.providerKey]:
                                  (current[discoveryPreview.providerKey] ??
                                    onboardingProviderModelPageSize) +
                                  onboardingProviderModelPageSize
                              }))
                            }
                            type="button"
                          >
                            {locale === "ko" ? "10개 더보기" : "Show 10 more"}
                            <span>
                              {locale === "ko"
                                ? `${discoveryModelList.remainingCount}개 남음`
                                : `${discoveryModelList.remainingCount} remaining`}
                            </span>
                          </button>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
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
  presets: ProviderPresetRecord[],
  locale: Locale,
  controlPlaneTenantId: string
): ProviderDisplayRow[] {
  return providers
    .filter((provider) => isTenantLevelProviderConnection(provider, controlPlaneTenantId))
    .filter(hasProviderKeyRegistered)
    .map((provider) => {
      const family = getProviderConnectionFamily(provider);
      const preset = getProviderPresetByFamily(family, presets);
      const models = getDisplayModels(provider, preset);

      return {
        connection: provider,
        displayName: provider.displayName || getProviderDisplayName(family, preset?.displayName ?? provider.provider),
        family,
        kind: "registered" as const,
        modelSummary: formatProviderModelSummary(models, locale),
        models,
        providerKey: provider.provider,
        preset
      };
    })
    .sort((left, right) => {
      const orderDelta = getProviderOrder(left.family) - getProviderOrder(right.family);

      return orderDelta !== 0
        ? orderDelta
        : left.displayName.localeCompare(right.displayName);
    });
}

function isTenantLevelProviderConnection(
  provider: ProviderConnectionRecord,
  controlPlaneTenantId: string
) {
  return provider.projectId === null && provider.tenantId === controlPlaneTenantId;
}

function getPresetProviderRows(presets: ProviderPresetRecord[]): ProviderDisplayRow[] {
  return presets
    .filter((preset) => onboardingPresetProviderKeys.includes(preset.providerKey))
    .map((preset) => {
      const models = getDisplayModels(null, preset);

      return {
        connection: null,
        displayName: getProviderDisplayName(preset.providerKey, preset.displayName),
        family: preset.providerKey,
        kind: "unregistered" as const,
        modelSummary: "",
        models,
        providerKey: `preset:${preset.providerKey}`,
        preset
      };
    })
    .sort((left, right) => getProviderOrder(left.family) - getProviderOrder(right.family));
}

function formatProviderModelSummary(models: string[], locale: Locale) {
  if (models.length === 0) {
    return "model selection required";
  }

  const visibleModels = models.slice(0, providerModelSummaryVisibleCount);
  const hiddenModelCount = models.length - visibleModels.length;

  if (hiddenModelCount <= 0) {
    return visibleModels.join(", ");
  }

  const hiddenSummary =
    locale === "ko" ? `외 ${hiddenModelCount}개` : `+ ${hiddenModelCount} more`;

  return `${visibleModels.join(", ")}, ${hiddenSummary}`;
}

function getProviderOrder(providerKey: string) {
  const index = preferredProviderOrder.indexOf(providerKey);
  return index === -1 ? preferredProviderOrder.length : index;
}

function getProviderPresetByFamily(providerFamily: string, presets: ProviderPresetRecord[]) {
  return presets.find((preset) => preset.providerKey === providerFamily) ?? null;
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

function getProviderFormValuesForRow(
  row: ProviderDisplayRow,
  selectedModel: string,
  providers: ProviderConnectionRecord[]
) {
  if (row.connection) {
    return {
      ...getProviderFormValues(row.connection),
      models: selectedModel
    };
  }

  if (row.preset) {
    const provider = getNextProviderConnectionKey(row.preset.providerKey, providers);

    return {
      ...emptyProviderForm,
      adapterType: row.preset.adapterType,
      baseUrl: row.preset.baseUrl,
      credentialRequired: row.preset.credentialRequired,
      displayName: getDefaultProviderDisplayName(row.preset, provider),
      models: selectedModel,
      modelsEndpointPath: row.preset.modelsEndpointPath,
      presetProviderKey: row.preset.providerKey,
      provider,
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
    presetProviderKey: getProviderConfigString(providerConfig, "providerFamily", provider.provider),
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
    return onboardingDefaultProviderModels.openai;
  }

  if (providerKey === "gemini") {
    return onboardingDefaultProviderModels.gemini;
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

function getModelDisplayList(
  models: string[],
  providerFamily: string,
  visibleCount: number
) {
  const preferredModels = getPreferredVisibleModels(models, providerFamily);
  const preferredModelSet = new Set(preferredModels);
  const orderedModels = [
    ...preferredModels,
    ...models.filter((model) => !preferredModelSet.has(model))
  ];
  const normalizedVisibleCount = Math.max(
    getInitialVisibleModelCount(models, providerFamily),
    visibleCount
  );
  const visibleModels = orderedModels.slice(0, normalizedVisibleCount);

  return {
    remainingCount: Math.max(orderedModels.length - visibleModels.length, 0),
    visibleModels
  };
}

function getInitialVisibleModelCount(models: string[], providerFamily: string) {
  return getPreferredVisibleModels(models, providerFamily).length || onboardingProviderModelPageSize;
}

function getPreferredVisibleModels(models: string[], providerFamily: string) {
  const family = getProviderFamilyFromKey(providerFamily);
  const usedModels = new Set<string>();
  const preferredModels: string[] = [];
  const modelRules = getPreferredModelRules(family);

  for (const rule of modelRules) {
    const matchedModel = models.find(
      (model) => !usedModels.has(model) && rule.matches(model.toLowerCase())
    );

    if (matchedModel) {
      preferredModels.push(matchedModel);
      usedModels.add(matchedModel);
    }
  }

  return preferredModels;
}

function getDefaultVisibleModelLimit(providerFamily: string) {
  return getProviderFamilyFromKey(providerFamily) === "gemini" ? 3 : 4;
}

function isRecommendedModel(modelName: string, providerFamily: string) {
  const normalizedModelName = normalizeDiscoveredModelName(modelName).toLowerCase();

  return getPreferredModelRules(getProviderFamilyFromKey(providerFamily)).some((rule) =>
    rule.matches(normalizedModelName)
  );
}

function getPreferredModelRules(providerFamily: string) {
  if (providerFamily === "gemini") {
    return [
      { matches: (model: string) => isSameOrVariantModel(model, "gemini-3.5-flash") },
      { matches: (model: string) => isSameOrVariantModel(model, "gemini-2.5-pro") },
      { matches: (model: string) => isSameOrVariantModel(model, "gemini-2.5-flash") }
    ];
  }

  if (providerFamily === "openai") {
    return [
      {
        matches: (model: string) =>
          model === "chat latest" ||
          model === "chat-latest" ||
          model === "chatgpt-4o-latest" ||
          model === "gpt-4o-latest"
      },
      { matches: (model: string) => model === "gpt-4o" },
      { matches: (model: string) => model === "gpt-4o-mini" },
      { matches: (model: string) => isSameOrVariantModel(model, "gpt-5.5") }
    ];
  }

  return [];
}

function getOnboardingDefaultSelectedModels(providerFamily: string, selectedModel: string) {
  const normalizedFamily = getProviderFamilyFromKey(providerFamily);
  const defaultModels = onboardingDefaultProviderModels[normalizedFamily] ?? [];

  if (defaultModels.length > 0) {
    return defaultModels;
  }

  return selectedModel.trim() ? [selectedModel.trim()] : [];
}

function isSameOrVariantModel(model: string, target: string) {
  return model === target || model.startsWith(`${target}-`);
}

function getModelCapabilities(modelName: string) {
  const normalized = modelName.toLowerCase();
  const capabilities = ["chat"];

  if (
    normalized.includes("4o") ||
    normalized.includes("vision") ||
    normalized.includes("gemini") ||
    normalized.includes("claude")
  ) {
    capabilities.push("vision");
  }

  return capabilities;
}

function getModelContextWindow(modelName: string) {
  const normalized = modelName.toLowerCase();

  if (normalized.includes("embedding")) {
    return "1k";
  }

  if (normalized.includes("gemini")) {
    return "1M";
  }

  if (normalized.includes("claude")) {
    return "200k";
  }

  if (normalized.includes("4o") || normalized.includes("o3") || normalized.includes("o4")) {
    return "128k";
  }

  return "-";
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

function hasProviderKeyRegistered(provider: ProviderConnectionRecord | null | undefined) {
  if (!provider) {
    return false;
  }

  const credentialRequired = getProviderConfigBoolean(
    provider.providerConfig,
    "credentialRequired",
    provider.resolver !== "none"
  );

  if (!credentialRequired) {
    return true;
  }

  return Boolean(provider.credentialPreview?.prefix || provider.credentialPreview?.last4);
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

function getNextProviderConnectionKey(
  providerFamily: string,
  providers: ProviderConnectionRecord[]
) {
  const usedProviders = new Set(providers.map((provider) => provider.provider));
  const normalizedFamily = providerFamily.replace(/[^a-z0-9_-]/g, "") || "provider";
  const mainProvider = `${normalizedFamily}-main`;

  if (!usedProviders.has(mainProvider)) {
    return mainProvider;
  }

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${normalizedFamily}-${index}`;

    if (!usedProviders.has(candidate)) {
      return candidate;
    }
  }

  return `${normalizedFamily}-${Date.now().toString(36)}`;
}

function getDefaultProviderDisplayName(preset: ProviderPresetRecord, provider: string) {
  if (provider.endsWith("-main")) {
    return `${preset.displayName} Main`;
  }

  return `${preset.displayName} ${provider.split("-").at(-1) ?? ""}`.trim();
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
