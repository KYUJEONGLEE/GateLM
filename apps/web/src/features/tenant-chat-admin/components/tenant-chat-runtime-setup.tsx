"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDollarSign,
  LoaderCircle,
  MessageSquareText,
  PlugZap,
  RefreshCw
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import { getTenantChatReturnPath } from "@/features/provider-connections/tenant-chat-setup-return";
import {
  getTenantChatSetupStep,
  selectTenantChatModelKey,
  selectTenantChatProviderId
} from "@/features/tenant-chat-admin/tenant-chat-runtime-setup-model";
import type {
  TenantChatAdminProviderCandidate,
  TenantChatAdminRuntimeSetup
} from "@/lib/control-plane/tenant-chat-runtime-types";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

type TenantChatRuntimeSetupProps = {
  initialLoadError: string | null;
  initialSetup: TenantChatAdminRuntimeSetup | null;
  locale: Locale;
  onboardingReturn?: boolean;
  requestedProviderConnectionId?: string;
  tenantId: string;
};

type Feedback = {
  message: string;
  status: "error" | "idle" | "success";
};

const copy = {
  en: {
    activate: "Activate Tenant Chat",
    activating: "Activating…",
    active: "Active runtime",
    breadcrumbManagement: "Management",
    breadcrumbTitle: "Tenant Chat",
    cacheRead: "Cached input",
    configureProvider: "Register or edit provider",
    degraded: "The active runtime cannot be mapped to an active tenant Provider. Review the Provider connection before publishing again.",
    description: "Choose a tenant Provider and an exactly priced model, then publish an immutable RuntimeSnapshot.",
    input: "Input",
    loadError: "Tenant Chat runtime setup could not be loaded.",
    model: "Model",
    modelMissing: "This Provider has no configured chat models. Add models in Provider management, then return here.",
    noProvider: "Register an active tenant-level Provider connection to start Tenant Chat.",
    output: "Output",
    pricingUnavailable: "Standard text pricing cannot be represented exactly, so activation is disabled.",
    provider: "Provider",
    publishSummary: "Activation summary",
    ready: "Tenant Chat is ready. Reloading this page restores the active Provider and model.",
    refresh: "Try again",
    stepActivate: "Activate runtime",
    stepModel: "Choose model",
    stepProvider: "Choose provider",
    title: "Tenant Chat setup",
    version: "Snapshot v"
  },
  ko: {
    activate: "Tenant Chat 활성화",
    activating: "활성화 중…",
    active: "활성 Runtime",
    breadcrumbManagement: "관리",
    breadcrumbTitle: "Tenant Chat",
    cacheRead: "캐시 입력",
    configureProvider: "Provider 등록·편집",
    degraded: "활성 Runtime을 현재 tenant-level Provider와 연결할 수 없습니다. Provider 연결을 확인한 뒤 다시 발행하세요.",
    description: "tenant-level Provider와 정확한 가격을 지원하는 모델을 선택해 immutable RuntimeSnapshot을 발행합니다.",
    input: "입력",
    loadError: "Tenant Chat Runtime 설정을 불러오지 못했습니다.",
    model: "모델",
    modelMissing: "이 Provider에 설정된 chat 모델이 없습니다. Provider 관리에서 모델을 추가한 뒤 돌아오세요.",
    noProvider: "Tenant Chat을 시작하려면 활성 tenant-level Provider 연결을 등록하세요.",
    output: "출력",
    pricingUnavailable: "표준 text 가격을 정확히 표현할 수 없어 활성화할 수 없습니다.",
    provider: "Provider",
    publishSummary: "활성화 요약",
    ready: "Tenant Chat이 준비되었습니다. 새로고침해도 활성 Provider와 모델이 복원됩니다.",
    refresh: "다시 시도",
    stepActivate: "Runtime 활성화",
    stepModel: "모델 선택",
    stepProvider: "Provider 선택",
    title: "Tenant Chat 설정",
    version: "Snapshot v"
  }
} satisfies Record<Locale, Record<string, string>>;

export function TenantChatRuntimeSetup({
  initialLoadError,
  initialSetup,
  locale,
  onboardingReturn = false,
  requestedProviderConnectionId,
  tenantId
}: TenantChatRuntimeSetupProps) {
  const text = copy[locale];
  const returnPath = getTenantChatReturnPath(tenantId);
  const [setup, setSetup] = useState(initialSetup);
  const [loadError, setLoadError] = useState(initialLoadError);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ message: "", status: "idle" });
  const [selectedProviderId, setSelectedProviderId] = useState(() =>
    selectTenantChatProviderId(initialSetup, requestedProviderConnectionId)
  );
  const [selectedModelKey, setSelectedModelKey] = useState(() =>
    selectTenantChatModelKey(
      initialSetup,
      selectTenantChatProviderId(initialSetup, requestedProviderConnectionId)
    )
  );

  const provider = useMemo(
    () => setup?.providers.find((candidate) => candidate.providerConnectionId === selectedProviderId) ?? null,
    [selectedProviderId, setup]
  );
  const model = provider?.models.find((candidate) => candidate.modelKey === selectedModelKey) ?? null;
  const providerManagementHref = `/tenants/${encodeURIComponent(tenantId)}/provider-connections?${new URLSearchParams({
    intent: "tenant-chat-setup",
    returnTo: returnPath
  }).toString()}`;

  useEffect(() => {
    if (!onboardingReturn && !requestedProviderConnectionId) {
      return;
    }
    let current = true;
    setLoading(true);
    void fetch(
      `/api/control-plane/tenant-chat-runtime?tenantId=${encodeURIComponent(tenantId)}`,
      { cache: "no-store" }
    )
      .then(async (response) => ({
        payload: (await response.json().catch(() => ({}))) as unknown,
        response
      }))
      .then(({ payload, response }) => {
        if (!current) {
          return;
        }
        if (!response.ok || !isRuntimeSetup(payload)) {
          setLoadError(readPayloadError(payload, text.loadError));
          return;
        }
        const preferredProviderId = selectTenantChatProviderId(payload, requestedProviderConnectionId);
        setSetup(payload);
        setLoadError(null);
        setSelectedProviderId(preferredProviderId);
        setSelectedModelKey(selectTenantChatModelKey(payload, preferredProviderId));
      })
      .catch(() => {
        if (current) {
          setLoadError(text.loadError);
        }
      })
      .finally(() => {
        if (current) {
          setLoading(false);
          window.history.replaceState(window.history.state, "", returnPath);
        }
      });
    return () => {
      current = false;
    };
  }, [onboardingReturn, requestedProviderConnectionId, returnPath, tenantId, text.loadError]);

  async function refreshSetup() {
    setLoading(true);
    setFeedback({ message: "", status: "idle" });
    const response = await fetch(
      `/api/control-plane/tenant-chat-runtime?tenantId=${encodeURIComponent(tenantId)}`,
      { cache: "no-store" }
    );
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok || !isRuntimeSetup(payload)) {
      setLoadError(readPayloadError(payload, text.loadError));
      setLoading(false);
      return;
    }
    const nextProviderId = selectTenantChatProviderId(payload, selectedProviderId);
    setSetup(payload);
    setLoadError(null);
    setSelectedProviderId(nextProviderId);
    setSelectedModelKey(selectTenantChatModelKey(payload, nextProviderId));
    setLoading(false);
  }

  async function activateRuntime() {
    if (!provider || !model || model.activationStatus !== "available") {
      return;
    }
    setPending(true);
    setFeedback({ message: "", status: "idle" });
    const response = await fetch(
      `/api/control-plane/tenant-chat-runtime?tenantId=${encodeURIComponent(tenantId)}`,
      {
        body: JSON.stringify({
          modelKey: model.modelKey,
          providerConnectionId: provider.providerConnectionId
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      }
    );
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok || !isRuntimeSetup(payload)) {
      setFeedback({
        message: readPayloadError(payload, "Tenant Chat activation failed."),
        status: "error"
      });
      setPending(false);
      return;
    }
    setSetup(payload);
    setSelectedProviderId(payload.activeSnapshot?.providerConnectionId ?? selectedProviderId);
    setSelectedModelKey(payload.activeSnapshot?.modelKey ?? selectedModelKey);
    setFeedback({ message: text.ready, status: "success" });
    setPending(false);
  }

  function chooseProvider(candidate: TenantChatAdminProviderCandidate) {
    setSelectedProviderId(candidate.providerConnectionId);
    setSelectedModelKey(
      setup?.activeSnapshot?.providerConnectionId === candidate.providerConnectionId &&
        candidate.models.some((item) => item.modelKey === setup.activeSnapshot?.modelKey)
        ? (setup.activeSnapshot?.modelKey ?? "")
        : (candidate.models.find((item) => item.activationStatus === "available")?.modelKey ?? "")
    );
    setFeedback({ message: "", status: "idle" });
  }

  const readiness = setup?.readiness ?? "degraded";
  const hasProvider = Boolean(provider);
  const hasAvailableModel = model?.activationStatus === "available";
  const step = getTenantChatSetupStep({
    hasAvailableModel: Boolean(hasAvailableModel),
    hasProvider,
    readiness
  });

  return (
    <main className="console-content management-line-content space-y-5">
      <Breadcrumb
        items={[
          { label: text.breadcrumbManagement },
          { label: text.breadcrumbTitle }
        ]}
      />
      <section className="dashboard-hero flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2>{text.title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{text.description}</p>
        </div>
        <ReadinessBadge readiness={readiness} locale={locale} />
      </section>

      <ol aria-label={locale === "ko" ? "Tenant Chat 설정 단계" : "Tenant Chat setup steps"} className="grid gap-2 sm:grid-cols-3">
        {[text.stepProvider, text.stepModel, text.stepActivate].map((label, index) => {
          const number = index + 1;
          const completed = number < step || (number === 3 && readiness === "ready");
          const current = number === step && !completed;
          return (
            <li
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
                completed && "border-success-border bg-success-soft text-success-text",
                current && "border-primary bg-primary/5"
              )}
              key={label}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                {completed ? <Check aria-hidden="true" className="size-3.5" /> : number}
              </span>
              <span className="font-medium">{label}</span>
            </li>
          );
        })}
      </ol>

      {loadError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{text.loadError}</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button disabled={loading} onClick={() => void refreshSetup()} size="sm" variant="outline">
              {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
              {text.refresh}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {readiness === "degraded" && !loadError ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{text.degraded}</AlertDescription>
        </Alert>
      ) : null}
      <div aria-live="polite" className="min-h-0">
        {feedback.message ? (
          <Alert variant={feedback.status === "error" ? "destructive" : "success"}>
            {feedback.status === "success" ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {!setup || setup.providers.length === 0 ? (
        <EmptyState
          action={
            <Link className={buttonVariants()} href={providerManagementHref}>
              <PlugZap aria-hidden="true" />
              {text.configureProvider}
            </Link>
          }
          description={text.noProvider}
          icon={PlugZap}
          title={text.stepProvider}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>{text.stepProvider}</CardTitle>
                <CardDescription>{text.provider}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label={text.provider}>
                  {setup.providers.map((candidate) => {
                    const selected = candidate.providerConnectionId === selectedProviderId;
                    return (
                      <button
                        aria-checked={selected}
                        className={cn(
                          "flex min-w-0 items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                          selected && "border-primary bg-primary/5"
                        )}
                        key={candidate.providerConnectionId}
                        onClick={() => chooseProvider(candidate)}
                        role="radio"
                        type="button"
                      >
                        <ProviderFamilyIcon
                          className="shrink-0"
                          family={candidate.providerFamily}
                          size={28}
                        />
                        <span className="min-w-0 flex-1">
                          <strong className="block break-words">{candidate.displayName}</strong>
                          <span className="block truncate text-xs text-muted-foreground">{candidate.providerKey}</span>
                        </span>
                        {selected ? <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-primary" /> : null}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{text.stepModel}</CardTitle>
                <CardDescription>{provider?.displayName ?? text.model}</CardDescription>
              </CardHeader>
              <CardContent>
                {!provider || provider.models.length === 0 ? (
                  <EmptyState
                    action={<Link className={buttonVariants({ variant: "outline" })} href={providerManagementHref}>{text.configureProvider}</Link>}
                    description={text.modelMissing}
                    icon={MessageSquareText}
                    title={text.model}
                  />
                ) : (
                  <div className="space-y-2" role="radiogroup" aria-label={text.model}>
                    {provider.models.map((candidate) => {
                      const disabled = candidate.activationStatus !== "available";
                      const selected = candidate.modelKey === selectedModelKey;
                      return (
                        <button
                          aria-checked={selected}
                          className={cn(
                            "flex w-full min-w-0 items-start gap-3 rounded-xl border p-4 text-left transition-colors enabled:hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-65",
                            selected && "border-primary bg-primary/5"
                          )}
                          disabled={disabled}
                          key={candidate.modelKey}
                          onClick={() => {
                            setSelectedModelKey(candidate.modelKey);
                            setFeedback({ message: "", status: "idle" });
                          }}
                          role="radio"
                          type="button"
                        >
                          <span className="min-w-0 flex-1">
                            <strong className="block break-all">{candidate.modelKey}</strong>
                            {candidate.pricing ? (
                              <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>{text.input} {formatPrice(candidate.pricing.inputMicroUsdPerMillionTokens, locale)}</span>
                                <span>{text.output} {formatPrice(candidate.pricing.outputMicroUsdPerMillionTokens, locale)}</span>
                                {candidate.pricing.cacheReadInputMicroUsdPerMillionTokens !== undefined ? (
                                  <span>{text.cacheRead} {formatPrice(candidate.pricing.cacheReadInputMicroUsdPerMillionTokens, locale)}</span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="mt-1 block text-xs text-warning-text">{text.pricingUnavailable}</span>
                            )}
                          </span>
                          {disabled ? <Badge variant="warning">pricing unavailable</Badge> : selected ? <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-primary" /> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>{text.publishSummary}</CardTitle>
                <CardDescription>{text.stepActivate}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-3 text-sm">
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                    <dt className="text-muted-foreground">{text.provider}</dt>
                    <dd className="break-words font-medium">{provider?.displayName ?? "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                    <dt className="text-muted-foreground">{text.model}</dt>
                    <dd className="break-all font-medium">{model?.modelKey ?? "-"}</dd>
                  </div>
                </dl>
                <Button className="w-full" disabled={!hasAvailableModel || pending || loading} onClick={() => void activateRuntime()}>
                  {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <CircleDollarSign aria-hidden="true" />}
                  {pending ? text.activating : text.activate}
                </Button>
              </CardContent>
            </Card>

            {setup.activeSnapshot ? (
              <Card className="border-success-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="size-4 text-success" />{text.active}</CardTitle>
                  <CardDescription>{text.version}{setup.activeSnapshot.version}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="break-all font-medium">{setup.activeSnapshot.modelKey}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={setup.activeSnapshot.pricingStatus === "current" ? "success" : "warning"}>{setup.activeSnapshot.pricingStatus}</Badge>
                    <Badge variant="outline">policy v{setup.activeSnapshot.policyVersion}</Badge>
                    <Badge variant="outline">pricing v{setup.activeSnapshot.pricingVersion}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatPublishedAt(setup.activeSnapshot.publishedAt, locale)}</p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}

function ReadinessBadge({ readiness, locale }: { readiness: TenantChatAdminRuntimeSetup["readiness"]; locale: Locale }) {
  const labels: Record<TenantChatAdminRuntimeSetup["readiness"], Record<Locale, string>> = {
    degraded: { en: "Degraded", ko: "확인 필요" },
    needs_activation: { en: "Activation needed", ko: "활성화 필요" },
    needs_model: { en: "Model needed", ko: "모델 필요" },
    needs_provider: { en: "Provider needed", ko: "Provider 필요" },
    ready: { en: "Ready", ko: "준비됨" }
  };
  return <Badge variant={readiness === "ready" ? "success" : readiness === "degraded" ? "destructive" : "warning"}>{labels[readiness][locale]}</Badge>;
}

function formatPrice(value: number, locale: Locale) {
  const amount = value / 1_000_000;
  return `${new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    style: "currency"
  }).format(amount)} / 1M`;
}

function formatPublishedAt(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}

function readPayloadError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }
  return fallback;
}

function isRuntimeSetup(value: unknown): value is TenantChatAdminRuntimeSetup {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.providers) &&
    (record.readiness === "needs_provider" ||
      record.readiness === "needs_model" ||
      record.readiness === "needs_activation" ||
      record.readiness === "ready" ||
      record.readiness === "degraded")
  );
}
