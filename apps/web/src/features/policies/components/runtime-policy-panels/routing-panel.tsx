"use client";

import {
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Code2,
  FileText,
  Languages,
  MessageSquareMore,
  Plus,
  Trash2
} from "lucide-react";
import { useMemo } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import {
  runtimeRoutingCategories,
  runtimeRoutingDifficulties,
  type RuntimePolicyDraftValues,
  type RuntimePolicyModel,
  type RuntimePolicyProvider,
  type RuntimeRoutingCategory,
  type RuntimeRoutingDifficulty
} from "@/lib/control-plane/runtime-policy-types";

import type {
  RuntimePolicyDraftValuesSetter,
  RuntimePolicyEditorText
} from "../runtime-policy-editor-types";

const categoryRows: Array<{
  icon: typeof MessageSquareMore;
  id: RuntimeRoutingCategory;
  label: string;
}> = [
  { icon: MessageSquareMore, id: "general", label: "일반" },
  { icon: Code2, id: "code", label: "코드" },
  { icon: Languages, id: "translation", label: "번역" },
  { icon: FileText, id: "summarization", label: "요약" },
  { icon: BrainCircuit, id: "reasoning", label: "추론" }
];

type ModelRefOption = {
  family: string;
  label: string;
  modelRef: string;
  providerName: string;
};

export type RoutingPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: RuntimePolicyDraftValuesSetter;
  providerCatalog: RuntimePolicyModel["providerCatalog"];
  providers: RuntimePolicyProvider[];
  text: RuntimePolicyEditorText;
};

export function RoutingPolicyPanel({
  draftValues,
  onDraftValuesChange,
  providerCatalog,
  providers,
  text
}: RoutingPolicyPanelProps) {
  const modelOptions = useMemo(() => createModelRefOptions(providers), [providers]);
  const hasMockRoute = runtimeRoutingCategories.some((category) =>
    runtimeRoutingDifficulties.some((difficulty) =>
      draftValues.routingPolicy.routes[category][difficulty].modelRefs.some((modelRef) =>
        isMockModelRef(modelRef, modelOptions)
      )
    )
  );

  function updateRoutingPolicy(
    update: (policy: RuntimePolicyDraftValues["routingPolicy"]) => void
  ) {
    onDraftValuesChange((current) => {
      const routingPolicy = structuredClone(current.routingPolicy);
      update(routingPolicy);
      routingPolicy.bootstrapState = hasMockModelInRoutes(
        routingPolicy.routes,
        modelOptions
      )
        ? "mock_bootstrap"
        : "configured";

      return { ...current, routingPolicy };
    });
  }

  function setMode(mode: "auto" | "manual") {
    updateRoutingPolicy((policy) => {
      policy.mode = mode;
    });
  }

  function setCellModelRefs(
    category: RuntimeRoutingCategory,
    difficulty: RuntimeRoutingDifficulty,
    modelRefs: string[]
  ) {
    updateRoutingPolicy((policy) => {
      policy.routes[category][difficulty].modelRefs = modelRefs;
    });
  }

  return (
    <>
      <section className="tenant-routing-enable-card" aria-labelledby="policy-auto-routing-title">
        <div>
          <h3 id="policy-auto-routing-title">Auto routing</h3>
          <p>
            ON이면 요청의 카테고리와 난이도를 판정해 10개 경로 중 하나를 사용합니다.
            OFF이면 호출자가 명시한 모델만 사용하며 저장된 10개 경로는 유지됩니다.
          </p>
        </div>
        <div className="tenant-routing-switch-control">
          <Switch
            aria-label="Auto routing"
            checked={draftValues.routingPolicy.mode === "auto"}
            className="tenant-routing-switch"
            onCheckedChange={(checked) => setMode(checked ? "auto" : "manual")}
          />
          <span>{draftValues.routingPolicy.mode === "auto" ? "ON" : "OFF"}</span>
        </div>
      </section>

      {hasMockRoute ? (
        <Alert variant="warning">
          <AlertDescription>
            현재 Mock 모델이 포함되어 있습니다. 모든 셀에서 Mock을 실제 모델로 교체할
            때까지 실행은 Mock으로 표시됩니다.
          </AlertDescription>
        </Alert>
      ) : null}

      {draftValues.routingPolicy.mode === "auto" ? (
        <section
          className="tenant-routing-model-card policy-category-model-card"
          aria-labelledby="policy-routing-category-model-title"
        >
          <header className="tenant-routing-model-heading">
            <div className="tenant-routing-model-heading-copy">
              <h3 id="policy-routing-category-model-title">카테고리 × 난이도 모델 설정</h3>
              <p>
                각 셀의 첫 모델이 기본 대상이며, 다음 모델은 위에서 아래 순서로 fallback
                됩니다.
              </p>
            </div>
          </header>

          <div className="tenant-routing-table" role="table" aria-label="카테고리 난이도 모델 설정">
            <div className="tenant-routing-table-head" role="row">
              <span role="columnheader">카테고리</span>
              <span role="columnheader">Simple</span>
              <span role="columnheader">Complex</span>
            </div>
            {categoryRows.map((row) => {
              const CategoryIcon = row.icon;

              return (
                <div className="tenant-routing-table-row" key={row.id} role="row">
                  <div className="tenant-routing-category" role="rowheader">
                    <CategoryIcon aria-hidden="true" />
                    <span>{row.label}</span>
                  </div>
                  {runtimeRoutingDifficulties.map((difficulty) => (
                    <OrderedModelRefEditor
                      category={row.id}
                      categoryLabel={row.label}
                      difficulty={difficulty}
                      key={difficulty}
                      modelOptions={modelOptions}
                      modelRefs={
                        draftValues.routingPolicy.routes[row.id][difficulty].modelRefs
                      }
                      onChange={(modelRefs) =>
                        setCellModelRefs(row.id, difficulty, modelRefs)
                      }
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="tenant-routing-off-default-card">
          <header className="tenant-routing-off-default-heading">
            <h3>Manual model selection</h3>
            <p>
              이 모드에서는 <code>model: &quot;auto&quot;</code> 요청이 거부됩니다. 호출자는 명시적인
              modelRef를 보내야 하며, Auto routing을 다시 켜면 저장된 10개 셀이 복원됩니다.
            </p>
          </header>
        </section>
      )}

      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.providerCatalog}</h3>
        </div>
        {providerCatalog.loadError ? (
          <Alert variant="warning">
            <AlertDescription>{providerCatalog.loadError}</AlertDescription>
          </Alert>
        ) : null}
        {providerCatalog.canonicalLoadError ? (
          <Alert variant="warning">
            <AlertDescription>{providerCatalog.canonicalLoadError}</AlertDescription>
          </Alert>
        ) : null}
        {providerCatalog.summary ? (
          <dl className="policy-summary-list">
            <div>
              <dt>{text.catalogVersion}</dt>
              <dd>{providerCatalog.summary.catalogVersion}</dd>
            </div>
            <div>
              <dt>{text.providerCount}</dt>
              <dd>
                {providerCatalog.summary.providerCount} / {text.models}:{" "}
                {providerCatalog.summary.modelCount}
              </dd>
            </div>
          </dl>
        ) : null}
      </article>
    </>
  );
}

function OrderedModelRefEditor({
  category,
  categoryLabel,
  difficulty,
  modelOptions,
  modelRefs,
  onChange
}: {
  category: RuntimeRoutingCategory;
  categoryLabel: string;
  difficulty: RuntimeRoutingDifficulty;
  modelOptions: ModelRefOption[];
  modelRefs: string[];
  onChange: (modelRefs: string[]) => void;
}) {
  const availableToAdd = modelOptions.find(
    (option) => !modelRefs.includes(option.modelRef)
  );

  return (
    <div className="tenant-routing-route" data-column-label={difficulty} role="cell">
      <ol className="routing-model-ref-list">
        {modelRefs.map((modelRef, index) => {
          const selectedOption = modelOptions.find(
            (option) => option.modelRef === modelRef
          );
          const options = selectedOption
            ? modelOptions
            : [
                {
                  family: "mock",
                  label: modelRef,
                  modelRef,
                  providerName: modelRef === "mock-balanced" ? "mock" : "unavailable"
                },
                ...modelOptions
              ];

          return (
            <li className="routing-model-ref-item" key={`${modelRef}:${index}`}>
              <ProviderFamilyIcon
                className="tenant-routing-provider-icon"
                family={selectedOption?.family ?? "mock"}
                size={20}
              />
              <label>
                <span className="sr-only">
                  {categoryLabel} {difficulty} {index === 0 ? "primary" : `fallback ${index}`}
                </span>
                <select
                  aria-label={`${categoryLabel} ${difficulty} ${index === 0 ? "primary" : `fallback ${index}`}`}
                  onChange={(event) => {
                    const next = [...modelRefs];
                    next[index] = event.target.value;
                    onChange(Array.from(new Set(next)));
                  }}
                  value={modelRef}
                >
                  {options.map((option) => (
                    <option key={option.modelRef} value={option.modelRef}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="routing-model-ref-actions">
                <button
                  aria-label={`${category} ${difficulty} move up`}
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(modelRefs, index, index - 1))}
                  type="button"
                >
                  <ChevronUp aria-hidden="true" />
                </button>
                <button
                  aria-label={`${category} ${difficulty} move down`}
                  disabled={index === modelRefs.length - 1}
                  onClick={() => onChange(moveItem(modelRefs, index, index + 1))}
                  type="button"
                >
                  <ChevronDown aria-hidden="true" />
                </button>
                <button
                  aria-label={`${category} ${difficulty} remove model`}
                  disabled={modelRefs.length === 1}
                  onClick={() => onChange(modelRefs.filter((_, itemIndex) => itemIndex !== index))}
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button
        className="secondary-button routing-model-ref-add"
        disabled={!availableToAdd}
        onClick={() => availableToAdd && onChange([...modelRefs, availableToAdd.modelRef])}
        type="button"
      >
        <Plus aria-hidden="true" /> fallback
      </button>
    </div>
  );
}

function createModelRefOptions(providers: RuntimePolicyProvider[]): ModelRefOption[] {
  const options = providers
    .filter((provider) => provider.status !== "disabled")
    .flatMap((provider) =>
      provider.models.map((modelId) => ({
        family: getProviderFamily(provider),
        label: `${provider.displayName} / ${modelId}`,
        modelRef:
          provider.provider === "mock" && modelId === "mock-balanced"
            ? "mock-balanced"
            : `${provider.providerId}:${modelId}`,
        providerName: provider.provider
      }))
    );

  if (!options.some((option) => option.modelRef === "mock-balanced")) {
    options.unshift({
      family: "mock",
      label: "Mock Provider / mock-balanced",
      modelRef: "mock-balanced",
      providerName: "mock"
    });
  }

  return options;
}

function getProviderFamily(provider: RuntimePolicyProvider) {
  const key = `${provider.provider} ${provider.displayName} ${provider.baseUrl}`.toLowerCase();
  if (key.includes("anthropic") || key.includes("claude")) return "claude";
  if (key.includes("gemini") || key.includes("google")) return "gemini";
  if (key.includes("mock")) return "mock";
  return "openai";
}

function hasMockModelInRoutes(
  routes: RuntimePolicyDraftValues["routingPolicy"]["routes"],
  modelOptions: ModelRefOption[]
) {
  return runtimeRoutingCategories.some((category) =>
    runtimeRoutingDifficulties.some((difficulty) =>
      routes[category][difficulty].modelRefs.some((modelRef) =>
        isMockModelRef(modelRef, modelOptions)
      )
    )
  );
}

function isMockModelRef(modelRef: string, modelOptions: ModelRefOption[]) {
  return (
    modelRef === "mock-balanced" ||
    modelOptions.find((option) => option.modelRef === modelRef)?.providerName === "mock"
  );
}

function moveItem(items: string[], from: number, to: number) {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
