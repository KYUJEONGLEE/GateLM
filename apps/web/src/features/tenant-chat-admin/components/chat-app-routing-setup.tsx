"use client";

import {
  AlertTriangle,
  BrainCircuit,
  Check,
  Code2,
  FileText,
  Languages,
  LoaderCircle,
  MessageSquareMore,
  MessageSquareText,
  PlugZap,
  RefreshCw
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Switch } from "@/components/ui/switch";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import { getTenantChatReturnPath } from "@/features/provider-connections/tenant-chat-setup-return";
import type {
  TenantChatAdminRuntimeSetup,
  TenantChatRoutingCategory,
  TenantChatRoutingDifficulty,
  TenantChatRoutingMatrix,
  TenantChatRoutingMode
} from "@/lib/control-plane/tenant-chat-runtime-types";
import type { Locale } from "@/lib/i18n/locale";

type Props = {
  initialLoadError: string | null;
  initialSetup: TenantChatAdminRuntimeSetup | null;
  locale: Locale;
  onboardingReturn?: boolean;
  requestedProviderConnectionId?: string;
  tenantId: string;
};

const categories = [
  { icon: MessageSquareMore, id: "general", en: "General", ko: "일반" },
  { icon: Code2, id: "code", en: "Code", ko: "코드" },
  { icon: Languages, id: "translation", en: "Translation", ko: "번역" },
  { icon: FileText, id: "summarization", en: "Summarization", ko: "요약" },
  { icon: BrainCircuit, id: "reasoning", en: "Reasoning", ko: "추론" }
] satisfies Array<{
  icon: typeof MessageSquareMore;
  id: TenantChatRoutingCategory;
  en: string;
  ko: string;
}>;
const difficulties: Array<{ id: TenantChatRoutingDifficulty; en: string; ko: string }> = [
  { id: "simple", en: "Simple", ko: "단순" },
  { id: "complex", en: "Complex", ko: "복합" }
];

type RoutingModelOption = TenantChatAdminRuntimeSetup["providers"][number]["models"][number] & {
  label: string;
  providerFamily: string;
  providerName: string;
};

const copy = {
  en: {
    active: "Active runtime",
    autoLabel: "Auto",
    auto: "Automatic routing",
    autoDescription: "Classify messages into five workloads and simple or complex, then use the model assigned to that cell.",
    breadcrumb: "Chat App",
    configureProvider: "Register or edit provider",
    degraded: "The active runtime references a provider or model that is no longer available. Review and publish again.",
    description: "Manage the built-in Tenant Chat app and publish its immutable 5 × 2 routing policy.",
    loadError: "The Chat App policy could not be loaded.",
    manual: "Fixed model",
    manualLabel: "Manual",
    manualDescription: "Use one model for every message while preserving the automatic routing matrix for later.",
    model: "Model",
    modelUnavailable: "Selected model unavailable",
    noModel: "No chat model is configured on an active tenant-level provider.",
    noProvider: "Register an active tenant-level provider to configure the Chat App.",
    priceUnknown: "Price unavailable · usage allowed · monetary ledger uses 0 (not a free-price claim)",
    publish: "Publish routing policy",
    publishing: "Publishing…",
    ready: "The Chat App routing policy is active.",
    refresh: "Try again",
    reset: "Reset",
    resetMessage: "Unsaved changes were reset to the active routing policy.",
    routing: "Routing policy",
    routingDescription: "Each cell is an explicit modelRef assignment. Difficulty is independent from budget or quota state.",
    title: "Chat App",
    version: "Snapshot v"
  },
  ko: {
    active: "현재 적용 중",
    autoLabel: "자동",
    auto: "자동 라우팅",
    autoDescription: "메시지를 5개 작업 유형과 단순·복잡 난이도로 분류한 뒤 해당 셀에 지정한 모델을 사용합니다.",
    breadcrumb: "채팅 앱",
    configureProvider: "Provider 등록 또는 수정",
    degraded: "현재 Runtime이 더 이상 사용할 수 없는 Provider 또는 모델을 참조합니다. 정책을 확인한 뒤 다시 발행하세요.",
    description: "내장 Tenant Chat 앱과 실제 실행되는 5 × 2 라우팅 정책을 관리합니다.",
    loadError: "채팅 앱 정책을 불러오지 못했습니다.",
    manual: "고정 모델",
    manualLabel: "수동",
    manualDescription: "모든 메시지에 하나의 모델을 사용합니다. 자동 라우팅 매트릭스는 그대로 보존됩니다.",
    model: "모델",
    modelUnavailable: "선택된 모델 사용 불가",
    noModel: "활성 tenant-level Provider에 채팅 모델이 설정되어 있지 않습니다.",
    noProvider: "채팅 앱을 설정하려면 활성 tenant-level Provider를 등록하세요.",
    priceUnknown: "가격 미확인 · 모델 사용 가능 · 금액 ledger는 0 사용(무료라는 뜻이 아님)",
    publish: "라우팅 정책 발행",
    publishing: "발행 중…",
    ready: "채팅 앱 라우팅 정책이 적용되었습니다.",
    refresh: "다시 시도",
    reset: "초기화",
    resetMessage: "저장하지 않은 변경사항을 현재 라우팅 정책으로 되돌렸습니다.",
    routing: "라우팅 정책",
    routingDescription: "각 셀은 명시적인 modelRef 배정입니다. 난이도는 예산 또는 quota 상태와 독립적입니다.",
    title: "채팅 앱",
    version: "Snapshot v"
  }
} satisfies Record<Locale, Record<string, string>>;

export function ChatAppRoutingSetup({
  initialLoadError,
  initialSetup,
  locale,
  onboardingReturn = false,
  requestedProviderConnectionId,
  tenantId
}: Props) {
  const text = copy[locale];
  const returnPath = getTenantChatReturnPath(tenantId);
  const [setup, setSetup] = useState(initialSetup);
  const [loadError, setLoadError] = useState(initialLoadError);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean; published?: boolean } | null>(null);
  const initialRef = firstModelRef(initialSetup);
  const [routingMode, setRoutingMode] = useState<TenantChatRoutingMode>(initialSetup?.activeSnapshot?.routingMode ?? "auto");
  const [manualModelRef, setManualModelRef] = useState(initialSetup?.activeSnapshot?.manualModelRef ?? initialRef);
  const [routes, setRoutes] = useState<TenantChatRoutingMatrix>(initialSetup?.activeSnapshot?.routes ?? uniformRoutingMatrix(initialRef));

  const models = useMemo(
    () => (setup?.providers ?? []).flatMap((provider) => provider.models.map((model) => ({
      ...model,
      label: `${provider.displayName} / ${model.modelKey}`,
      providerFamily: provider.providerFamily,
      providerName: provider.displayName
    }))),
    [setup]
  );
  const providerManagementHref = `/tenants/${encodeURIComponent(tenantId)}/provider-connections?${new URLSearchParams({
    intent: "tenant-chat-setup",
    returnTo: returnPath
  }).toString()}`;

  useEffect(() => {
    if (!onboardingReturn && !requestedProviderConnectionId) return;
    let current = true;
    setLoading(true);
    void loadSetup(tenantId).then((result) => {
      if (!current) return;
      if (result.ok) {
        applySetup(result.data, setSetup, setRoutingMode, setManualModelRef, setRoutes);
        setLoadError(null);
      } else setLoadError(result.error);
    }).finally(() => {
      if (current) {
        setLoading(false);
        window.history.replaceState(window.history.state, "", returnPath);
      }
    });
    return () => { current = false; };
  }, [onboardingReturn, requestedProviderConnectionId, returnPath, tenantId]);

  async function refresh() {
    setLoading(true);
    setFeedback(null);
    const result = await loadSetup(tenantId);
    if (result.ok) {
      applySetup(result.data, setSetup, setRoutingMode, setManualModelRef, setRoutes);
      setLoadError(null);
    } else setLoadError(result.error);
    setLoading(false);
  }

  async function publish() {
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/control-plane/tenant-chat-runtime?tenantId=${encodeURIComponent(tenantId)}`, {
        body: JSON.stringify({ manualModelRef, routes, routingMode }),
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok || !isRuntimeSetup(payload)) {
        setFeedback({ error: true, message: readPayloadError(payload, "Chat App routing policy publish failed.") });
      } else {
        applySetup(payload, setSetup, setRoutingMode, setManualModelRef, setRoutes);
        setFeedback({ error: false, message: text.ready, published: true });
      }
    } catch {
      setFeedback({ error: true, message: "Control Plane unavailable." });
    } finally {
      setPending(false);
    }
  }

  function updateRoute(category: TenantChatRoutingCategory, difficulty: TenantChatRoutingDifficulty, modelRef: string) {
    setRoutes((current) => ({
      ...current,
      [category]: { ...current[category], [difficulty]: { modelRefs: [modelRef] } }
    }));
    setFeedback(null);
  }

  function changeMode(autoRoutingEnabled: boolean) {
    setRoutingMode(autoRoutingEnabled ? "auto" : "manual");
    setFeedback(null);
  }

  function resetDraft() {
    if (setup) {
      applySetup(setup, setSetup, setRoutingMode, setManualModelRef, setRoutes);
    }
    setFeedback({ error: false, message: text.resetMessage });
  }

  const readiness = setup?.readiness ?? "degraded";
  const refs = new Set(models.map((model) => model.modelRef));
  const canPublish = refs.has(manualModelRef) && matrixUsesOnly(routes, refs);

  return (
    <main className="console-content management-line-content tenant-management-content">
      <header className="project-page-header">
        <h2>{text.title}</h2>
      </header>
      <div className="tenant-page-header-rule" aria-hidden="true" />
      <div className="policy-section-toolbar">
        <div aria-label={text.breadcrumb} className="policy-section-tabs tenant-management-tabs" role="tablist">
          <button aria-controls="chat-app-routing-panel" aria-selected="true" data-active="true" id="chat-app-routing-tab" role="tab" type="button">{text.routing}</button>
        </div>
        <div className="policy-actions flex flex-wrap items-center gap-2">
          <ReadinessBadge readiness={readiness} locale={locale} />
          {setup?.activeSnapshot ? <Badge variant="outline">{text.version}{setup.activeSnapshot.version}</Badge> : null}
        </div>
      </div>

      <div aria-labelledby="chat-app-routing-tab" className="policy-tab-panel space-y-5" id="chat-app-routing-panel" role="tabpanel" tabIndex={0}>
        {loadError ? <Alert variant="destructive"><AlertTriangle /><AlertTitle>{text.loadError}</AlertTitle><AlertDescription><p>{loadError}</p><Button disabled={loading} onClick={() => void refresh()} size="sm" variant="outline">{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{text.refresh}</Button></AlertDescription></Alert> : null}
        {readiness === "degraded" && !loadError ? <Alert variant="warning"><AlertTriangle /><AlertDescription>{text.degraded}</AlertDescription></Alert> : null}
        {feedback ? <Alert variant={feedback.error ? "destructive" : "success"}>{feedback.error ? <AlertTriangle /> : <Check />}<AlertDescription>{feedback.message}</AlertDescription></Alert> : null}

        {!setup?.providers.length ? (
          <EmptyState action={<Link className={buttonVariants()} href={providerManagementHref}><PlugZap />{text.configureProvider}</Link>} description={text.noProvider} icon={PlugZap} title={text.title} />
        ) : models.length === 0 ? (
          <EmptyState action={<Link className={buttonVariants()} href={providerManagementHref}>{text.configureProvider}</Link>} description={text.noModel} icon={MessageSquareText} title={text.model} />
        ) : (
          <form className="tenant-routing-panel" onSubmit={(event) => { event.preventDefault(); void publish(); }}>
            <section className="tenant-routing-enable-card" aria-labelledby="tenant-auto-routing-title">
              <div>
                <h3 id="tenant-auto-routing-title">{text.auto}</h3>
                <p>{text.autoDescription}</p>
              </div>
              <div className="tenant-routing-switch-control">
                <Switch
                  aria-label={text.auto}
                  checked={routingMode === "auto"}
                  className="tenant-routing-switch"
                  onCheckedChange={changeMode}
                />
                <span>{routingMode === "auto" ? text.autoLabel : text.manualLabel}</span>
              </div>
            </section>

            <section className="tenant-routing-enable-card tenant-routing-default-card">
              <div>
                <h3>{text.manual}</h3>
                <p>{text.manualDescription}</p>
              </div>
              <TenantRoutingModelSelect
                ariaLabel={text.manual}
                className="tenant-routing-model-choice-prominent"
                locale={locale}
                models={models}
                onChange={(value) => { setManualModelRef(value); setFeedback(null); }}
                value={manualModelRef}
              />
            </section>

            {routingMode === "auto" ? (
              <section className="tenant-routing-model-card" aria-labelledby="tenant-routing-model-title">
                <header className="tenant-routing-model-heading">
                  <div className="tenant-routing-model-heading-copy">
                    <h3 id="tenant-routing-model-title">{text.routing}</h3>
                    <p>{text.routingDescription}</p>
                  </div>
                </header>
                <div aria-label={text.routing} className="tenant-routing-table" role="table">
                  <div className="tenant-routing-table-head" role="row">
                    <span role="columnheader">{locale === "ko" ? "카테고리" : "Category"}</span>
                    {difficulties.map((difficulty) => <span key={difficulty.id} role="columnheader">{difficulty[locale]}</span>)}
                  </div>
                  {categories.map((category) => {
                    const CategoryIcon = category.icon;
                    return (
                      <div className="tenant-routing-table-row" key={category.id} role="row">
                        <div className="tenant-routing-category" role="rowheader">
                          <CategoryIcon aria-hidden="true" />
                          <span>{category[locale]}</span>
                        </div>
                        {difficulties.map((difficulty) => (
                          <RoutingCellEditor
                            ariaLabel={`${category[locale]} ${difficulty[locale]}`}
                            columnLabel={difficulty[locale]}
                            key={difficulty.id}
                            locale={locale}
                            models={models}
                            onChange={(modelRef) => updateRoute(category.id, difficulty.id, modelRef)}
                            value={routes[category.id][difficulty.id].modelRefs[0] ?? ""}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {models.some((model) => model.pricingStatus === "unavailable") ? (
              <div className="tenant-routing-mock-warning"><AlertTriangle aria-hidden="true" /><div><strong>{text.model}</strong><span>{text.priceUnknown}</span></div></div>
            ) : null}

            <div className="tenant-routing-actions">
              <button className="secondary-button tenant-routing-reset-button" disabled={pending || loading} onClick={resetDraft} type="button">{text.reset}</button>
              <button className="primary-button tenant-routing-save-button" data-save-confirmed={feedback?.published ? "true" : undefined} disabled={!canPublish || pending || loading} type="submit">
                {pending ? <LoaderCircle className="animate-spin" /> : feedback?.published ? <Check aria-hidden="true" /> : null}
                {pending ? text.publishing : feedback?.published ? text.active : text.publish}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

function RoutingCellEditor({ ariaLabel, columnLabel, locale, models, onChange, value }: {
  ariaLabel: string;
  columnLabel: string;
  locale: Locale;
  models: RoutingModelOption[];
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="tenant-routing-route tenant-routing-model-ref-cell" data-column-label={columnLabel} role="cell">
      <TenantRoutingModelSelect ariaLabel={ariaLabel} locale={locale} models={models} onChange={onChange} value={value} />
    </div>
  );
}

function TenantRoutingModelSelect({ ariaLabel, className, locale, models, onChange, value }: {
  ariaLabel: string;
  className?: string;
  locale: Locale;
  models: RoutingModelOption[];
  onChange: (value: string) => void;
  value: string;
}) {
  const selected = models.find((model) => model.modelRef === value);
  return (
    <label className={`tenant-routing-model-choice ${className ?? ""}`.trim()}>
      <ProviderFamilyIcon
        className="tenant-routing-provider-icon tenant-routing-provider-icon-large"
        family={selected?.providerFamily ?? "unknown"}
        size={36}
      />
      <span className="tenant-routing-model-choice-copy">
        <span className="tenant-routing-model-provider">{selected?.providerName ?? copy[locale].modelUnavailable}</span>
        <select aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)} value={value}>
          <UnavailableModelOption locale={locale} models={models} value={value} />
          {models.map((model) => <option key={model.modelRef} value={model.modelRef}>{model.label}</option>)}
        </select>
      </span>
    </label>
  );
}

function UnavailableModelOption({ locale, models, value }: {
  locale: Locale;
  models: Array<{ modelRef: string }>;
  value: string;
}) {
  if (models.some((model) => model.modelRef === value)) return null;
  return <option disabled value={value}>{copy[locale].modelUnavailable}</option>;
}

function firstModelRef(setup: TenantChatAdminRuntimeSetup | null) {
  return setup?.providers.flatMap((provider) => provider.models)[0]?.modelRef ?? "";
}

function uniformRoutingMatrix(modelRef: string): TenantChatRoutingMatrix {
  const cell = () => ({ modelRefs: modelRef ? [modelRef] : [] });
  return { general: { simple: cell(), complex: cell() }, code: { simple: cell(), complex: cell() }, translation: { simple: cell(), complex: cell() }, summarization: { simple: cell(), complex: cell() }, reasoning: { simple: cell(), complex: cell() } };
}

function matrixUsesOnly(routes: TenantChatRoutingMatrix, available: Set<string>) {
  return categories.every((category) => difficulties.every((difficulty) => {
    const refs = routes[category.id][difficulty.id].modelRefs;
    return refs.length >= 1 && refs.length <= 4 && refs.every((ref) => available.has(ref));
  }));
}

function applySetup(next: TenantChatAdminRuntimeSetup, setSetup: (value: TenantChatAdminRuntimeSetup) => void, setMode: (value: TenantChatRoutingMode) => void, setManual: (value: string) => void, setRoutes: (value: TenantChatRoutingMatrix) => void) {
  const modelRef = next.activeSnapshot?.manualModelRef ?? firstModelRef(next);
  setSetup(next);
  setMode(next.activeSnapshot?.routingMode ?? "auto");
  setManual(modelRef);
  setRoutes(next.activeSnapshot?.routes ?? uniformRoutingMatrix(modelRef));
}

async function loadSetup(tenantId: string): Promise<{ data: TenantChatAdminRuntimeSetup; ok: true } | { error: string; ok: false }> {
  try {
    const response = await fetch(`/api/control-plane/tenant-chat-runtime?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as unknown;
    return response.ok && isRuntimeSetup(payload) ? { data: payload, ok: true } : { error: readPayloadError(payload, "Chat App policy load failed."), ok: false };
  } catch { return { error: "Control Plane unavailable.", ok: false }; }
}

function ReadinessBadge({ readiness, locale }: { readiness: TenantChatAdminRuntimeSetup["readiness"]; locale: Locale }) {
  const labels: Record<TenantChatAdminRuntimeSetup["readiness"], Record<Locale, string>> = { degraded: { en: "Degraded", ko: "확인 필요" }, needs_activation: { en: "Publish needed", ko: "발행 필요" }, needs_model: { en: "Model needed", ko: "모델 필요" }, needs_provider: { en: "Provider needed", ko: "Provider 필요" }, ready: { en: "Ready", ko: "적용됨" } };
  return <Badge variant={readiness === "ready" ? "success" : readiness === "degraded" ? "destructive" : "warning"}>{labels[readiness][locale]}</Badge>;
}

function readPayloadError(payload: unknown, fallback: string) {
  const error = payload && typeof payload === "object" ? (payload as Record<string, unknown>).error : null;
  return typeof error === "string" && error.trim() ? error : fallback;
}
function isRuntimeSetup(value: unknown): value is TenantChatAdminRuntimeSetup {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  return Boolean(record && Array.isArray(record.providers) && typeof record.readiness === "string");
}
