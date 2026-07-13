"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BrainCircuit,
  Check,
  Code2,
  FileText,
  Languages,
  MessageSquareMore,
  Plus,
  Trash2,
  TriangleAlert
} from "lucide-react";

import { Switch } from "@/components/ui/switch";
import {
  LOCALE_COOKIE_NAME,
  normalizeLocale,
  type Locale
} from "@/lib/i18n/locale";

const tenantManagementSections = [
  { id: "budget", label: "Budget" },
  { id: "routing", label: "Routing" }
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
    addFallback: "Add fallback",
    auto: "Auto",
    autoDescription:
      "Auto classifies category first, then evaluates difficulty with that category context.",
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
    manual: "Manual",
    matrix: "Category × difficulty routing matrix",
    matrixDescription:
      "Each cell is an ordered modelRef list. The first entry is primary; the remaining entries are attempted as fallbacks in order. Uncategorized requests use General.",
    mockDescription: "Replace every mock-balanced entry with a real modelRef to clear this warning.",
    mockTitle: "Mock routing is active.",
    reset: "Reset",
    saved: "Saved",
    save: "Save changes",
    sections: { budget: "Budget", routing: "Routing" },
    sectionLabel: "Tenant management sections",
    simple: "Simple",
    title: "Tenant management"
  },
  ko: {
    addFallback: "대체 모델 추가",
    auto: "자동",
    autoDescription: "요청 카테고리를 먼저 분류한 다음 카테고리 맥락에서 난이도를 판별합니다.",
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
    manual: "수동",
    matrix: "카테고리 × 난이도 라우팅 설정",
    matrixDescription:
      "각 칸은 모델 참조의 우선순위 목록입니다. 첫 모델을 우선 호출하고, 이후 모델은 순서대로 대체 호출합니다. 분류되지 않은 요청은 일반 카테고리를 사용합니다.",
    mockDescription: "모든 mock-balanced 항목을 실제 모델 참조로 바꾸면 이 경고가 사라집니다.",
    mockTitle: "Mock 라우팅이 적용 중입니다.",
    reset: "초기화",
    saved: "저장됨",
    save: "변경사항 저장",
    sections: { budget: "예산", routing: "라우팅" },
    sectionLabel: "테넌트 관리 섹션",
    simple: "단순",
    title: "테넌트 관리"
  }
} as const;

const modelRefOptions = [
  "mock-balanced",
  "openai:gpt-4o",
  "openai:gpt-4o-mini",
  "anthropic:claude-sonnet",
  "anthropic:claude-haiku",
  "google:gemini-pro",
  "google:gemini-flash"
] as const;

const mockBootstrapModelRef = "mock-balanced";
const saveConfirmationDurationMs = 1800;

type TenantManagementSection = (typeof tenantManagementSections)[number]["id"];
type RoutingCategory = (typeof routingCategories)[number]["id"];
type RoutingDifficulty = (typeof routingDifficulties)[number]["id"];
type RoutingMode = "auto" | "manual";
type RoutingCell = { modelRefs: string[] };
type RoutingMatrix = Record<RoutingCategory, Record<RoutingDifficulty, RoutingCell>>;

type TenantRoutingSettings = {
  mode: RoutingMode;
  routes: RoutingMatrix;
};

function getTenantManagementTabId(section: TenantManagementSection) {
  return `tenant-management-tab-${section}`;
}

function getTenantManagementPanelId(section: TenantManagementSection) {
  return `tenant-management-panel-${section}`;
}

function createMockBootstrapCell(): RoutingCell {
  return { modelRefs: [mockBootstrapModelRef] };
}

function createMockBootstrapMatrix(): RoutingMatrix {
  return {
    code: {
      complex: createMockBootstrapCell(),
      simple: createMockBootstrapCell()
    },
    general: {
      complex: createMockBootstrapCell(),
      simple: createMockBootstrapCell()
    },
    reasoning: {
      complex: createMockBootstrapCell(),
      simple: createMockBootstrapCell()
    },
    summarization: {
      complex: createMockBootstrapCell(),
      simple: createMockBootstrapCell()
    },
    translation: {
      complex: createMockBootstrapCell(),
      simple: createMockBootstrapCell()
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
    mode: "auto",
    routes: createMockBootstrapMatrix()
  };
}

function cloneTenantRoutingSettings(settings: TenantRoutingSettings): TenantRoutingSettings {
  return {
    mode: settings.mode,
    routes: cloneRoutingMatrix(settings.routes)
  };
}

function matrixUsesMockModels(matrix: RoutingMatrix) {
  return routingCategories.some(({ id: category }) =>
    routingDifficulties.some(({ id: difficulty }) =>
      matrix[category][difficulty].modelRefs.some((modelRef) => modelRef.startsWith("mock-"))
    )
  );
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
  const [mode, setMode] = useState<RoutingMode>(initialSettings.mode);
  const [routingMatrix, setRoutingMatrix] = useState<RoutingMatrix>(() =>
    cloneRoutingMatrix(initialSettings.routes)
  );
  const [statusMessage, setStatusMessage] = useState("");
  const usesMockModels = matrixUsesMockModels(routingMatrix);

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
    index: number,
    modelRef: string
  ) {
    updateCell(category, difficulty, (modelRefs) => {
      modelRefs[index] = modelRef;
      return modelRefs;
    });
  }

  function addFallback(category: RoutingCategory, difficulty: RoutingDifficulty) {
    updateCell(category, difficulty, (modelRefs) => {
      const nextModelRef =
        modelRefOptions.find(
          (modelRef) => !modelRef.startsWith("mock-") && !modelRefs.includes(modelRef)
        ) ?? modelRefOptions.find((modelRef) => !modelRefs.includes(modelRef));

      return nextModelRef ? [...modelRefs, nextModelRef] : modelRefs;
    });
  }

  function moveModelRef(
    category: RoutingCategory,
    difficulty: RoutingDifficulty,
    index: number,
    direction: -1 | 1
  ) {
    updateCell(category, difficulty, (modelRefs) => {
      const destination = index + direction;
      if (destination < 0 || destination >= modelRefs.length) {
        return modelRefs;
      }
      [modelRefs[index], modelRefs[destination]] = [modelRefs[destination], modelRefs[index]];
      return modelRefs;
    });
  }

  function removeModelRef(
    category: RoutingCategory,
    difficulty: RoutingDifficulty,
    index: number
  ) {
    updateCell(category, difficulty, (modelRefs) =>
      modelRefs.length === 1 ? modelRefs : modelRefs.filter((_, itemIndex) => itemIndex !== index)
    );
  }

  function changeMode(autoRoutingEnabled: boolean) {
    clearSaveConfirmation();
    setMode(autoRoutingEnabled ? "auto" : "manual");
    setStatusMessage(
      autoRoutingEnabled
        ? "Auto routing enabled. The saved routing matrix is active."
        : "Manual mode selected. The Auto routing matrix is preserved."
    );
  }

  function saveRoutingSettings() {
    clearSaveConfirmation();
    onSave({ mode, routes: cloneRoutingMatrix(routingMatrix) });
    setStatusMessage("Routing settings saved.");
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
    setMode("auto");
    setRoutingMatrix(createMockBootstrapMatrix());
    setStatusMessage("Routing settings reset to the guarded mock bootstrap configuration.");
  }

  return (
    <form
      className="tenant-routing-panel"
      data-bootstrap-state={usesMockModels ? "mock_bootstrap" : "configured"}
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

      {usesMockModels ? (
        <div className="tenant-routing-mock-warning" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>{text.mockTitle}</strong>
            <span>{text.mockDescription}</span>
          </div>
        </div>
      ) : null}

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
                      modelRefs={routingMatrix[category.id][difficulty.id].modelRefs}
                      onAdd={() => addFallback(category.id, difficulty.id)}
                      onChange={(index, modelRef) =>
                        updateModelRef(category.id, difficulty.id, index, modelRef)
                      }
                      onMove={(index, direction) =>
                        moveModelRef(category.id, difficulty.id, index, direction)
                      }
                      onRemove={(index) => removeModelRef(category.id, difficulty.id, index)}
                      addFallbackLabel={text.addFallback}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

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
  addFallbackLabel,
  category,
  categoryLabel,
  difficulty,
  difficultyLabel,
  modelRefs,
  onAdd,
  onChange,
  onMove,
  onRemove
}: {
  addFallbackLabel: string;
  category: RoutingCategory;
  categoryLabel: string;
  difficulty: RoutingDifficulty;
  difficultyLabel: string;
  modelRefs: string[];
  onAdd: () => void;
  onChange: (index: number, modelRef: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  const canAddFallback = modelRefOptions.some((modelRef) => !modelRefs.includes(modelRef));

  return (
    <div
      className="tenant-routing-route tenant-routing-model-ref-cell"
      data-column-label={difficultyLabel}
      data-route-cell={`${category}:${difficulty}`}
      role="cell"
    >
      <ol className="tenant-routing-model-ref-list">
        {modelRefs.map((modelRef, index) => {
          const positionLabel = index === 0 ? "primary" : `fallback ${index}`;
          const accessiblePositionLabel = `${categoryLabel} ${difficultyLabel} ${positionLabel}`;

          return (
            <li className="tenant-routing-model-ref-item" key={`${index}:${modelRef}`}>
              <span aria-hidden="true" className="tenant-routing-model-ref-rank">
                {index + 1}
              </span>
              <label className="tenant-routing-model-ref-control">
                <span className="sr-only">{accessiblePositionLabel} modelRef</span>
                <select
                  aria-label={`${accessiblePositionLabel} modelRef`}
                  onChange={(event) => onChange(index, event.target.value)}
                  value={modelRef}
                >
                  {modelRefOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <span className="tenant-routing-model-ref-actions">
                <button
                  aria-label={`Move ${accessiblePositionLabel} up`}
                  disabled={index === 0}
                  onClick={() => onMove(index, -1)}
                  type="button"
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  aria-label={`Move ${accessiblePositionLabel} down`}
                  disabled={index === modelRefs.length - 1}
                  onClick={() => onMove(index, 1)}
                  type="button"
                >
                  <ArrowDown aria-hidden="true" />
                </button>
                <button
                  aria-label={`Remove ${accessiblePositionLabel}`}
                  disabled={modelRefs.length === 1}
                  onClick={() => onRemove(index)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <button
        aria-label={`Add fallback modelRef to ${categoryLabel} ${difficultyLabel}`}
        className="secondary-button tenant-routing-model-ref-add"
        disabled={!canAddFallback}
        onClick={onAdd}
        type="button"
      >
        <Plus aria-hidden="true" />
        {addFallbackLabel}
      </button>
    </div>
  );
}
