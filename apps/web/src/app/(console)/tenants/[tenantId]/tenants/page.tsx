"use client";

import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  Code2,
  FileText,
  Languages,
  MessageSquareMore,
} from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import {
  LOCALE_COOKIE_NAME,
  normalizeLocale,
  type Locale
} from "@/lib/i18n/locale";

const tenantManagementSections = [
  { id: "routing", label: "Routing policy" },
  { id: "budget", label: "Budget policy" }
] as const;

const routingCategories = [
  { icon: MessageSquareMore, id: "general", label: "General" },
  { icon: Code2, id: "code", label: "Code" },
  { icon: Languages, id: "translation", label: "Translation" },
  { icon: FileText, id: "summarization", label: "Summarization" },
  { icon: BrainCircuit, id: "reasoning", label: "Reasoning" }
] as const;

const routingDifficulties = [
  { id: "simple", label: "Simple" },
  { id: "complex", label: "Complex" }
] as const;

const tenantManagementText = {
  en: {
    auto: "Auto",
    autoDescription:
      "Classifies each request by workload and complexity, then applies the approved route before provider execution.",
    autoEnabledMessage: "Auto routing enabled. The saved routing matrix is active.",
    autoRouting: "Auto routing",
    budget: "Budget",
    budgetDescription: "Tenant budget settings are managed separately from routing.",
    category: "Category",
    categories: {
      code: "Code",
      general: "General",
      reasoning: "Reasoning",
      summarization: "Summarization",
      translation: "Translation"
    },
    complex: "Complex",
    companyDefaultModel: "Company default model",
    companyDefaultOnly:
      "The organization-wide baseline for workloads without an explicit override. All current routes inherit this model.",
    companyOverridesActive:
      "Explicit workload routes are active. Requests without an override continue to inherit the company default.",
    fallbackDescription:
      "The standby model used automatically when the primary routing model is unavailable or cannot complete a request.",
    fallbackModel: "Fallback model",
    fallbackTitle: "Fallback model settings",
    manual: "Manual",
    manualEnabledMessage: "Manual mode selected. The Auto routing matrix is preserved.",
    matrix: "Workload routing policy",
    matrixDescription:
      "Assign approved models by workload and complexity. Explicit assignments override the company default; unclassified requests use General.",
    reset: "Reset",
    resetMessage: "Routing settings reset to the company default model.",
    saved: "Saved",
    savedMessage: "Routing settings saved.",
    save: "Save changes",
    sections: { budget: "Budget policy", routing: "Routing policy" },
    sectionLabel: "Company policy sections",
    simple: "Simple",
    title: "Tenant"
  },
  ko: {
    auto: "자동",
    autoDescription:
      "요청을 업무 유형과 복잡도로 분류하고, Provider 호출 전에 승인된 라우팅 정책을 적용합니다.",
    autoEnabledMessage: "자동 라우팅이 활성화되었습니다. 저장된 라우팅 정책이 적용됩니다.",
    autoRouting: "자동 라우팅",
    budget: "예산",
    budgetDescription: "테넌트 예산 설정은 라우팅과 별도로 관리됩니다.",
    category: "카테고리",
    categories: {
      code: "코드",
      general: "일반",
      reasoning: "추론",
      summarization: "요약",
      translation: "번역"
    },
    complex: "복합",
    companyDefaultModel: "회사 기본 모델",
    companyDefaultOnly:
      "별도 정책이 없는 업무에 적용되는 전사 기준 모델입니다. 현재 모든 라우팅이 이 모델을 상속합니다.",
    companyOverridesActive:
      "업무별 라우팅 정책이 적용 중입니다. 별도 지정이 없는 요청은 회사 기본 모델을 상속합니다.",
    fallbackDescription:
      "기본 라우팅 모델을 사용할 수 없거나 요청을 완료하지 못할 때 자동으로 전환되는 예비 모델입니다.",
    fallbackModel: "Fallback 모델",
    fallbackTitle: "Fallback 모델 설정",
    manual: "수동",
    manualEnabledMessage: "수동 모드가 선택되었습니다. 자동 라우팅 정책은 유지됩니다.",
    matrix: "업무 유형별 라우팅 정책",
    matrixDescription:
      "업무 유형과 복잡도별 승인 모델을 지정합니다. 개별 설정은 회사 기본 모델보다 우선하며, 분류되지 않은 요청은 일반 정책을 사용합니다.",
    reset: "초기화",
    resetMessage: "라우팅 설정을 회사 기본 모델로 초기화했습니다.",
    saved: "저장됨",
    savedMessage: "라우팅 설정을 저장했습니다.",
    save: "변경사항 저장",
    sections: { budget: "예산 정책", routing: "라우팅 정책" },
    sectionLabel: "회사 정책 섹션",
    simple: "단순",
    title: "회사 정책"
  }
} as const;

const tenantRoutingModelOptions = [
  {
    family: "claude",
    modelName: "Claude",
    modelRef: "anthropic:claude-sonnet",
    providerName: "Anthropic"
  },
  {
    family: "claude",
    modelName: "Claude Haiku",
    modelRef: "anthropic:claude-haiku",
    providerName: "Anthropic"
  },
  {
    family: "openai",
    modelName: "GPT 4o-mini",
    modelRef: "openai:gpt-4o-mini",
    providerName: "OpenAI"
  },
  {
    family: "openai",
    modelName: "GPT 4o",
    modelRef: "openai:gpt-4o",
    providerName: "OpenAI"
  },
  {
    family: "gemini",
    modelName: "Gemini Pro",
    modelRef: "google:gemini-pro",
    providerName: "Google Gemini"
  },
  {
    family: "gemini",
    modelName: "Gemini Flash",
    modelRef: "google:gemini-flash",
    providerName: "Google Gemini"
  }
] as const;

const companyDefaultModelRef = "anthropic:claude-sonnet";
const initialFallbackModelRef = "anthropic:claude-haiku";
const saveConfirmationDurationMs = 1800;

type TenantManagementSection = (typeof tenantManagementSections)[number]["id"];
type RoutingCategory = (typeof routingCategories)[number]["id"];
type RoutingDifficulty = (typeof routingDifficulties)[number]["id"];
type RoutingMode = "auto" | "manual";
type RoutingCell = { modelRefs: string[] };
type RoutingMatrix = Record<RoutingCategory, Record<RoutingDifficulty, RoutingCell>>;

type TenantRoutingSettings = {
  companyDefaultModelRef: string;
  fallbackModelRef: string;
  mode: RoutingMode;
  routes: RoutingMatrix;
};

function getTenantManagementTabId(section: TenantManagementSection) {
  return `tenant-management-tab-${section}`;
}

function getTenantManagementPanelId(section: TenantManagementSection) {
  return `tenant-management-panel-${section}`;
}

function createCompanyDefaultCell(): RoutingCell {
  return { modelRefs: [companyDefaultModelRef] };
}

function createCompanyDefaultMatrix(): RoutingMatrix {
  return {
    code: {
      complex: createCompanyDefaultCell(),
      simple: createCompanyDefaultCell()
    },
    general: {
      complex: createCompanyDefaultCell(),
      simple: createCompanyDefaultCell()
    },
    reasoning: {
      complex: createCompanyDefaultCell(),
      simple: createCompanyDefaultCell()
    },
    summarization: {
      complex: createCompanyDefaultCell(),
      simple: createCompanyDefaultCell()
    },
    translation: {
      complex: createCompanyDefaultCell(),
      simple: createCompanyDefaultCell()
    }
  };
}

function cloneRoutingMatrix(matrix: RoutingMatrix): RoutingMatrix {
  return {
    code: {
      complex: { modelRefs: [...matrix.code.complex.modelRefs] },
      simple: { modelRefs: [...matrix.code.simple.modelRefs] }
    },
    general: {
      complex: { modelRefs: [...matrix.general.complex.modelRefs] },
      simple: { modelRefs: [...matrix.general.simple.modelRefs] }
    },
    reasoning: {
      complex: { modelRefs: [...matrix.reasoning.complex.modelRefs] },
      simple: { modelRefs: [...matrix.reasoning.simple.modelRefs] }
    },
    summarization: {
      complex: { modelRefs: [...matrix.summarization.complex.modelRefs] },
      simple: { modelRefs: [...matrix.summarization.simple.modelRefs] }
    },
    translation: {
      complex: { modelRefs: [...matrix.translation.complex.modelRefs] },
      simple: { modelRefs: [...matrix.translation.simple.modelRefs] }
    }
  };
}

function createInitialTenantRoutingSettings(): TenantRoutingSettings {
  return {
    companyDefaultModelRef,
    fallbackModelRef: initialFallbackModelRef,
    mode: "auto",
    routes: createCompanyDefaultMatrix()
  };
}

function cloneTenantRoutingSettings(settings: TenantRoutingSettings): TenantRoutingSettings {
  return {
    companyDefaultModelRef: settings.companyDefaultModelRef,
    fallbackModelRef: settings.fallbackModelRef,
    mode: settings.mode,
    routes: cloneRoutingMatrix(settings.routes)
  };
}

function matrixUsesCompanyDefaultOnly(matrix: RoutingMatrix, defaultModelRef: string) {
  return routingCategories.some(({ id: category }) =>
    routingDifficulties.some(({ id: difficulty }) =>
      matrix[category][difficulty].modelRefs.some(
        (modelRef) => modelRef !== defaultModelRef
      )
    )
  ) === false;
}

export default function TenantsPage() {
  const [locale, setLocale] = useState<Locale>("en");
  const [activeSection, setActiveSection] = useState<TenantManagementSection>("routing");
  const [savedRoutingSettings, setSavedRoutingSettings] = useState<TenantRoutingSettings>(
    createInitialTenantRoutingSettings
  );
  const text = tenantManagementText[locale];

  useEffect(() => {
    const localeCookie = document.cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${LOCALE_COOKIE_NAME}=`))
      ?.split("=")[1];
    setLocale(normalizeLocale(localeCookie));
  }, []);

  return (
    <main className="console-content management-line-content tenant-management-content">
      <header className="project-page-header">
        <h2>{text.title}</h2>
      </header>
      <div className="tenant-page-header-rule" aria-hidden="true" />
      <div className="policy-section-toolbar">
        <div
          aria-label={text.sectionLabel}
          className="policy-section-tabs tenant-management-tabs"
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
                {text.sections[section.id]}
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
            locale={locale}
            onSave={(settings) => setSavedRoutingSettings(cloneTenantRoutingSettings(settings))}
          />
        ) : (
          <section className="tenant-routing-enable-card" aria-labelledby="tenant-budget-title">
            <div>
              <h3 id="tenant-budget-title">{text.budget}</h3>
              <p>{text.budgetDescription}</p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function TenantRoutingPanel({
  initialSettings,
  locale,
  onSave
}: {
  initialSettings: TenantRoutingSettings;
  locale: Locale;
  onSave: (settings: TenantRoutingSettings) => void;
}) {
  const text = tenantManagementText[locale];
  const saveConfirmationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSaveConfirmed, setIsSaveConfirmed] = useState(false);
  const [selectedCompanyDefaultModelRef, setSelectedCompanyDefaultModelRef] = useState(
    initialSettings.companyDefaultModelRef
  );
  const [fallbackModelRef, setFallbackModelRef] = useState(initialSettings.fallbackModelRef);
  const [mode, setMode] = useState<RoutingMode>(initialSettings.mode);
  const [routingMatrix, setRoutingMatrix] = useState<RoutingMatrix>(() =>
    cloneRoutingMatrix(initialSettings.routes)
  );
  const [statusMessage, setStatusMessage] = useState("");
  const usesCompanyDefaultOnly = matrixUsesCompanyDefaultOnly(
    routingMatrix,
    selectedCompanyDefaultModelRef
  );

  useEffect(
    () => () => {
      if (saveConfirmationTimeout.current) {
        clearTimeout(saveConfirmationTimeout.current);
      }
    },
    []
  );

  function clearSaveConfirmation() {
    if (saveConfirmationTimeout.current) {
      clearTimeout(saveConfirmationTimeout.current);
      saveConfirmationTimeout.current = null;
    }
    setIsSaveConfirmed(false);
  }

  function updateCell(
    category: RoutingCategory,
    difficulty: RoutingDifficulty,
    update: (modelRefs: string[]) => string[]
  ) {
    clearSaveConfirmation();
    setRoutingMatrix((current) => ({
      ...current,
      [category]: {
        ...current[category],
        [difficulty]: {
          modelRefs: update([...current[category][difficulty].modelRefs])
        }
      }
    }));
    setStatusMessage("");
  }

  function updateModelRef(
    category: RoutingCategory,
    difficulty: RoutingDifficulty,
    modelRef: string
  ) {
    updateCell(category, difficulty, () => [modelRef]);
  }

  function changeCompanyDefaultModel(nextModelRef: string) {
    clearSaveConfirmation();
    const previousDefaultModelRef = selectedCompanyDefaultModelRef;
    setSelectedCompanyDefaultModelRef(nextModelRef);
    setRoutingMatrix((current) => {
      const next = cloneRoutingMatrix(current);

      for (const category of routingCategories) {
        for (const difficulty of routingDifficulties) {
          const cell = next[category.id][difficulty.id];
          if (cell.modelRefs[0] === previousDefaultModelRef) {
            cell.modelRefs = [nextModelRef];
          }
        }
      }

      return next;
    });
    setStatusMessage("");
  }

  function changeFallbackModel(nextModelRef: string) {
    clearSaveConfirmation();
    setFallbackModelRef(nextModelRef);
    setStatusMessage("");
  }

  function changeMode(autoRoutingEnabled: boolean) {
    clearSaveConfirmation();
    setMode(autoRoutingEnabled ? "auto" : "manual");
    setStatusMessage(
      autoRoutingEnabled ? text.autoEnabledMessage : text.manualEnabledMessage
    );
  }

  function saveRoutingSettings() {
    clearSaveConfirmation();
    onSave({
      companyDefaultModelRef: selectedCompanyDefaultModelRef,
      fallbackModelRef,
      mode,
      routes: cloneRoutingMatrix(routingMatrix)
    });
    setStatusMessage(text.savedMessage);
    saveConfirmationTimeout.current = setTimeout(() => {
      setIsSaveConfirmed(true);
      saveConfirmationTimeout.current = setTimeout(() => {
        setIsSaveConfirmed(false);
        saveConfirmationTimeout.current = null;
      }, saveConfirmationDurationMs);
    }, 0);
  }

  function resetRoutingSettings() {
    clearSaveConfirmation();
    setSelectedCompanyDefaultModelRef(companyDefaultModelRef);
    setFallbackModelRef(initialFallbackModelRef);
    setMode("auto");
    setRoutingMatrix(createCompanyDefaultMatrix());
    setStatusMessage(text.resetMessage);
  }

  return (
    <form
      className="tenant-routing-panel"
      data-policy-state={usesCompanyDefaultOnly ? "company_default" : "category_override"}
      onSubmit={(event) => {
        event.preventDefault();
        saveRoutingSettings();
      }}
    >
      <section className="tenant-routing-enable-card" aria-labelledby="tenant-auto-routing-title">
        <div>
          <h3 id="tenant-auto-routing-title">{text.autoRouting}</h3>
          <p>{text.autoDescription}</p>
        </div>
        <div className="tenant-routing-switch-control">
          <Switch
            aria-label={text.autoRouting}
            checked={mode === "auto"}
            className="tenant-routing-switch"
            onCheckedChange={changeMode}
          />
          <span>{mode === "auto" ? text.auto : text.manual}</span>
        </div>
      </section>

      <section className="tenant-routing-enable-card tenant-routing-default-card">
        <div>
          <h3>{text.companyDefaultModel}</h3>
          <p>
            {usesCompanyDefaultOnly
              ? text.companyDefaultOnly
              : text.companyOverridesActive}
          </p>
        </div>
        <TenantRoutingModelSelect
          ariaLabel={text.companyDefaultModel}
          className="tenant-routing-model-choice-prominent"
          onChange={changeCompanyDefaultModel}
          value={selectedCompanyDefaultModelRef}
        />
      </section>

      {mode === "auto" ? (
        <section className="tenant-routing-model-card" aria-labelledby="tenant-routing-model-title">
          <header className="tenant-routing-model-heading">
            <div className="tenant-routing-model-heading-copy">
              <h3 id="tenant-routing-model-title">{text.matrix}</h3>
              <p>{text.matrixDescription}</p>
            </div>
          </header>

          <div
            aria-label={text.matrix}
            className="tenant-routing-table"
            role="table"
          >
            <div className="tenant-routing-table-head" role="row">
              <span role="columnheader">{text.category}</span>
              <span role="columnheader">{text.simple}</span>
              <span role="columnheader">{text.complex}</span>
            </div>
            {routingCategories.map((category) => {
              const CategoryIcon = category.icon;

              return (
                <div className="tenant-routing-table-row" key={category.id} role="row">
                  <div className="tenant-routing-category" role="rowheader">
                    <CategoryIcon aria-hidden="true" />
                    <span>{text.categories[category.id]}</span>
                  </div>
                  {routingDifficulties.map((difficulty) => (
                    <RoutingCellEditor
                      category={category.id}
                      categoryLabel={text.categories[category.id]}
                      difficulty={difficulty.id}
                      difficultyLabel={difficulty.id === "simple" ? text.simple : text.complex}
                      key={difficulty.id}
                      modelRef={routingMatrix[category.id][difficulty.id].modelRefs[0]}
                      onChange={(modelRef) =>
                        updateModelRef(category.id, difficulty.id, modelRef)
                      }
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="tenant-routing-fallback-card" aria-labelledby="tenant-fallback-title">
        <header className="tenant-routing-fallback-heading">
          <h3 id="tenant-fallback-title">{text.fallbackTitle}</h3>
          <p>{text.fallbackDescription}</p>
        </header>
        <TenantRoutingModelSelect
          ariaLabel={text.fallbackModel}
          className="tenant-routing-fallback-model-choice"
          onChange={changeFallbackModel}
          value={fallbackModelRef}
        />
      </section>

      <div className="tenant-routing-actions">
        <button
          className="secondary-button tenant-routing-reset-button"
          onClick={resetRoutingSettings}
          type="button"
        >
          {text.reset}
        </button>
        <button
          className="primary-button tenant-routing-save-button"
          data-save-confirmed={isSaveConfirmed ? "true" : undefined}
          type="submit"
        >
          {isSaveConfirmed ? <Check aria-hidden="true" /> : null}
          {isSaveConfirmed ? text.saved : text.save}
        </button>
      </div>

      <p className="sr-only" aria-atomic="true" aria-live="polite" role="status">
        {statusMessage}
      </p>
    </form>
  );
}

function RoutingCellEditor({
  category,
  categoryLabel,
  difficulty,
  difficultyLabel,
  modelRef,
  onChange
}: {
  category: RoutingCategory;
  categoryLabel: string;
  difficulty: RoutingDifficulty;
  difficultyLabel: string;
  modelRef: string;
  onChange: (modelRef: string) => void;
}) {
  const accessibleLabel = `${categoryLabel} ${difficultyLabel} model`;

  return (
    <div
      className="tenant-routing-route tenant-routing-model-ref-cell"
      data-column-label={difficultyLabel}
      data-route-cell={`${category}:${difficulty}`}
      role="cell"
    >
      <TenantRoutingModelSelect
        ariaLabel={accessibleLabel}
        onChange={onChange}
        value={modelRef}
      />
    </div>
  );
}

function TenantRoutingModelSelect({
  ariaLabel,
  className,
  onChange,
  value
}: {
  ariaLabel: string;
  className?: string;
  onChange: (modelRef: string) => void;
  value: string;
}) {
  const selectedOption =
    tenantRoutingModelOptions.find((option) => option.modelRef === value) ??
    tenantRoutingModelOptions[0];

  return (
    <label className={`tenant-routing-model-choice ${className ?? ""}`.trim()}>
      <ProviderFamilyIcon
        className="tenant-routing-provider-icon tenant-routing-provider-icon-large"
        family={selectedOption.family}
        size={36}
      />
      <span className="tenant-routing-model-choice-copy">
        <span className="tenant-routing-model-provider">{selectedOption.providerName}</span>
        <select
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {tenantRoutingModelOptions.map((option) => (
            <option key={option.modelRef} value={option.modelRef}>
              {option.providerName} / {option.modelName}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
