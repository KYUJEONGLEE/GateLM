"use client";

import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  Code2,
  FileText,
  Languages,
  MessageSquareMore,
  RefreshCcw,
  Sparkles
} from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";

const tenantManagementSections = [
  { id: "budget", label: "예산" },
  { id: "routing", label: "라우팅" }
] as const;

const providerCatalog = [
  {
    displayName: "OpenAI",
    family: "openai",
    models: ["GPT-4o", "GPT-4o mini", "GPT-4.1"],
    provider: "openai"
  },
  {
    displayName: "Anthropic",
    family: "claude",
    models: ["Claude Opus", "Claude Sonnet", "Claude Haiku"],
    provider: "anthropic"
  },
  {
    displayName: "Google",
    family: "gemini",
    models: ["Gemini Pro", "Gemini Flash"],
    provider: "google"
  }
] satisfies ProviderCatalogEntry[];

const recommendedRoutingRows: RoutingCategoryRow[] = [
  {
    defaultRoute: { model: "GPT-4o", provider: "openai" },
    highQualityRoute: { model: "Claude Sonnet", provider: "anthropic" },
    icon: MessageSquareMore,
    id: "general-chat",
    label: "일반 채팅"
  },
  {
    defaultRoute: { model: "Claude Opus", provider: "anthropic" },
    highQualityRoute: { model: "GPT-4o", provider: "openai" },
    icon: Code2,
    id: "code-generation",
    label: "코드 생성"
  },
  {
    defaultRoute: { model: "Gemini Pro", provider: "google" },
    highQualityRoute: { model: "GPT-4o", provider: "openai" },
    icon: Languages,
    id: "translation",
    label: "번역"
  },
  {
    defaultRoute: { model: "Gemini Flash", provider: "google" },
    highQualityRoute: { model: "GPT-4o mini", provider: "openai" },
    icon: FileText,
    id: "summary-document",
    label: "요약 / 문서"
  },
  {
    defaultRoute: { model: "Claude Sonnet", provider: "anthropic" },
    highQualityRoute: { model: "Claude Opus", provider: "anthropic" },
    icon: BrainCircuit,
    id: "reasoning",
    label: "추론"
  }
];

const initialFallbackRoute: RoutingModelSelection = {
  model: "GPT-4o mini",
  provider: "openai"
};

const initialOffDefaultRoute: RoutingModelSelection = {
  model: "GPT-4o",
  provider: "openai"
};

const routingRouteKeys = ["defaultRoute", "highQualityRoute"] as const;
const recommendationHighlightDurationMs = 1600;
const saveConfirmationDurationMs = 1800;

type TenantManagementSection = (typeof tenantManagementSections)[number]["id"];
type RoutingRouteKey = "defaultRoute" | "highQualityRoute";

type ProviderCatalogEntry = {
  displayName: string;
  family: string;
  models: string[];
  provider: string;
};

type RoutingModelSelection = {
  model: string;
  provider: string;
};

type RoutingCategoryRow = {
  defaultRoute: RoutingModelSelection;
  highQualityRoute: RoutingModelSelection;
  icon: typeof MessageSquareMore;
  id: string;
  label: string;
};

type TenantRoutingSettings = {
  fallbackRoute: RoutingModelSelection;
  hasInitializedAutoRouting: boolean;
  isRoutingEnabled: boolean;
  offDefaultRoute: RoutingModelSelection;
  routingRows: RoutingCategoryRow[];
};

function getTenantManagementTabId(section: TenantManagementSection) {
  return `tenant-management-tab-${section}`;
}

function getTenantManagementPanelId(section: TenantManagementSection) {
  return `tenant-management-panel-${section}`;
}

function getProvider(provider: string) {
  return providerCatalog.find((entry) => entry.provider === provider) ?? providerCatalog[0];
}

function createRecommendedRoutingRows(): RoutingCategoryRow[] {
  return cloneRoutingRows(recommendedRoutingRows);
}

function cloneRoutingRows(rows: RoutingCategoryRow[]): RoutingCategoryRow[] {
  return rows.map((row) => ({
    ...row,
    defaultRoute: { ...row.defaultRoute },
    highQualityRoute: { ...row.highQualityRoute }
  }));
}

function createRoutingRowsFromDefault(
  defaultRoute: RoutingModelSelection
): RoutingCategoryRow[] {
  return recommendedRoutingRows.map((row) => ({
    ...row,
    defaultRoute: { ...defaultRoute },
    highQualityRoute: { ...defaultRoute }
  }));
}

function getRoutingRouteId(rowId: string, routeKey: RoutingRouteKey) {
  return `${rowId}:${routeKey}`;
}

function isSameRoutingSelection(
  current: RoutingModelSelection,
  next: RoutingModelSelection
) {
  return current.provider === next.provider && current.model === next.model;
}

function createInitialTenantRoutingSettings(): TenantRoutingSettings {
  return {
    fallbackRoute: { ...initialFallbackRoute },
    hasInitializedAutoRouting: false,
    isRoutingEnabled: false,
    offDefaultRoute: { ...initialOffDefaultRoute },
    routingRows: createRoutingRowsFromDefault(initialOffDefaultRoute)
  };
}

function cloneTenantRoutingSettings(settings: TenantRoutingSettings): TenantRoutingSettings {
  return {
    fallbackRoute: { ...settings.fallbackRoute },
    hasInitializedAutoRouting: settings.hasInitializedAutoRouting,
    isRoutingEnabled: settings.isRoutingEnabled,
    offDefaultRoute: { ...settings.offDefaultRoute },
    routingRows: cloneRoutingRows(settings.routingRows)
  };
}

export default function TenantsPage() {
  const [activeSection, setActiveSection] = useState<TenantManagementSection>("routing");
  const [savedRoutingSettings, setSavedRoutingSettings] = useState<TenantRoutingSettings>(
    createInitialTenantRoutingSettings
  );

  return (
    <main className="console-content management-line-content tenant-management-content">
      <header className="project-page-header">
        <h2>Tenant 관리</h2>
      </header>
      <div className="tenant-page-header-rule" aria-hidden="true" />
      <div className="policy-section-toolbar">
        <div
          className="policy-section-tabs tenant-management-tabs"
          aria-label="Tenant 관리 섹션"
          role="tablist"
        >
          {tenantManagementSections.map((section) => {
            const isActive = activeSection === section.id;

            return (
              <button
                aria-controls={getTenantManagementPanelId(section.id)}
                aria-selected={isActive}
                data-active={isActive}
                id={getTenantManagementTabId(section.id)}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                role="tab"
                type="button"
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        aria-labelledby={getTenantManagementTabId(activeSection)}
        className="policy-tab-panel"
        id={getTenantManagementPanelId(activeSection)}
        role="tabpanel"
        tabIndex={0}
      >
        {activeSection === "routing" ? (
          <TenantRoutingPanel
            initialSettings={savedRoutingSettings}
            onSave={(settings) => setSavedRoutingSettings(cloneTenantRoutingSettings(settings))}
          />
        ) : null}
      </div>
    </main>
  );
}

function TenantRoutingPanel({
  initialSettings,
  onSave
}: {
  initialSettings: TenantRoutingSettings;
  onSave: (settings: TenantRoutingSettings) => void;
}) {
  const hasInitializedAutoRouting = useRef(initialSettings.hasInitializedAutoRouting);
  const recommendationHighlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveConfirmationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fallbackRoute, setFallbackRoute] = useState<RoutingModelSelection>(() => ({
    ...initialSettings.fallbackRoute
  }));
  const [highlightedRouteIds, setHighlightedRouteIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [isRoutingEnabled, setIsRoutingEnabled] = useState(initialSettings.isRoutingEnabled);
  const [isSaveConfirmed, setIsSaveConfirmed] = useState(false);
  const [offDefaultRoute, setOffDefaultRoute] = useState<RoutingModelSelection>(() => ({
    ...initialSettings.offDefaultRoute
  }));
  const [routingRows, setRoutingRows] = useState<RoutingCategoryRow[]>(() =>
    cloneRoutingRows(initialSettings.routingRows)
  );
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(
    () => () => {
      if (recommendationHighlightTimeout.current) {
        clearTimeout(recommendationHighlightTimeout.current);
      }
      if (saveConfirmationTimeout.current) {
        clearTimeout(saveConfirmationTimeout.current);
      }
    },
    []
  );

  function clearRecommendationHighlight() {
    if (recommendationHighlightTimeout.current) {
      clearTimeout(recommendationHighlightTimeout.current);
      recommendationHighlightTimeout.current = null;
    }
    setHighlightedRouteIds(new Set());
  }

  function clearSaveConfirmation() {
    if (saveConfirmationTimeout.current) {
      clearTimeout(saveConfirmationTimeout.current);
      saveConfirmationTimeout.current = null;
    }
    setIsSaveConfirmed(false);
  }

  function saveRoutingSettings() {
    clearSaveConfirmation();
    onSave({
      fallbackRoute: { ...fallbackRoute },
      hasInitializedAutoRouting: hasInitializedAutoRouting.current,
      isRoutingEnabled,
      offDefaultRoute: { ...offDefaultRoute },
      routingRows: cloneRoutingRows(routingRows)
    });
    setStatusMessage("변경사항을 저장했습니다.");
    saveConfirmationTimeout.current = setTimeout(() => {
      setIsSaveConfirmed(true);
      saveConfirmationTimeout.current = setTimeout(() => {
        setIsSaveConfirmed(false);
        saveConfirmationTimeout.current = null;
      }, saveConfirmationDurationMs);
    }, 0);
  }

  function changeRoutingEnabled(checked: boolean) {
    clearRecommendationHighlight();
    clearSaveConfirmation();
    setIsRoutingEnabled(checked);

    if (checked && !hasInitializedAutoRouting.current) {
      setRoutingRows(createRoutingRowsFromDefault(offDefaultRoute));
      hasInitializedAutoRouting.current = true;
      setStatusMessage("OFF 기본 모델을 모든 카테고리와 난이도에 복사했습니다.");
      return;
    }

    setStatusMessage("");
  }

  function applyRecommendedRouting() {
    clearSaveConfirmation();
    const recommendedRows = createRecommendedRoutingRows();
    const routeIdsToHighlight = new Set<string>();
    let changedRouteCount = 0;

    for (const recommendedRow of recommendedRows) {
      const currentRow = routingRows.find((row) => row.id === recommendedRow.id);

      for (const routeKey of routingRouteKeys) {
        routeIdsToHighlight.add(getRoutingRouteId(recommendedRow.id, routeKey));
        if (
          !currentRow ||
          !isSameRoutingSelection(currentRow[routeKey], recommendedRow[routeKey])
        ) {
          changedRouteCount += 1;
        }
      }
    }

    clearRecommendationHighlight();
    setRoutingRows(recommendedRows);
    setHighlightedRouteIds(routeIdsToHighlight);

    if (changedRouteCount === 0) {
      setStatusMessage("추천 모델 설정을 다시 적용했습니다.");
    } else {
      setStatusMessage(`${changedRouteCount}개 모델 설정을 추천 모델로 변경했습니다.`);
    }

    recommendationHighlightTimeout.current = setTimeout(() => {
      setHighlightedRouteIds(new Set());
      recommendationHighlightTimeout.current = null;
    }, recommendationHighlightDurationMs);
  }

  function updateProvider(rowId: string, routeKey: RoutingRouteKey, provider: string) {
    const nextProvider = getProvider(provider);

    clearRecommendationHighlight();
    clearSaveConfirmation();
    setRoutingRows((currentRows) =>
      currentRows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [routeKey]: {
                model: nextProvider.models[0] ?? "",
                provider: nextProvider.provider
              }
            }
          : row
      )
    );
    setStatusMessage("");
  }

  function updateModel(rowId: string, routeKey: RoutingRouteKey, model: string) {
    clearRecommendationHighlight();
    clearSaveConfirmation();
    setRoutingRows((currentRows) =>
      currentRows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [routeKey]: {
                ...row[routeKey],
                model
              }
            }
          : row
      )
    );
    setStatusMessage("");
  }

  function updateFallbackProvider(provider: string) {
    const nextProvider = getProvider(provider);

    clearSaveConfirmation();
    setFallbackRoute({
      model: nextProvider.models[0] ?? "",
      provider: nextProvider.provider
    });
    setStatusMessage("");
  }

  function updateFallbackModel(model: string) {
    clearSaveConfirmation();
    setFallbackRoute((current) => ({ ...current, model }));
    setStatusMessage("");
  }

  function updateOffDefaultProvider(provider: string) {
    const nextProvider = getProvider(provider);

    clearSaveConfirmation();
    setOffDefaultRoute({
      model: nextProvider.models[0] ?? "",
      provider: nextProvider.provider
    });
    setStatusMessage("");
  }

  function updateOffDefaultModel(model: string) {
    clearSaveConfirmation();
    setOffDefaultRoute((current) => ({ ...current, model }));
    setStatusMessage("");
  }

  function resetRoutingSettings() {
    clearRecommendationHighlight();
    clearSaveConfirmation();

    if (isRoutingEnabled) {
      setRoutingRows(createRoutingRowsFromDefault(offDefaultRoute));
      setStatusMessage("모든 카테고리 모델을 OFF 기본 모델로 초기화했습니다.");
      return;
    }

    hasInitializedAutoRouting.current = false;
    setFallbackRoute({ ...initialFallbackRoute });
    setOffDefaultRoute({ ...initialOffDefaultRoute });
    setRoutingRows(createRoutingRowsFromDefault(initialOffDefaultRoute));
    setStatusMessage("라우팅 설정을 초기화했습니다.");
  }

  return (
    <form
      className="tenant-routing-panel"
      onSubmit={(event) => {
        event.preventDefault();
        saveRoutingSettings();
      }}
    >
      <section className="tenant-routing-enable-card" aria-labelledby="tenant-auto-routing-title">
        <div>
          <h3 id="tenant-auto-routing-title">Auto routing</h3>
          <p>Rule base로 요청 카테고리를 판별해 지정 모델로 라우팅합니다.</p>
        </div>
        <div className="tenant-routing-switch-control">
          <Switch
            aria-label="Auto routing"
            checked={isRoutingEnabled}
            className="tenant-routing-switch"
            onCheckedChange={changeRoutingEnabled}
          />
          <span>{isRoutingEnabled ? "ON" : "OFF"}</span>
        </div>
      </section>

      {isRoutingEnabled ? (
        <section className="tenant-routing-model-card" aria-labelledby="tenant-routing-model-title">
          <header className="tenant-routing-model-heading">
            <div className="tenant-routing-model-heading-copy">
              <h3 id="tenant-routing-model-title">카테고리별 모델 설정</h3>
              <p>각 카테고리에 사용할 기본 모델과 고성능 모델을 선택하세요.</p>
            </div>
            <button
              className="secondary-button tenant-routing-recommend-button"
              onClick={applyRecommendedRouting}
              type="button"
            >
              <Sparkles aria-hidden="true" />
              추천 모델 자동 설정
            </button>
          </header>

          <div className="tenant-routing-table" role="table" aria-label="카테고리별 모델 설정">
            <div className="tenant-routing-table-head" role="row">
              <span role="columnheader">카테고리</span>
              <span role="columnheader">기본 모델</span>
              <span role="columnheader">고성능 모델</span>
            </div>
            {routingRows.map((row) => {
              const CategoryIcon = row.icon;

              return (
                <div className="tenant-routing-table-row" key={row.id} role="row">
                  <div className="tenant-routing-category" role="rowheader">
                    <CategoryIcon aria-hidden="true" />
                    <span>{row.label}</span>
                  </div>
                  <RoutingModelControls
                    categoryLabel={row.label}
                    disabled={false}
                    highlighted={highlightedRouteIds.has(
                      getRoutingRouteId(row.id, "defaultRoute")
                    )}
                    label="기본 모델"
                    onModelChange={(model) => updateModel(row.id, "defaultRoute", model)}
                    onProviderChange={(provider) =>
                      updateProvider(row.id, "defaultRoute", provider)
                    }
                    selection={row.defaultRoute}
                  />
                  <RoutingModelControls
                    categoryLabel={row.label}
                    disabled={false}
                    highlighted={highlightedRouteIds.has(
                      getRoutingRouteId(row.id, "highQualityRoute")
                    )}
                    label="고성능 모델"
                    onModelChange={(model) => updateModel(row.id, "highQualityRoute", model)}
                    onProviderChange={(provider) =>
                      updateProvider(row.id, "highQualityRoute", provider)
                    }
                    selection={row.highQualityRoute}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section
          className="tenant-routing-off-default-card"
          aria-labelledby="tenant-routing-off-default-title"
        >
          <header className="tenant-routing-off-default-heading">
            <h3 id="tenant-routing-off-default-title">Auto routing OFF 시 기본 모델</h3>
            <p>카테고리를 분류하지 않고 모든 요청을 이 모델로 전달합니다.</p>
          </header>
          <StandaloneModelControls
            disabled={false}
            groupLabel="Auto routing OFF 시 기본 모델 설정 컨트롤"
            modelAriaLabel="Auto routing OFF 기본 모델 선택"
            onModelChange={updateOffDefaultModel}
            onProviderChange={updateOffDefaultProvider}
            providerAriaLabel="Auto routing OFF 기본 Provider"
            selection={offDefaultRoute}
          />
        </section>
      )}

      <div className="tenant-routing-actions">
        <button
          className="secondary-button tenant-routing-reset-button"
          onClick={resetRoutingSettings}
          type="button"
        >
          초기화
        </button>
        <button
          className="primary-button tenant-routing-save-button"
          data-save-confirmed={isSaveConfirmed ? "true" : undefined}
          type="submit"
        >
          {isSaveConfirmed ? <Check aria-hidden="true" /> : null}
          {isSaveConfirmed ? "저장됨" : "변경사항 저장"}
        </button>
      </div>

      <div className="tenant-routing-section-divider" aria-hidden="true" />

      <section
        className="tenant-routing-fallback-card"
        aria-labelledby="tenant-routing-fallback-title"
      >
        <header className="tenant-routing-fallback-heading">
          <span className="tenant-routing-fallback-kicker">
            <RefreshCcw aria-hidden="true" />
            장애 시 자동 전환
          </span>
          <h3 id="tenant-routing-fallback-title">Fallback 모델 설정</h3>
          <p>기본 모델과 고성능 모델을 사용할 수 없을 때 호출할 대체 모델입니다.</p>
        </header>
        <StandaloneModelControls
          disabled={false}
          groupLabel="Fallback 모델 설정 컨트롤"
          modelAriaLabel="Fallback 모델 선택"
          onModelChange={updateFallbackModel}
          onProviderChange={updateFallbackProvider}
          providerAriaLabel="Fallback Provider"
          selection={fallbackRoute}
        />
      </section>

      <p className="sr-only" aria-atomic="true" aria-live="polite" role="status">
        {statusMessage}
      </p>
    </form>
  );
}

function RoutingModelControls({
  categoryLabel,
  disabled,
  highlighted,
  label,
  onModelChange,
  onProviderChange,
  selection
}: {
  categoryLabel: string;
  disabled: boolean;
  highlighted: boolean;
  label: string;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  selection: RoutingModelSelection;
}) {
  const selectedProvider = getProvider(selection.provider);

  return (
    <div
      className="tenant-routing-route"
      data-column-label={label}
      data-recommendation-highlighted={highlighted ? "true" : undefined}
      role="cell"
    >
      <div className="tenant-routing-model-selectors">
        <label className="tenant-routing-provider-control">
          <span className="sr-only">
            {categoryLabel} {label} 제공자
          </span>
          <ProviderFamilyIcon
            className="tenant-routing-provider-icon"
            family={selectedProvider.family}
            size={22}
          />
          <select
            aria-label={`${categoryLabel} ${label} 제공자`}
            disabled={disabled}
            onChange={(event) => onProviderChange(event.target.value)}
            value={selection.provider}
          >
            {providerCatalog.map((provider) => (
              <option key={provider.provider} value={provider.provider}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="tenant-routing-model-control">
          <span className="sr-only">
            {categoryLabel} {label} 모델
          </span>
          <select
            aria-label={`${categoryLabel} ${label} 모델`}
            disabled={disabled}
            onChange={(event) => onModelChange(event.target.value)}
            value={selection.model}
          >
            {selectedProvider.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function StandaloneModelControls({
  disabled,
  groupLabel,
  modelAriaLabel,
  onModelChange,
  onProviderChange,
  providerAriaLabel,
  selection
}: {
  disabled: boolean;
  groupLabel: string;
  modelAriaLabel: string;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  providerAriaLabel: string;
  selection: RoutingModelSelection;
}) {
  const selectedProvider = getProvider(selection.provider);

  return (
    <div
      className="tenant-routing-standalone-controls"
      role="group"
      aria-label={groupLabel}
    >
      <label className="tenant-routing-standalone-field">
        <span>Provider</span>
        <span className="tenant-routing-provider-control">
          <ProviderFamilyIcon
            className="tenant-routing-provider-icon"
            family={selectedProvider.family}
            size={22}
          />
          <select
            aria-label={providerAriaLabel}
            disabled={disabled}
            onChange={(event) => onProviderChange(event.target.value)}
            value={selection.provider}
          >
            {providerCatalog.map((provider) => (
              <option key={provider.provider} value={provider.provider}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className="tenant-routing-standalone-field">
        <span>모델</span>
        <span className="tenant-routing-model-control">
          <select
            aria-label={modelAriaLabel}
            disabled={disabled}
            onChange={(event) => onModelChange(event.target.value)}
            value={selection.model}
          >
            {selectedProvider.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </span>
      </label>
    </div>
  );
}
