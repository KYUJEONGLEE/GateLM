"use client";

import { useState } from "react";
import { Code2, FileText, MessageSquareMore, RefreshCcw, Search } from "lucide-react";

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

const initialRoutingRows: RoutingCategoryRow[] = [
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
    icon: Search,
    id: "search-rag",
    label: "검색 / RAG"
  },
  {
    defaultRoute: { model: "Gemini Flash", provider: "google" },
    highQualityRoute: { model: "GPT-4o mini", provider: "openai" },
    icon: FileText,
    id: "summary-document",
    label: "요약 / 문서"
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

function getTenantManagementTabId(section: TenantManagementSection) {
  return `tenant-management-tab-${section}`;
}

function getTenantManagementPanelId(section: TenantManagementSection) {
  return `tenant-management-panel-${section}`;
}

function getProvider(provider: string) {
  return providerCatalog.find((entry) => entry.provider === provider) ?? providerCatalog[0];
}

export default function TenantsPage() {
  const [activeSection, setActiveSection] = useState<TenantManagementSection>("budget");

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
        {activeSection === "routing" ? <TenantRoutingPanel /> : null}
      </div>
    </main>
  );
}

function TenantRoutingPanel() {
  const [fallbackRoute, setFallbackRoute] = useState(initialFallbackRoute);
  const [isRoutingEnabled, setIsRoutingEnabled] = useState(true);
  const [offDefaultRoute, setOffDefaultRoute] = useState(initialOffDefaultRoute);
  const [routingRows, setRoutingRows] = useState(initialRoutingRows);
  const [statusMessage, setStatusMessage] = useState("");

  function updateProvider(rowId: string, routeKey: RoutingRouteKey, provider: string) {
    const nextProvider = getProvider(provider);

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

    setFallbackRoute({
      model: nextProvider.models[0] ?? "",
      provider: nextProvider.provider
    });
    setStatusMessage("");
  }

  function updateFallbackModel(model: string) {
    setFallbackRoute((current) => ({ ...current, model }));
    setStatusMessage("");
  }

  function updateOffDefaultProvider(provider: string) {
    const nextProvider = getProvider(provider);

    setOffDefaultRoute({
      model: nextProvider.models[0] ?? "",
      provider: nextProvider.provider
    });
    setStatusMessage("");
  }

  function updateOffDefaultModel(model: string) {
    setOffDefaultRoute((current) => ({ ...current, model }));
    setStatusMessage("");
  }

  function resetRoutingSettings() {
    setFallbackRoute(initialFallbackRoute);
    setIsRoutingEnabled(true);
    setOffDefaultRoute(initialOffDefaultRoute);
    setRoutingRows(initialRoutingRows);
    setStatusMessage("라우팅 설정을 초기화했습니다.");
  }

  return (
    <form
      className="tenant-routing-panel"
      onSubmit={(event) => {
        event.preventDefault();
        setStatusMessage("변경사항을 현재 화면에 저장했습니다.");
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
            onCheckedChange={(checked) => {
              setIsRoutingEnabled(checked);
              setStatusMessage("");
            }}
          />
          <span>{isRoutingEnabled ? "ON" : "OFF"}</span>
        </div>
      </section>

      {isRoutingEnabled ? (
        <section className="tenant-routing-model-card" aria-labelledby="tenant-routing-model-title">
          <header className="tenant-routing-model-heading">
            <h3 id="tenant-routing-model-title">카테고리별 모델 설정</h3>
            <p>각 카테고리에 사용할 기본 모델과 고성능 모델을 선택하세요.</p>
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
        <button className="primary-button tenant-routing-save-button" type="submit">
          변경사항 저장
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

      <p className="sr-only" aria-live="polite">
        {statusMessage}
      </p>
    </form>
  );
}

function RoutingModelControls({
  categoryLabel,
  disabled,
  label,
  onModelChange,
  onProviderChange,
  selection
}: {
  categoryLabel: string;
  disabled: boolean;
  label: string;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  selection: RoutingModelSelection;
}) {
  const selectedProvider = getProvider(selection.provider);

  return (
    <div className="tenant-routing-route" data-column-label={label} role="cell">
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
