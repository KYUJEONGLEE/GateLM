"use client";

import { KeyRound, PlugZap, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

type ProviderDiscoveryPreview = {
  chatModels: string[];
  discoveredAt: string;
  selectedModels: string[];
  skippedModelCount: number;
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
  providerKey: string;
  preset: ProviderPresetRecord | null;
};

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
  credentialValue: "",
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
    deleteProvider: string;
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
    apiVersion: "API version",
    baseUrl: "Base URL",
    created: "Created",
    credential: "Credential preview",
    credentialRequired: "Credential required",
    credentialLast4: "Credential last 4",
    credentialPrefix: "Credential prefix",
    credentialValue: "API key registration",
    credentialValuePlaceholder: "Paste provider API key",
    displayName: "Display name",
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
    apiVersion: "API version",
    baseUrl: "Base URL",
    created: "생성",
    credential: "Credential preview",
    credentialRequired: "Credential required",
    credentialLast4: "Credential last 4",
    credentialPrefix: "Credential prefix",
    credentialValue: "API key 등록",
    credentialValuePlaceholder: "Provider API key 입력",
    displayName: "표시 이름",
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
  const [pendingAction, setPendingAction] = useState(false);
  const [discoveringProvider, setDiscoveringProvider] = useState<string | null>(null);
  const [registrationProviderKey, setRegistrationProviderKey] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const providerRows = getProviderRows(providers, model.providerPresets.items);
  async function submitProvider() {
    const validationError = validateProviderForm(formValues, locale);

    if (validationError) {
      setSubmitState({ message: validationError, status: "error" });
      return;
    }

    const registeringProvider = providers.find(
      (provider) => provider.provider === formValues.provider.trim()
    );
    const requiresCredential = formValues.credentialRequired && !hasProviderKeyRegistered(registeringProvider);

    if (requiresCredential && !formValues.credentialValue?.trim()) {
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
      ...current.filter((provider) => provider.provider !== savedProvider.provider),
      savedProvider
    ]);
    setModelOptionsByProvider((current) => ({
      ...current,
      [savedProvider.provider]: current[savedProvider.provider]?.length
        ? current[savedProvider.provider]
        : getProviderConfigModels(savedProvider.providerConfig).filter(isChatCompletionModelName)
    }));
    setFormValues({
      ...getProviderFormValues(savedProvider),
      credentialValue: ""
    });
    setRegistrationProviderKey(null);
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
    const chatModels = filterChatCompletionModels(discoveredModels);
    const existingSelectedModels = splitModelNames(baseValues.models).filter((modelName) =>
      chatModels.includes(modelName)
    );
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
        selectedModels: existingSelectedModels,
        skippedModelCount
      }
    }));
    if (applyToForm) {
      setFormValues((current) => {
        return {
          ...baseValues,
          adapterType: payload.discovery?.adapterType ?? current.adapterType,
          baseUrl: payload.discovery?.baseUrl ?? current.baseUrl,
          credentialRequired: payload.discovery?.credentialRequired ?? current.credentialRequired,
          models: existingSelectedModels.join(", "),
          provider: normalizedProvider
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

  async function applyDiscoveredModelsToProvider(provider: ProviderConnectionRecord) {
    const discovery = discoveryByProvider[provider.provider];

    if (!discovery) {
      return;
    }

    const values = {
      ...getProviderFormValues(provider),
      isEdit: true,
      models: discovery.selectedModels.join(", ")
    };

    setPendingAction(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/provider-connections", {
      body: JSON.stringify({
        action: "upsert",
        values
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProviderResponsePayload;

    if (!response.ok || !payload.provider) {
      setSubmitState({
        message: payload.error ?? "Provider update failed.",
        status: "error"
      });
      setPendingAction(false);
      return;
    }

    const savedProvider = payload.provider;

    setProviders((current) => [
      ...current.filter((item) => item.provider !== savedProvider.provider),
      savedProvider
    ]);
    setModelOptionsByProvider((current) => ({
      ...current,
      [savedProvider.provider]: discovery.chatModels
    }));
    setDiscoveryByProvider((current) => {
      const next = { ...current };
      delete next[savedProvider.provider];
      return next;
    });
    if (formValues.provider === savedProvider.provider) {
      setFormValues(getProviderFormValues(savedProvider));
    }
    setSubmitState({
      message:
        locale === "ko"
          ? `${savedProvider.provider} 모델 목록을 저장했습니다.`
          : `Saved discovered models for ${savedProvider.provider}.`,
      status: "success"
    });
    setPendingAction(false);
    router.refresh();
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
      apiVersion: getProviderConfigString(preset.providerConfig, "apiVersion", ""),
      baseUrl: preset.baseUrl,
      credentialRequired: preset.credentialRequired,
      displayName: preset.displayName,
      models: "",
      modelsEndpointPath: preset.modelsEndpointPath,
      provider: preset.providerKey,
      requestFormat: getPresetRequestFormat(preset),
      resolver: preset.defaultResolver,
      timeoutMs: preset.defaultTimeoutMs
    });
    setSubmitState({ message: "", status: "idle" });
  }

  function openRegistrationModal(providerKey: string) {
    const savedProvider = providers.find((provider) => provider.provider === providerKey);

    setRegistrationProviderKey(providerKey);
    if (savedProvider) {
      const preset = model.providerPresets.items.find((item) => item.providerKey === providerKey) ?? null;
      const values = getProviderFormValues(savedProvider);

      setModelOptionsByProvider((current) => ({
        ...current,
        [savedProvider.provider]: current[savedProvider.provider]?.length
          ? current[savedProvider.provider]
          : getProviderConfigModels(savedProvider.providerConfig).filter(isChatCompletionModelName)
      }));
      setFormValues({
        ...values,
        models: splitModelNames(values.models).length > 0
          ? splitModelNames(values.models).join(", ")
          : getPresetModelOptions(preset).join(", ")
      });
      setSubmitState({ message: "", status: "idle" });
      return;
    }

    applyProviderPreset(providerKey);
  }

  function closeRegistrationModal() {
    setRegistrationProviderKey(null);
    setFormValues(emptyProviderForm);
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
      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="console-panel provider-line-panel">
        <div className="panel-heading">
          <h3>{text.title}</h3>
        </div>
        {providerRows.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table provider-table">
              <thead>
                <tr>
                  <th>{text.provider}</th>
                  <th>{text.status}</th>
                  <th>{text.updated}</th>
                  <th>{text.providerId}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {providerRows.map((row) => {
                  const provider = row.connection;
                  const discovery = discoveryByProvider[row.providerKey];
                  const hasRegisteredKey = hasProviderKeyRegistered(provider);

                  return (
                    <Fragment key={provider?.id ?? row.providerKey}>
                      <tr>
                        <td>
                          <strong className="provider-name">{row.displayName}</strong>
                          <span className="project-muted">{row.providerKey}</span>
                          <small className="project-muted">
                            {text.models}:{" "}
                            {provider
                              ? formatProviderModels(provider.providerConfig)
                              : formatPresetModels(row.preset)}
                          </small>
                        </td>
                        <td>
                          {provider && hasRegisteredKey ? (
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
                        </td>
                        <td>
                          {provider ? (
                            <>
                              <span className="project-muted">{formatDateTime(provider.updatedAt)}</span>
                              <small className="project-muted">
                                {text.created}: {formatDateTime(provider.createdAt)}
                              </small>
                            </>
                          ) : (
                            <span className="project-muted">-</span>
                          )}
                        </td>
                        <td>
                          {provider ? (
                            <code className="project-code provider-id-mask" tabIndex={0}>
                              <span aria-hidden="true" className="provider-id-mask-value">
                                *****
                              </span>
                              <span className="provider-id-actual">{provider.id}</span>
                            </code>
                          ) : (
                            <span className="project-muted">-</span>
                          )}
                        </td>
                        <td>
                          <div className="project-row-actions">
                            {!provider || !hasRegisteredKey ? (
                              <Button
                                disabled={pendingAction || discoveringProvider !== null}
                                onClick={() => openRegistrationModal(row.providerKey)}
                                type="button"
                              >
                                <KeyRound aria-hidden="true" />
                                {text.registerAction}
                              </Button>
                            ) : (
                              <>
                                <Button
                                  disabled={
                                    pendingAction ||
                                    discoveringProvider !== null ||
                                    !isDiscoverSupportedProvider(
                                      getProviderFormValues(provider).adapterType
                                    )
                                  }
                                  onClick={() =>
                                    void discoverModels(provider.provider, { applyToForm: false })
                                  }
                                  type="button"
                                  variant="outline"
                                >
                                  {discoveringProvider === provider.provider
                                    ? "..."
                                    : text.discoverModels}
                                </Button>
                                <Button
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
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {discovery ? (
                        <tr
                          key={`${provider?.id ?? row.providerKey}-discovery`}
                          className="provider-discovery-row"
                        >
                          <td colSpan={5}>
                            <div className="provider-discovery-panel">
                              <div className="provider-model-selection-toolbar">
                                <strong>
                                  {locale === "ko"
                                    ? `${discovery.selectedModels.length} / ${discovery.chatModels.length}개 선택`
                                    : `${discovery.selectedModels.length} / ${discovery.chatModels.length} selected`}
                                </strong>
                                <span className="project-muted">
                                  {locale === "ko"
                                    ? `제외된 비채팅 모델 ${discovery.skippedModelCount}개 · ${formatDateTime(discovery.discoveredAt)}`
                                    : `${discovery.skippedModelCount} non-chat models excluded · ${formatDateTime(discovery.discoveredAt)}`}
                                </span>
                                <div>
                                  <button
                                    onClick={() => setAllDiscoveredModels(row.providerKey, true)}
                                    type="button"
                                  >
                                    {locale === "ko" ? "전체 선택" : "Select all"}
                                  </button>
                                  <button
                                    onClick={() => setAllDiscoveredModels(row.providerKey, false)}
                                    type="button"
                                  >
                                    {locale === "ko" ? "전체 해제" : "Clear"}
                                  </button>
                                </div>
                              </div>
                              <div className="provider-discovery-model-list">
                                {discovery.chatModels.length > 0 ? (
                                  discovery.chatModels.map((modelName) => (
                                    <label key={modelName} className="provider-model-checkbox">
                                      <input
                                        checked={discovery.selectedModels.includes(modelName)}
                                        onChange={(event) =>
                                          toggleDiscoveredModel(
                                            row.providerKey,
                                            modelName,
                                            event.target.checked
                                          )
                                        }
                                        type="checkbox"
                                      />
                                      <span>{modelName}</span>
                                    </label>
                                  ))
                                ) : (
                                  <span className="project-muted">
                                    {locale === "ko"
                                      ? "반영 가능한 chat 모델이 없습니다."
                                      : "No chat models available to apply."}
                                  </span>
                                )}
                              </div>
                              <div className="provider-discovery-actions">
                                <Button
                                  disabled={pendingAction || discovery.selectedModels.length === 0}
                                  onClick={() =>
                                    provider
                                      ? void applyDiscoveredModelsToProvider(provider)
                                      : undefined
                                  }
                                  type="button"
                                >
                                  {locale === "ko"
                                    ? "선택 모델 저장"
                                    : "Save selected models"}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {registrationProviderKey ? (
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
                  {locale === "ko" ? "Provider Key 등록" : "Register Provider Key"}
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
            <div className="provider-form-grid provider-registration-form">
              <div className="policy-field">
                <span>{text.provider}</span>
                <div className="provider-readonly-summary">
                  <strong>{formValues.provider || "-"}</strong>
                  <small className="project-muted">{formValues.displayName || "-"}</small>
                </div>
              </div>
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
                <PlugZap aria-hidden="true" />
                {locale === "ko" ? "등록" : "Register"}
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
    provider: provider.provider,
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

function getProviderRows(
  providers: ProviderConnectionRecord[],
  presets: ProviderPresetRecord[]
): ProviderDisplayRow[] {
  const providerMap = new Map(providers.map((provider) => [provider.provider, provider]));
  const rows = presets.map((preset) => ({
    connection: providerMap.get(preset.providerKey) ?? null,
    displayName: providerMap.get(preset.providerKey)?.displayName ?? preset.displayName,
    providerKey: preset.providerKey,
    preset
  }));
  const presetKeys = new Set(presets.map((preset) => preset.providerKey));
  const extraRows = providers
    .filter((provider) => !presetKeys.has(provider.provider))
    .map((provider) => ({
      connection: provider,
      displayName: provider.displayName,
      providerKey: provider.provider,
      preset: null
    }));

  return [...rows, ...extraRows];
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

function getPresetModelOptions(preset: ProviderPresetRecord | null) {
  if (!preset) {
    return [];
  }

  const configuredModels = getProviderConfigModels(preset.providerConfig).filter(
    isChatCompletionModelName
  );

  if (configuredModels.length > 0) {
    return configuredModels;
  }

  if (preset.providerKey === "openai") {
    return ["gpt-4o-mini", "gpt-4o"];
  }

  if (preset.providerKey === "gemini") {
    return ["gemini-1.5-flash", "gemini-1.5-pro"];
  }

  if (preset.providerKey === "claude") {
    return ["claude-3.5-sonnet", "claude-3-haiku"];
  }

  return [];
}

function formatPresetModels(preset: ProviderPresetRecord | null) {
  const models = getPresetModelOptions(preset);

  return models.length > 0 ? models.join(", ") : "none";
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

function formatProviderModels(providerConfig: Record<string, unknown> | null) {
  const models = getProviderConfigModels(providerConfig);

  return models.length > 0 ? models.join(", ") : "none";
}
