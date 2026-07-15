"use client";

import { AlertTriangle, CheckCircle2, LoaderCircle, MessageSquareText, PlugZap, RefreshCw, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getTenantChatReturnPath } from "@/features/provider-connections/tenant-chat-setup-return";
import type {
  TenantChatAdminRuntimeSetup,
  TenantChatRoutingCategory,
  TenantChatRoutingDifficulty,
  TenantChatRoutingMatrix,
  TenantChatRoutingMode
} from "@/lib/control-plane/tenant-chat-runtime-types";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

type Props = {
  initialLoadError: string | null;
  initialSetup: TenantChatAdminRuntimeSetup | null;
  locale: Locale;
  onboardingReturn?: boolean;
  requestedProviderConnectionId?: string;
  tenantId: string;
};

const categories: Array<{ id: TenantChatRoutingCategory; en: string; ko: string }> = [
  { id: "general", en: "General", ko: "일반" },
  { id: "code", en: "Code", ko: "코드" },
  { id: "translation", en: "Translation", ko: "번역" },
  { id: "summarization", en: "Summarization", ko: "요약" },
  { id: "reasoning", en: "Reasoning", ko: "추론" }
];
const difficulties: Array<{ id: TenantChatRoutingDifficulty; en: string; ko: string }> = [
  { id: "simple", en: "Simple", ko: "단순" },
  { id: "complex", en: "Complex", ko: "복잡" }
];

const copy = {
  en: {
    active: "Active runtime",
    auto: "Automatic routing",
    autoDescription: "Classify messages into five workloads and simple or complex, then use the model assigned to that cell.",
    breadcrumb: "Chat App",
    configureProvider: "Register or edit provider",
    degraded: "The active runtime references a provider or model that is no longer available. Review and publish again.",
    description: "Manage the built-in Tenant Chat app and publish its immutable 5 × 2 routing policy.",
    loadError: "The Chat App policy could not be loaded.",
    manual: "Fixed model",
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
    routing: "Routing policy",
    routingDescription: "Each cell is an explicit modelRef assignment. Difficulty is independent from budget or quota state.",
    title: "Chat App",
    version: "Snapshot v"
  },
  ko: {
    active: "현재 적용 중",
    auto: "자동 라우팅",
    autoDescription: "메시지를 5개 작업 유형과 단순·복잡 난이도로 분류한 뒤 해당 셀에 지정한 모델을 사용합니다.",
    breadcrumb: "채팅 앱",
    configureProvider: "Provider 등록 또는 수정",
    degraded: "현재 Runtime이 더 이상 사용할 수 없는 Provider 또는 모델을 참조합니다. 정책을 확인한 뒤 다시 발행하세요.",
    description: "내장 Tenant Chat 앱과 실제 실행되는 5 × 2 라우팅 정책을 관리합니다.",
    loadError: "채팅 앱 정책을 불러오지 못했습니다.",
    manual: "고정 모델",
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
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const initialRef = firstModelRef(initialSetup);
  const [routingMode, setRoutingMode] = useState<TenantChatRoutingMode>(initialSetup?.activeSnapshot?.routingMode ?? "auto");
  const [manualModelRef, setManualModelRef] = useState(initialSetup?.activeSnapshot?.manualModelRef ?? initialRef);
  const [routes, setRoutes] = useState<TenantChatRoutingMatrix>(initialSetup?.activeSnapshot?.routes ?? uniformRoutingMatrix(initialRef));

  const models = useMemo(
    () => (setup?.providers ?? []).flatMap((provider) => provider.models.map((model) => ({ ...model, label: `${provider.displayName} · ${model.modelKey}` }))),
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
      setFeedback({ error: false, message: text.ready });
    }
    setPending(false);
  }

  function updateRoute(category: TenantChatRoutingCategory, difficulty: TenantChatRoutingDifficulty, modelRef: string) {
    setRoutes((current) => ({
      ...current,
      [category]: { ...current[category], [difficulty]: { modelRefs: [modelRef] } }
    }));
    setFeedback(null);
  }

  const readiness = setup?.readiness ?? "degraded";
  const refs = new Set(models.map((model) => model.modelRef));
  const canPublish = refs.has(manualModelRef) && matrixUsesOnly(routes, refs);

  return (
    <main className="console-content management-line-content space-y-5">
      <Breadcrumb items={[{ label: locale === "ko" ? "관리" : "Management" }, { label: text.breadcrumb }]} />
      <section className="dashboard-hero flex flex-wrap items-start justify-between gap-4">
        <div><h2>{text.title}</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{text.description}</p></div>
        <ReadinessBadge readiness={readiness} locale={locale} />
      </section>

      {loadError ? <Alert variant="destructive"><AlertTriangle /><AlertTitle>{text.loadError}</AlertTitle><AlertDescription><p>{loadError}</p><Button disabled={loading} onClick={() => void refresh()} size="sm" variant="outline">{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{text.refresh}</Button></AlertDescription></Alert> : null}
      {readiness === "degraded" && !loadError ? <Alert variant="warning"><AlertTriangle /><AlertDescription>{text.degraded}</AlertDescription></Alert> : null}
      {feedback ? <Alert variant={feedback.error ? "destructive" : "success"}>{feedback.error ? <AlertTriangle /> : <CheckCircle2 />}<AlertDescription>{feedback.message}</AlertDescription></Alert> : null}

      {!setup?.providers.length ? (
        <EmptyState action={<Link className={buttonVariants()} href={providerManagementHref}><PlugZap />{text.configureProvider}</Link>} description={text.noProvider} icon={PlugZap} title={text.title} />
      ) : models.length === 0 ? (
        <EmptyState action={<Link className={buttonVariants()} href={providerManagementHref}>{text.configureProvider}</Link>} description={text.noModel} icon={MessageSquareText} title={text.model} />
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{text.routing}</CardTitle><CardDescription>{text.routingDescription}</CardDescription></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={text.routing}>
                {([["auto", text.auto, text.autoDescription], ["manual", text.manual, text.manualDescription]] as const).map(([mode, label, description]) => (
                  <button aria-checked={routingMode === mode} className={cn("rounded-xl border p-4 text-left transition-colors hover:bg-muted/60", routingMode === mode && "border-primary bg-primary/5")} key={mode} onClick={() => setRoutingMode(mode)} role="radio" type="button">
                    <strong className="block">{label}</strong><span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                  </button>
                ))}
              </div>

              <ModelSelect label={text.manual} locale={locale} models={models} onChange={setManualModelRef} value={manualModelRef} />

              <div className={cn("overflow-x-auto", routingMode === "manual" && "opacity-60")}>
                <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
                  <thead><tr><th className="border-b p-3 text-left">{locale === "ko" ? "작업 유형" : "Workload"}</th>{difficulties.map((item) => <th className="border-b p-3 text-left" key={item.id}>{item[locale]}</th>)}</tr></thead>
                  <tbody>{categories.map((category) => (
                    <tr key={category.id}><th className="border-b p-3 text-left font-medium">{category[locale]}</th>{difficulties.map((difficulty) => (
                      <td className="border-b p-3" key={difficulty.id}>
                        <select
                          aria-label={`${category[locale]} ${difficulty[locale]}`}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          disabled={routingMode === "manual"}
                          onChange={(event) => updateRoute(category.id, difficulty.id, event.target.value)}
                          value={routes[category.id][difficulty.id].modelRefs[0] ?? ""}
                        >
                          <UnavailableModelOption
                            locale={locale}
                            models={models}
                            value={routes[category.id][difficulty.id].modelRefs[0] ?? ""}
                          />
                          {models.map((model) => <option key={model.modelRef} value={model.modelRef}>{model.label}</option>)}
                        </select>
                      </td>
                    ))}</tr>
                  ))}</tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{models.some((model) => model.pricingStatus === "unavailable") ? text.priceUnknown : ""}</p><Button disabled={!canPublish || pending || loading} onClick={() => void publish()}>{pending ? <LoaderCircle className="animate-spin" /> : <Save />}{pending ? text.publishing : text.publish}</Button></div>
            </CardContent>
          </Card>

          {setup.activeSnapshot ? <Card className="border-success-border"><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" />{text.active}</CardTitle><CardDescription>{text.version}{setup.activeSnapshot.version}</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2 text-sm"><Badge variant="success">{setup.activeSnapshot.routingMode}</Badge><Badge variant={setup.activeSnapshot.pricingStatus === "current" ? "success" : "warning"}>{setup.activeSnapshot.pricingStatus}</Badge><Badge variant="outline">policy v{setup.activeSnapshot.policyVersion}</Badge><Badge variant="outline">pricing v{setup.activeSnapshot.pricingVersion}</Badge><span className="w-full text-xs text-muted-foreground">{formatPublishedAt(setup.activeSnapshot.publishedAt, locale)}</span></CardContent></Card> : null}
        </div>
      )}
    </main>
  );
}

function ModelSelect({ label, locale, models, onChange, value }: {
  label: string;
  locale: Locale;
  models: Array<{ label: string; modelRef: string; pricing: { inputMicroUsdPerMillionTokens: number; outputMicroUsdPerMillionTokens: number } | null; pricingStatus: "available" | "unavailable" }>;
  onChange: (value: string) => void;
  value: string;
}) {
  const selected = models.find((model) => model.modelRef === value);
  return <div className="space-y-2"><label className="text-sm font-medium" htmlFor="chat-app-manual-model">{label}</label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" id="chat-app-manual-model" onChange={(event) => onChange(event.target.value)} value={value}><UnavailableModelOption locale={locale} models={models} value={value} />{models.map((model) => <option key={model.modelRef} value={model.modelRef}>{model.label}</option>)}</select>{selected?.pricing ? <p className="text-xs text-muted-foreground">input {formatPrice(selected.pricing.inputMicroUsdPerMillionTokens, locale)} · output {formatPrice(selected.pricing.outputMicroUsdPerMillionTokens, locale)}</p> : selected?.pricingStatus === "unavailable" ? <p className="text-xs text-warning-text">{copy[locale].priceUnknown}</p> : null}</div>;
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

function formatPrice(value: number, locale: Locale) {
  return `${new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", { currency: "USD", maximumFractionDigits: 4, style: "currency" }).format(value / 1_000_000)} / 1M`;
}
function formatPublishedAt(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function readPayloadError(payload: unknown, fallback: string) {
  const error = payload && typeof payload === "object" ? (payload as Record<string, unknown>).error : null;
  return typeof error === "string" && error.trim() ? error : fallback;
}
function isRuntimeSetup(value: unknown): value is TenantChatAdminRuntimeSetup {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  return Boolean(record && Array.isArray(record.providers) && typeof record.readiness === "string");
}
