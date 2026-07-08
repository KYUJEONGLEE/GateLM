"use client";

import { ChevronDown, KeyRound, Pencil, PlugZap, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getProviderConnectionFamily,
  getProviderFamilyFromKey,
  ProviderFamilyIcon
} from "@/features/provider-connections/components/provider-family-icon";
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

type ProviderDiscoveryPreview = {
  chatModels: string[];
  discoveredAt: string;
  modelReleaseDates: Record<string, string | null>;
  selectedModels: string[];
  skippedModelCount: number;
};

type ProviderResponsePayload = {
  discovery?: ProviderModelDiscovery;
  error?: string;
  provider?: ProviderConnectionRecord;
  status?: number;
};

type ProviderModalState =
  | {
      mode: "create";
    }
  | {
      mode: "credential";
      provider: string;
    };

const providerKeyPattern = /^[a-z][a-z0-9_-]{1,63}$/;
const minProviderTimeoutMs = 1000;
const maxProviderTimeoutMs = 120000;
const providerModelPageSize = 10;

const emptyProviderForm: ProviderConnectionFormValues = {
  adapterType: "openai_compatible",
  apiVersion: "",
  baseUrl: "",
  credentialRequired: true,
  credentialLast4: "",
  credentialPrefix: "",
  credentialValue: "",
  displayName: "",
  failureMode: "fail_closed",
  models: "",
  modelsEndpointPath: "/models",
  presetProviderKey: "openai",
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
    deleteProvider: string;
    edit: string;
    apiKeyChange: string;
    credentialRequired: string;
    credentialLast4: string;
    credentialPrefix: string;
    credentialValue: string;
    credentialValuePlaceholder: string;
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
    providerConfig: string;
    providerId: string;
    register: string;
    registerAction: string;
    registerDescription: string;
    requestFormat: string;
    resolver: string;
    save: string;
    saveChanges: string;
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
    deleteProvider: "Delete",
    edit: "Edit",
    apiKeyChange: "Change API key",
    apiVersion: "API version",
    baseUrl: "Base URL",
    created: "Created",
    credential: "Credential preview",
    credentialRequired: "Credential required",
    credentialLast4: "Credential last 4",
    credentialPrefix: "Credential prefix",
    credentialValue: "API key registration",
    credentialValuePlaceholder: "Paste provider API key",
    displayName: "Provider name",
    discoverModels: "Discover models",
    discoveryOpenAiOnly: "Model discovery is enabled for OpenAI-compatible and Anthropic providers.",
    empty: "No provider connections found.",
    fixtureFallback: "Control Plane unavailable. Showing fixture provider connection.",
    management: "management",
    models: "Models",
    modelsEndpointPath: "Models endpoint",
    failureMode: "Failure mode",
    projectId: "Project ID",
    provider: "Provider key",
    providerConfig: "Provider config",
    providerId: "Provider ID",
    register: "Register provider",
    registerAction: "Register",
    registerDescription: "Register the provider API key at the tenant level.",
    requestFormat: "Request format",
    resolver: "Resolver",
    save: "Save",
    saveChanges: "Save changes",
    secretRef: "Secret reference",
    source: "Source",
    status: "Status",
    timeoutMs: "Timeout ms",
    title: "Providers",
    updated: "Updated"
  },
  ko: {
    adapterType: "Adapter type",
    deleteProvider: "삭제",
    edit: "편집",
    apiKeyChange: "API key 변경",
    apiVersion: "API version",
    baseUrl: "Base URL",
    created: "생성",
    credential: "Credential preview",
    credentialRequired: "Credential required",
    credentialLast4: "Credential last 4",
    credentialPrefix: "Credential prefix",
    credentialValue: "API key 등록",
    credentialValuePlaceholder: "Provider API key 입력",
    displayName: "Provider 이름",
    discoverModels: "모델 조회",
    discoveryOpenAiOnly: "모델 조회는 OpenAI 호환 및 Anthropic Provider에서 활성화됩니다.",
    empty: "Provider connection이 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture Provider connection을 표시 중입니다.",
    management: "관리",
    models: "Models",
    modelsEndpointPath: "Models endpoint",
    failureMode: "Failure mode",
    projectId: "Project ID",
    provider: "Provider key",
    providerConfig: "Provider config",
    providerId: "Provider ID",
    register: "Provider 등록",
    registerAction: "등록",
    registerDescription: "Provider API Key를 Tenant/global 단위로 등록합니다.",
    requestFormat: "Request format",
    resolver: "Resolver",
    save: "저장",
    saveChanges: "변경 저장",
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
  const [, setModelOptionsByProvider] = useState<Record<string, string[]>>(
    () => getInitialModelOptions(model.providers)
  );
  const [discoveryByProvider, setDiscoveryByProvider] = useState<Record<string, ProviderDiscoveryPreview>>({});
  const [visibleModelCountByProvider, setVisibleModelCountByProvider] = useState<Record<string, number>>({});
  const [pendingAction, setPendingAction] = useState(false);
  const [discoveringProvider, setDiscoveringProvider] = useState<string | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [providerModal, setProviderModal] = useState<ProviderModalState | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const activeDiscoveryKey = formValues.previousProvider?.trim() || formValues.provider.trim();
  const activeDiscovery = activeDiscoveryKey ? discoveryByProvider[activeDiscoveryKey] : undefined;

  async function submitProvider() {
    const discovery = activeDiscovery;
    const valuesToSubmit = {
      ...formValues,
      models: discovery ? discovery.selectedModels.join(", ") : formValues.models
    };
    const validationError = validateProviderForm(valuesToSubmit, locale);

    if (validationError) {
      setSubmitState({ message: validationError, status: "error" });
      return;
    }

    const previousProvider = valuesToSubmit.previousProvider?.trim();
    const nextProvider = valuesToSubmit.provider.trim();
    const registeringProvider = providers.find(
      (provider) =>
        provider.provider === previousProvider ||
        provider.provider === nextProvider
    );
    const requiresCredential =
      valuesToSubmit.credentialRequired && !hasProviderKeyRegistered(registeringProvider);

    if (requiresCredential && !valuesToSubmit.credentialValue?.trim()) {
      setSubmitState({
        message:
          locale === "ko"
            ? "Provider API Key를 입력하세요."
            : "Enter the provider API key.",
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
          ...valuesToSubmit,
          isEdit: Boolean(registeringProvider)
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

    setProviders((current) => [
      ...current.filter(
        (provider) =>
          provider.id !== savedProvider.id &&
          provider.provider !== savedProvider.provider &&
          (!previousProvider || provider.provider !== previousProvider)
      ),
      savedProvider
    ]);
    setModelOptionsByProvider((current) => ({
      ...current,
      [savedProvider.provider]: current[savedProvider.provider]?.length
        ? current[savedProvider.provider]
        : getProviderConfigModels(savedProvider.providerConfig).filter(isChatCompletionModelName)
    }));
    setDiscoveryByProvider((current) => {
      const next = { ...current };
      if (previousProvider) {
        delete next[previousProvider];
      }
      delete next[savedProvider.provider];
      return next;
    });
    setFormValues({
      ...getProviderFormValues(savedProvider),
      credentialValue: ""
    });
    setEditingProviderId(null);
    setProviderModal(null);
    setSubmitState({
      message: locale === "ko" ? "Provider가 저장되었습니다." : "Provider saved.",
      status: "success"
    });
    setPendingAction(false);
    router.refresh();
  }

  async function discoverModels(provider = formValues.provider, options: { applyToForm?: boolean } = {}) {
    const applyToForm = options.applyToForm ?? true;
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
        tenantId: model.routeTenantId,
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
              ? "Tenant/global Provider를 찾을 수 없습니다. Provider를 저장한 뒤 다시 조회하세요."
              : "Tenant/global provider is not registered. Save the provider and try again."
            : getProviderDiscoveryErrorMessage(payload.error, normalizedProvider, locale),
        status: "error"
      });
      setDiscoveringProvider(null);
      return;
    }

    const discoveredModels = payload.discovery.models.map((item) =>
      normalizeDiscoveredModelName(item.modelName)
    );
    const modelReleaseDates = Object.fromEntries(
      payload.discovery.models.map((item) => [
        normalizeDiscoveredModelName(item.modelName),
        item.createdAt
      ])
    );
    const chatModels = filterChatCompletionModels(discoveredModels);
    const existingSelectedModels = splitModelNames(baseValues.models).filter((modelName) =>
      chatModels.includes(modelName)
    );
    const preferredModels = getPreferredVisibleModels(
      chatModels,
      getProviderFamilyFromKey(normalizedProvider, baseValues.baseUrl)
    );
    const selectedModels =
      existingSelectedModels.length > 0
        ? existingSelectedModels
        : preferredModels.length > 0
          ? preferredModels
          : chatModels.slice(0, getDefaultVisibleModelLimit(normalizedProvider));
    const skippedModelCount = discoveredModels.length - chatModels.length;

    setModelOptionsByProvider((current) => ({
      ...current,
      [normalizedProvider]: chatModels
    }));
    setDiscoveryByProvider((current) => ({
      ...current,
      [normalizedProvider]: {
        chatModels,
        discoveredAt: payload.discovery?.discoveredAt ?? new Date().toISOString(),
        modelReleaseDates,
        selectedModels,
        skippedModelCount
      }
    }));
    setVisibleModelCountByProvider((current) => ({
      ...current,
      [normalizedProvider]: getInitialVisibleModelCount(
        chatModels,
        getProviderFamilyFromKey(normalizedProvider, baseValues.baseUrl)
      )
    }));
    if (applyToForm) {
      setFormValues((current) => {
        return {
          ...current,
          adapterType: payload.discovery?.adapterType ?? current.adapterType,
          baseUrl: payload.discovery?.baseUrl ?? current.baseUrl,
          credentialRequired: payload.discovery?.credentialRequired ?? current.credentialRequired,
          models: selectedModels.join(", ")
        };
      });
    }
    setSubmitState({
      message:
        locale === "ko"
          ? applyToForm
            ? `${chatModels.length}개 chat 모델을 조회했습니다. 사용할 모델을 선택하세요. 제외된 비채팅 모델: ${skippedModelCount}개.`
            : `${normalizedProvider}에서 ${chatModels.length}개 chat 모델을 조회했습니다. 사용할 모델을 선택하세요. 제외된 비채팅 모델: ${skippedModelCount}개.`
          : applyToForm
            ? `${chatModels.length} chat models discovered. Select models to use. Excluded non-chat models: ${skippedModelCount}.`
            : `${chatModels.length} chat models discovered from ${normalizedProvider}. Select models to use. Excluded non-chat models: ${skippedModelCount}.`,
      status: "success"
    });
    setDiscoveringProvider(null);
  }

  async function deleteProvider(provider: ProviderConnectionRecord) {
    if (!canDeleteProvider(provider, model.source)) {
      setSubmitState({
        message:
          locale === "ko"
            ? "Tenant/global provider만 삭제할 수 있습니다."
            : "Only tenant/global provider connections can be deleted.",
        status: "error"
      });
      return;
    }

    const confirmed = window.confirm(
      locale === "ko"
        ? `${provider.displayName} provider key를 삭제할까요? 연결된 Application provider 설정도 함께 해제됩니다.`
        : `Delete ${provider.displayName} provider key? Connected application provider settings will also be removed.`
    );

    if (!confirmed) {
      return;
    }

    setPendingAction(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/provider-connections", {
      body: JSON.stringify({
        action: "delete-provider",
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

    if (!response.ok || !payload.provider) {
      setSubmitState({
        message: payload.error ?? "Provider deletion failed.",
        status: "error"
      });
      setPendingAction(false);
      return;
    }

    const deletedProvider = payload.provider;

    setProviders((current) => current.filter((item) => item.id !== deletedProvider.id));
    setModelOptionsByProvider((current) => {
      const next = { ...current };
      delete next[deletedProvider.provider];
      return next;
    });
    setDiscoveryByProvider((current) => {
      const next = { ...current };
      delete next[deletedProvider.provider];
      return next;
    });
    if (formValues.provider === deletedProvider.provider) {
      setFormValues(emptyProviderForm);
    }
    if (editingProviderId === deletedProvider.id) {
      setEditingProviderId(null);
    }
    setSubmitState({
      message:
        locale === "ko"
          ? `${deletedProvider.provider} provider를 삭제했습니다.`
          : `Deleted provider ${deletedProvider.provider}.`,
      status: "success"
    });
    setPendingAction(false);
    router.refresh();
  }

  function openCreateModal() {
    const preset = model.providerPresets.items[0] ?? null;

    setProviderModal({ mode: "create" });
    setEditingProviderId(null);
    setFormValues(getProviderFormValuesFromPreset(preset, providers));
    setSubmitState({ message: "", status: "idle" });
  }

  function openEditModal(provider: ProviderConnectionRecord) {
    const providerModels = getProviderConfigModels(provider.providerConfig).filter(
      isChatCompletionModelName
    );

    setModelOptionsByProvider((current) => ({
      ...current,
      [provider.provider]: current[provider.provider]?.length
        ? current[provider.provider]
        : providerModels
    }));
    setProviderModal(null);
    setExpandedProviderId(provider.id);
    setEditingProviderId((current) => (current === provider.id ? null : provider.id));
    setFormValues(getProviderFormValues(provider));
    setSubmitState({ message: "", status: "idle" });
  }

  function toggleProvider(providerId: string) {
    setExpandedProviderId((current) => (current === providerId ? null : providerId));
    setEditingProviderId(null);
  }

  function openCredentialModal(provider: ProviderConnectionRecord) {
    setProviderModal({ mode: "credential", provider: provider.provider });
    setFormValues({
      ...getProviderFormValues(provider),
      credentialValue: ""
    });
    setSubmitState({ message: "", status: "idle" });
  }

  function applyProviderPresetToForm(providerKey: string) {
    const preset = model.providerPresets.items.find((item) => item.providerKey === providerKey) ?? null;

    setFormValues(() => ({
      ...getProviderFormValuesFromPreset(preset, providers),
      credentialValue: ""
    }));
  }

  function closeRegistrationModal() {
    setProviderModal(null);
    if (!editingProviderId) {
      setFormValues(emptyProviderForm);
      return;
    }

    const editingProvider = providers.find((provider) => provider.id === editingProviderId);
    setFormValues(editingProvider ? getProviderFormValues(editingProvider) : emptyProviderForm);
  }

  function toggleDiscoveredModel(providerKey: string, modelName: string, checked: boolean) {
    setDiscoveryByProvider((current) => {
      const discovery = current[providerKey];

      if (!discovery) {
        return current;
      }

      const selectedModelSet = new Set(discovery.selectedModels);

      if (checked) {
        selectedModelSet.add(modelName);
      } else {
        selectedModelSet.delete(modelName);
      }

      return {
        ...current,
        [providerKey]: {
          ...discovery,
          selectedModels: discovery.chatModels.filter((item) => selectedModelSet.has(item))
        }
      };
    });
  }

  function setAllDiscoveredModels(providerKey: string, checked: boolean) {
    setDiscoveryByProvider((current) => {
      const discovery = current[providerKey];

      if (!discovery) {
        return current;
      }

      return {
        ...current,
        [providerKey]: {
          ...discovery,
          selectedModels: checked ? discovery.chatModels : []
        }
      };
    });
  }

  function renderProviderInlineEditor(provider: ProviderConnectionRecord) {
    const activeProviderFamily = getProviderFamilyFromKey(activeDiscoveryKey, formValues.baseUrl);
    const activeDiscoveryModelList = activeDiscovery
      ? getModelDisplayList(
          activeDiscovery.chatModels,
          activeProviderFamily,
          visibleModelCountByProvider[activeDiscoveryKey] ?? providerModelPageSize
        )
      : null;

    return (
      <>
        <div className="provider-model-edit provider-card-inline-edit">
          <div className="provider-model-selection-toolbar provider-card-model-toolbar">
            <strong>
              {activeDiscovery
                ? locale === "ko"
                  ? `${activeDiscovery.selectedModels.length} / ${activeDiscovery.chatModels.length}개 선택`
                  : `${activeDiscovery.selectedModels.length} / ${activeDiscovery.chatModels.length} selected`
                : locale === "ko"
                  ? "모델 목록"
                  : "Model list"}
            </strong>
            <div>
              {activeDiscovery ? (
                <>
                  <button onClick={() => setAllDiscoveredModels(activeDiscoveryKey, true)} type="button">
                    {locale === "ko" ? "전체 선택" : "Select all"}
                  </button>
                  <button onClick={() => setAllDiscoveredModels(activeDiscoveryKey, false)} type="button">
                    {locale === "ko" ? "전체 해제" : "Clear"}
                  </button>
                </>
              ) : null}
              <Button
                disabled={
                  pendingAction ||
                  discoveringProvider !== null ||
                  !isDiscoverSupportedProvider(formValues.adapterType)
                }
                onClick={() =>
                  void discoverModels(formValues.previousProvider || formValues.provider, {
                    applyToForm: true
                  })
                }
                type="button"
                variant="outline"
              >
                {discoveringProvider === (formValues.previousProvider || formValues.provider)
                  ? "..."
                  : text.discoverModels}
              </Button>
            </div>
        </div>
          {activeDiscovery ? (
            <>
              <div className="provider-model-selection-toolbar provider-model-selection-subtoolbar provider-card-model-discovery-note">
                <span className="project-muted">
                  {locale === "ko"
                    ? `제외된 비채팅 모델 ${activeDiscovery.skippedModelCount}개 · ${formatDateTime(activeDiscovery.discoveredAt)}`
                    : `${activeDiscovery.skippedModelCount} non-chat models excluded · ${formatDateTime(activeDiscovery.discoveredAt)}`}
                </span>
              </div>
              <div className="provider-discovery-model-list provider-model-selection-table">
                {activeDiscovery.chatModels.length > 0 ? (
                  <div className="provider-model-table-wrap provider-model-selection-table-wrap">
                    <table className="provider-model-table">
                      <thead>
                        <tr>
                          <th>{locale === "ko" ? "모델" : "Model"}</th>
                          <th>{locale === "ko" ? "기능" : "Capabilities"}</th>
                          <th>{locale === "ko" ? "컨텍스트" : "Context"}</th>
                          <th>{locale === "ko" ? "추천" : "Recommended"}</th>
                          <th>{locale === "ko" ? "출시날짜" : "Release date"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDiscoveryModelList?.visibleModels.map((modelName) => {
                          const isSelected = activeDiscovery.selectedModels.includes(modelName);
                          const isRecommended = isRecommendedModel(modelName, activeProviderFamily);
                          const capabilities = getModelCapabilities(modelName);

                          return (
                            <tr
                              className="provider-model-select-row"
                              data-selected={isSelected}
                              key={modelName}
                              onClick={() =>
                                toggleDiscoveredModel(activeDiscoveryKey, modelName, !isSelected)
                              }
                              onKeyDown={(event) => {
                                if (event.target instanceof HTMLInputElement) {
                                  return;
                                }

                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  toggleDiscoveredModel(activeDiscoveryKey, modelName, !isSelected);
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
                                      toggleDiscoveredModel(
                                        activeDiscoveryKey,
                                        modelName,
                                        event.target.checked
                                      )
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
                              <td>
                                {formatModelReleaseDate(
                                  modelName,
                                  activeDiscovery.modelReleaseDates,
                                  locale
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {activeDiscoveryModelList && activeDiscoveryModelList.remainingCount > 0 ? (
                          <tr className="provider-model-more-table-row">
                            <td colSpan={5}>
                              <button
                                className="provider-model-more-button"
                                onClick={() =>
                                  setVisibleModelCountByProvider((current) => ({
                                    ...current,
                                    [activeDiscoveryKey]:
                                      (current[activeDiscoveryKey] ?? providerModelPageSize) +
                                      providerModelPageSize
                                  }))
                                }
                                type="button"
                              >
                                {locale === "ko" ? "10개 더보기" : "Show 10 more"}
                                <span>
                                  {locale === "ko"
                                    ? `${activeDiscoveryModelList.remainingCount}개 남음`
                                    : `${activeDiscoveryModelList.remainingCount} remaining`}
                                </span>
                              </button>
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <span className="project-muted">
                    {locale === "ko"
                      ? "반영 가능한 chat 모델이 없습니다."
                      : "No chat models available to apply."}
                  </span>
                )}
              </div>
            </>
          ) : (
            renderProviderModels(provider)
          )}
        </div>
        <div className="provider-discovery-actions provider-card-edit-actions">
          <Button
            className="provider-delete-action"
            disabled={
              pendingAction ||
              discoveringProvider !== null ||
              !canDeleteProvider(provider, model.source)
            }
            onClick={() => void deleteProvider(provider)}
            title={
              canDeleteProvider(provider, model.source)
                ? text.deleteProvider
                : locale === "ko"
                  ? "Tenant/global provider만 삭제할 수 있습니다."
                  : "Only tenant/global provider connections can be deleted."
            }
            type="button"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" />
            {text.deleteProvider}
          </Button>
          <Button
            disabled={pendingAction || discoveringProvider !== null}
            onClick={() => openCredentialModal(provider)}
            type="button"
            variant="outline"
          >
            <KeyRound aria-hidden="true" />
            {text.apiKeyChange}
          </Button>
          <Button
            onClick={() => {
              setEditingProviderId(null);
              setFormValues(emptyProviderForm);
            }}
            type="button"
            variant="outline"
          >
            {locale === "ko" ? "취소" : "Cancel"}
          </Button>
          <Button disabled={pendingAction} onClick={() => void submitProvider()} type="button">
            {text.saveChanges}
          </Button>
        </div>
      </>
    );
  }

  function renderProviderModels(provider: ProviderConnectionRecord) {
    const discovery = discoveryByProvider[provider.provider];
    const modelNames = Array.from(
      new Set(
        discovery
          ? discovery.selectedModels
          : getProviderConfigModels(provider.providerConfig).filter(isChatCompletionModelName)
      )
    );

    if (modelNames.length === 0) {
      return (
        <div className="provider-model-empty-state">
          {locale === "ko"
            ? "아직 등록된 chat 모델이 없습니다. 모델 조회 후 사용할 모델을 저장하세요."
            : "No chat models registered yet. Discover models and save the models to use."}
        </div>
      );
    }

    return (
      <div className="provider-model-table-wrap">
        <table className="provider-model-table">
          <thead>
            <tr>
              <th>{locale === "ko" ? "모델" : "Model"}</th>
              <th>{locale === "ko" ? "기능" : "Capabilities"}</th>
              <th>{locale === "ko" ? "컨텍스트" : "Context"}</th>
              <th>{locale === "ko" ? "추천" : "Recommended"}</th>
              <th>{locale === "ko" ? "출시날짜" : "Release date"}</th>
            </tr>
          </thead>
          <tbody>
            {modelNames.map((modelName) => {
              const capabilities = getModelCapabilities(modelName);
              const providerFamily = getProviderConnectionFamily(provider);
              const isRecommended = isRecommendedModel(modelName, providerFamily);

              return (
                <tr key={modelName}>
                  <td>
                    <strong>{modelName}</strong>
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
                  <td>
                    {formatModelReleaseDate(modelName, discovery?.modelReleaseDates, locale)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main className="console-content management-line-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.source === "fixture" ? (
        <Alert variant="warning">
          <AlertDescription>
            {text.fixtureFallback} {model.loadError}
          </AlertDescription>
        </Alert>
      ) : null}
      {model.providerPresets.source === "fallback" && model.providerPresets.loadError ? (
        <Alert variant="warning">
          <AlertDescription>{model.providerPresets.loadError}</AlertDescription>
        </Alert>
      ) : null}
      {submitState.message && !providerModal ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="console-panel provider-line-panel">
        <div className="panel-heading provider-panel-heading">
          <h3>{text.title}</h3>
          <Button
            disabled={pendingAction || discoveringProvider !== null || model.providerPresets.items.length === 0}
            onClick={openCreateModal}
            type="button"
          >
            <Plus aria-hidden="true" />
            {text.registerAction}
          </Button>
        </div>
        {providers.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="provider-card-list">
            {providers.map((provider) => {
              const hasRegisteredKey = hasProviderKeyRegistered(provider);
              const family = getProviderConnectionFamily(provider);
              const preset = getProviderPreset(family, model.providerPresets.items);
              const expanded = expandedProviderId === provider.id;
              const modelCount = getProviderConfigModels(provider.providerConfig).filter(
                isChatCompletionModelName
              ).length;

              const isEditing = editingProviderId === provider.id;

              return (
                <section className="provider-card" data-expanded={expanded} key={provider.id}>
                  <div
                    className="provider-card-row"
                    onClick={() => toggleProvider(provider.id)}
                  >
                    <div className="provider-card-identity">
                      <ProviderFamilyIcon className="provider-card-icon" family={family} />
                      <div>
                        <div className="provider-card-title-row">
                          {isEditing ? (
                            <input
                              autoComplete="off"
                              className="provider-name-input"
                              maxLength={120}
                              onChange={(event) =>
                                setFormValues((current) => ({
                                  ...current,
                                  displayName: event.target.value
                                }))
                              }
                              onClick={(event) => event.stopPropagation()}
                              value={formValues.displayName}
                            />
                          ) : (
                            <strong className="provider-name">{provider.displayName}</strong>
                          )}
                          <Badge className="provider-family-badge" variant="outline">
                            {preset?.displayName ?? getProviderFamilyLabel(family)}
                          </Badge>
                        </div>
                        <small className="project-muted">
                          {text.providerId}:{" "}
                          <code className="project-code provider-id-mask" tabIndex={0}>
                            <span aria-hidden="true" className="provider-id-mask-value">
                              *****
                            </span>
                            <span className="provider-id-actual">{provider.id}</span>
                          </code>
                        </small>
                      </div>
                    </div>
                    <div className="provider-card-status">
                      <span className="provider-status-dot" data-status={provider.status} />
                      {hasRegisteredKey ? (
                        <Badge
                          className="project-status-badge"
                          data-status={provider.status}
                          variant="outline"
                        >
                          {formatProviderStatus(provider.status)}
                        </Badge>
                      ) : (
                        <Badge className="project-status-badge" variant="outline">
                          {locale === "ko" ? "key 필요" : "key required"}
                        </Badge>
                      )}
                    </div>
                    <div className="provider-card-meta">
                      <span>{text.models}</span>
                      <strong>{modelCount}</strong>
                    </div>
                    <div className="provider-card-actions">
                      <button
                        aria-expanded={expanded}
                        aria-label={
                          expanded
                            ? locale === "ko"
                              ? "모델 목록 접기"
                              : "Collapse model list"
                            : locale === "ko"
                              ? "모델 목록 펼치기"
                              : "Expand model list"
                        }
                        className="provider-expand-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleProvider(provider.id);
                        }}
                        type="button"
                      >
                        <ChevronDown aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="provider-card-models">
                      {isEditing ? renderProviderInlineEditor(provider) : renderProviderModels(provider)}
                      {!isEditing ? (
                        <div className="provider-card-expanded-actions">
                          <Button
                            disabled={pendingAction || discoveringProvider !== null}
                            onClick={() => openEditModal(provider)}
                            type="button"
                            variant="outline"
                          >
                            <Pencil aria-hidden="true" />
                            {text.edit}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </section>
      {providerModal ? (
        <div
          className="modal-backdrop provider-registration-backdrop"
          onClick={closeRegistrationModal}
          role="presentation"
        >
          <section
            aria-modal="true"
            className="modal-panel provider-registration-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="panel-heading provider-registration-heading">
              <div>
                <h3>
                  {providerModal.mode === "create"
                    ? locale === "ko"
                      ? "Provider 등록"
                      : "Register provider"
                    : locale === "ko"
                      ? "API key 변경"
                      : "Change API key"}
                </h3>
                <p className="project-muted">{text.registerDescription}</p>
              </div>
              <button
                aria-label={locale === "ko" ? "닫기" : "Close"}
                className="icon-button"
                onClick={closeRegistrationModal}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            {submitState.message ? (
              <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
                <AlertDescription>{submitState.message}</AlertDescription>
              </Alert>
            ) : null}
            <div className="provider-form-grid provider-registration-form">
              {providerModal.mode === "create" ? (
                <>
                  <label className="policy-field">
                    <span>{text.provider}</span>
                    <select
                      onChange={(event) => applyProviderPresetToForm(event.target.value)}
                      value={formValues.presetProviderKey}
                    >
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
                      autoComplete="off"
                      maxLength={120}
                      onChange={(event) =>
                        setFormValues((current) => ({
                          ...current,
                          displayName: event.target.value
                        }))
                      }
                      value={formValues.displayName}
                    />
                  </label>
                </>
              ) : (
                <div className="policy-field">
                  <span>{text.provider}</span>
                  <div className="provider-readonly-summary">
                    <strong>{formValues.displayName || "-"}</strong>
                    <small className="project-muted">
                      {getProviderFamilyLabel(formValues.presetProviderKey)}
                    </small>
                  </div>
                </div>
              )}
              <label className="policy-field">
                <span>{text.credentialValue}</span>
                <input
                  autoComplete="off"
                  maxLength={8192}
                  onChange={(event) =>
                    setFormValues((current) => ({
                      ...current,
                      credentialValue: event.target.value
                    }))
                  }
                  placeholder={text.credentialValuePlaceholder}
                  type="password"
                  value={formValues.credentialValue}
                />
              </label>
            </div>
            <div className="provider-form-actions">
              <Button onClick={closeRegistrationModal} type="button" variant="outline">
                {locale === "ko" ? "취소" : "Cancel"}
              </Button>
              <Button
                disabled={
                  pendingAction ||
                  !formValues.provider.trim() ||
                  !formValues.displayName.trim() ||
                  !formValues.baseUrl.trim() ||
                  (formValues.credentialRequired && !formValues.credentialValue?.trim())
                }
                onClick={() => void submitProvider()}
                type="button"
              >
                {providerModal.mode === "create" ? (
                  <PlugZap aria-hidden="true" />
                ) : (
                  <KeyRound aria-hidden="true" />
                )}
                {providerModal.mode === "create" ? text.registerAction : text.apiKeyChange}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
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
    credentialValue: "",
    displayName: provider.displayName,
    failureMode: getProviderConfigFailureMode(providerConfig),
    models: getProviderConfigModels(provider.providerConfig)
      .filter(isChatCompletionModelName)
      .join(", "),
    modelsEndpointPath: getProviderConfigString(providerConfig, "modelsEndpointPath", "/models"),
    presetProviderKey: getProviderConnectionFamily(provider),
    provider: provider.provider,
    previousProvider: provider.provider,
    requestFormat: getProviderConfigRequestFormat(providerConfig, provider),
    resolver: provider.resolver,
    secretRef: "",
    status: provider.status,
    timeoutMs: provider.timeoutMs
  };
}

function getInitialModelOptions(providers: ProviderConnectionRecord[]) {
  return Object.fromEntries(
    providers.map((provider) => [
      provider.provider,
      getProviderConfigModels(provider.providerConfig).filter(isChatCompletionModelName)
    ])
  );
}

function getProviderPreset(providerFamily: string, presets: ProviderPresetRecord[]) {
  return presets.find((preset) => preset.providerKey === providerFamily) ?? null;
}

function getProviderFamilyLabel(providerFamily: string) {
  if (providerFamily === "openai") {
    return "OpenAI";
  }

  if (providerFamily === "gemini") {
    return "Gemini";
  }

  if (providerFamily === "claude") {
    return "Claude";
  }

  if (providerFamily === "mock") {
    return "Mock";
  }

  return providerFamily;
}

function getProviderFormValuesFromPreset(
  preset: ProviderPresetRecord | null,
  providers: ProviderConnectionRecord[]
): ProviderConnectionFormValues {
  if (!preset) {
    return emptyProviderForm;
  }

  const provider = getNextProviderConnectionKey(preset.providerKey, providers);

  return {
    ...emptyProviderForm,
    adapterType: preset.adapterType,
    apiVersion: getProviderConfigString(preset.providerConfig, "apiVersion", ""),
    baseUrl: preset.baseUrl,
    credentialRequired: preset.credentialRequired,
    displayName: getDefaultProviderDisplayName(preset, provider),
    models: "",
    modelsEndpointPath: preset.modelsEndpointPath,
    presetProviderKey: preset.providerKey,
    provider,
    requestFormat: getPresetRequestFormat(preset),
    resolver: preset.defaultResolver,
    timeoutMs: preset.defaultTimeoutMs
  };
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

function isDiscoverSupportedProvider(adapterType: string) {
  return adapterType === "openai_compatible" || adapterType === "anthropic" || adapterType === "mock";
}

function getProviderDiscoveryErrorMessage(
  error: string | undefined,
  provider: string,
  locale: Locale
) {
  const message = error ?? "Provider model discovery failed.";

  if (
    provider.includes("gemini") &&
    message.includes("Provider credential reference is not bound")
  ) {
    return locale === "ko"
      ? "Gemini 모델 조회에는 GEMINI_API_KEY와 credential_ref_gemini_main=GEMINI_API_KEY binding이 필요합니다."
      : "Gemini model discovery requires GEMINI_API_KEY and credential_ref_gemini_main=GEMINI_API_KEY binding.";
  }

  return message;
}

function canDeleteProvider(
  provider: ProviderConnectionRecord,
  source: ProviderConnectionsModel["source"]
) {
  return source === "control-plane" && provider.projectId === null;
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
  return getPreferredVisibleModels(models, providerFamily).length || providerModelPageSize;
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

function formatModelReleaseDate(
  modelName: string,
  releaseDatesByModel: Record<string, string | null> | undefined,
  locale: Locale
) {
  const releaseDate =
    releaseDatesByModel?.[modelName] ?? getKnownModelReleaseDate(modelName);

  if (!releaseDate) {
    return "-";
  }

  const date = new Date(releaseDate);

  if (Number.isNaN(date.getTime())) {
    return releaseDate;
  }

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  }).format(date);
}

function getKnownModelReleaseDate(modelName: string) {
  const normalizedModelName = normalizeDiscoveredModelName(modelName).toLowerCase();

  if (normalizedModelName === "gpt-4o-mini") {
    return "2024-07-18";
  }

  if (normalizedModelName === "gpt-4o") {
    return "2024-05-13";
  }

  if (
    normalizedModelName === "chat-latest" ||
    normalizedModelName === "chatgpt-4o-latest" ||
    normalizedModelName === "gpt-4o-latest"
  ) {
    return "2024-08-06";
  }

  return null;
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
      { matches: (model: string) => model === "gpt-4o-mini" },
      { matches: (model: string) => model === "gpt-4o" },
      { matches: (model: string) => isSameOrVariantModel(model, "gpt-5.5") }
    ];
  }

  return [];
}

function isSameOrVariantModel(model: string, target: string) {
  return model === target || model.startsWith(`${target}-`);
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
    normalizedModelName.startsWith("claude-") ||
    normalizedModelName.startsWith("gemini-") ||
    normalizedModelName.startsWith("chat-") ||
    normalizedModelName.startsWith("chatgpt-")
  );
}

function formatProviderStatus(status: ProviderConnectionStatus) {
  return status.toLowerCase();
}

function validateProviderForm(values: ProviderConnectionFormValues, locale: Locale) {
  if (!values.provider.trim() || !values.displayName.trim() || !values.baseUrl.trim()) {
    return locale === "ko"
      ? "Provider를 선택하고 Provider 이름을 입력하세요."
      : "Select a provider and enter a provider name.";
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

  if (requestFormat === "anthropic_messages") {
    return "anthropic_messages";
  }

  if (requestFormat === "openai_chat_completions") {
    return "openai_chat_completions";
  }

  if (provider.provider === "mock") {
    return "mock_chat_completions";
  }

  return getDefaultAdapterType(provider) === "anthropic"
    ? "anthropic_messages"
    : "openai_chat_completions";
}

function getDefaultAdapterType(provider: ProviderConnectionRecord) {
  if (provider.provider === "mock") {
    return "mock";
  }

  return provider.provider === "claude" ? "anthropic" : "openai_compatible";
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

  if (preset.adapterType === "anthropic") {
    return "anthropic_messages";
  }

  return preset.adapterType === "mock" ? "mock_chat_completions" : "openai_chat_completions";
}

function getProviderConfigModels(providerConfig: Record<string, unknown> | null) {
  const models = providerConfig?.models;

  return Array.isArray(models)
    ? models.filter(
        (model): model is string => typeof model === "string" && model.trim().length > 0
      ).map((model) => normalizeDiscoveredModelName(model))
    : [];
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
