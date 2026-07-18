"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  Code2,
  FileText,
  Info,
  Languages,
  LoaderCircle,
  MessageSquareMore,
  MessageSquareText,
  PlugZap,
  RefreshCcw,
  RefreshCw
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { ManagementPage } from "@/components/layout/management-page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Switch } from "@/components/ui/switch";
import { KnowledgeBaseManagement } from "@/features/rag-documents/knowledge-base-management";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import {
  CachePolicyControls,
  type CachePolicyControlsText
} from "@/features/policies/components/runtime-policy-panels/cache-panel";
import {
  SafetyDetectorPolicyControls,
  type SafetyDetectorPolicyText
} from "@/features/policies/components/runtime-policy-panels/safety-panel";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import { getTenantChatReturnPath } from "@/features/provider-connections/tenant-chat-setup-return";
import {
  applyTenantChatSharedFallbackModelRef,
  getTenantChatFallbackExcludedModelRefs,
  selectTenantChatSharedFallbackModelRef,
  updateTenantChatPrimaryModelRef
} from "@/features/tenant-chat-admin/tenant-chat-runtime-setup-model";
import type {
  TenantChatAdminRuntimeSetup,
  TenantChatAdminCachePolicy,
  TenantChatAdminQuotaPolicy,
  TenantChatAdminSafetyPolicy,
  TenantChatRoutingCategory,
  TenantChatRoutingDifficulty,
  TenantChatRoutingMatrix,
  TenantChatRoutingMode
} from "@/lib/control-plane/tenant-chat-runtime-types";
import type { TenantRagDocument } from "@/lib/control-plane/rag-documents-types";
import type { TenantRagKnowledgeBaseSettings } from "@/lib/control-plane/rag-knowledge-base-types";
import type { RuntimePolicyDetector } from "@/lib/control-plane/runtime-policy-types";
import type { Locale } from "@/lib/i18n/locale";

type Props = {
  canManageKnowledgeBase?: boolean;
  initialDocuments?: TenantRagDocument[];
  initialDocumentsError?: string | null;
  initialKnowledgeBaseSettings?: TenantRagKnowledgeBaseSettings | null;
  initialKnowledgeBaseSettingsError?: string | null;
  initialLoadError: string | null;
  initialPolicySection?: ChatAppPolicySection;
  initialSetup: TenantChatAdminRuntimeSetup | null;
  locale: Locale;
  onboardingReturn?: boolean;
  requestedProviderConnectionId?: string;
  tenantId: string;
};

type DifficultyCriteria = Record<Locale, {
  complex: string;
  complexExample: string;
  simple: string;
  simpleExample: string;
}>;

const categories = [
  {
    icon: MessageSquareMore,
    id: "general",
    en: "General",
    ko: "일반",
    criteria: {
      en: { simple: "At most one workflow or branch signal, no more than three extraction fields, and no cross-source synthesis.", simpleExample: "Explain OAuth briefly.", complex: "Two or more workflow stages or branches, four or more extraction fields, or cross-source synthesis.", complexExample: "Split the work into preparation, execution, and verification, with an owner and completion criteria for each stage." },
      ko: { simple: "흐름·분기 신호가 각각 1개 이하이고 추출 항목이 3개 이하이며 여러 자료를 종합하지 않습니다.", simpleExample: "OAuth를 짧게 설명해줘", complex: "흐름 단계나 분기가 2개 이상, 추출 항목이 4개 이상이거나 여러 자료를 종합합니다.", complexExample: "업무를 준비, 실행, 확인 단계로 나누고 각 단계의 담당자와 완료 조건을 정해줘" }
    }
  },
  {
    icon: Code2,
    id: "code",
    en: "Code",
    ko: "코드",
    criteria: {
      en: { simple: "Syntax, examples, small edits, or a single debug/refactor request without another complexity signal.", simpleExample: "Fix the syntax error in this one function.", complex: "Design, migration, performance, concurrency, three or more scopes, causal debugging, or at least two engineering constraints.", complexExample: "Find the reproduction conditions and possible cause, then design a fix and regression test." },
      ko: { simple: "문법·예시·작은 수정이거나, 다른 고성능 분류 신호가 없는 단일 디버그·리팩터링 요청입니다.", simpleExample: "함수 하나의 문법 오류를 수정해줘", complex: "설계·마이그레이션·성능·동시성, 범위 3개 이상, 원인 추적 또는 기술 제약 2개 이상이 포함됩니다.", complexExample: "재현 조건과 가능한 원인을 좁히고 수정안과 회귀 테스트를 설계해줘" }
    }
  },
  {
    icon: Languages,
    id: "translation",
    en: "Translation",
    ko: "번역",
    criteria: {
      en: { simple: "One translation scope with at most one preservation constraint and no strong domain or localization signal.", simpleExample: "Translate this sentence to Korean.", complex: "Two or more scopes or preservation constraints, legal/medical terminology, or explicit cultural localization.", complexExample: "Translate to Korean while preserving legal terminology, formal tone, tables, and Markdown formatting." },
      ko: { simple: "번역 범위가 1개이고 보존 조건이 1개 이하이며 강한 전문 분야·현지화 신호가 없습니다.", simpleExample: "이 문장을 한국어로 번역해줘", complex: "범위나 보존 조건이 2개 이상이거나 법률·의료 용어 또는 명시적 현지화가 포함됩니다.", complexExample: "법률 용어와 표 형식을 유지해 존댓말로 번역해줘" }
    }
  },
  {
    icon: FileText,
    id: "summarization",
    en: "Summarization",
    ko: "요약",
    criteria: {
      en: { simple: "One direct summary with at most two requested facets and no citation or traceability requirement. Length alone does not make it complex.", simpleExample: "Summarize this note into key points.", complex: "Multiple sources, comparison/synthesis, three or more facets, or citations and traceability.", complexExample: "Compare three documents and summarize their disagreements, evidence, and structure in a table." },
      ko: { simple: "단일 자료를 직접 요약하고 요청 항목이 2개 이하이며 인용·근거 추적 조건이 없습니다. 길이만으로는 고성능으로 분류되지 않습니다.", simpleExample: "이 메모를 핵심 내용으로 요약해줘", complex: "복수 자료, 비교·종합, 요청 항목 3개 이상 또는 인용·근거 추적이 포함됩니다.", complexExample: "세 문서의 충돌점과 근거를 표로 요약해줘" }
    }
  },
  {
    icon: BrainCircuit,
    id: "reasoning",
    en: "Reasoning",
    ko: "추론",
    criteria: {
      en: { simple: "At most two alternatives, one criterion, one reasoning step, and one uncertainty scenario.", simpleExample: "If the switch is on, should I restart it?", complex: "Three or more alternatives or criteria, multi-step reasoning, or at least two uncertainty scenarios.", complexExample: "Compare three alternatives by cost, risk, and schedule constraints." },
      ko: { simple: "대안 2개 이하, 판단 기준·추론 단계·불확실성 시나리오가 각각 1개 이하입니다.", simpleExample: "스위치가 켜져 있으면 재시작해야 할까?", complex: "대안이나 판단 기준이 3개 이상이거나 다단계 추론 또는 불확실성 시나리오가 2개 이상입니다.", complexExample: "세 대안을 비용·위험·일정 제약으로 비교해줘" }
    }
  }
] satisfies Array<{
  criteria: DifficultyCriteria;
  icon: typeof MessageSquareMore;
  id: TenantChatRoutingCategory;
  en: string;
  ko: string;
}>;
const difficulties: Array<{ id: TenantChatRoutingDifficulty; en: string; ko: string }> = [
  { id: "simple", en: "Simple", ko: "일반" },
  { id: "complex", en: "Complex", ko: "고성능" }
];

const routingDifficultyCriteria: DifficultyCriteria = {
  en: {
    simple: "One task, constraint, scope, and dependency step at most, with bounded category-specific signals. Length or a single debug/refactor signal alone does not force complex routing.",
    simpleExample: "A long background followed by one request to state the service window.",
    complex: "Multiple common signals or a category-specific complex signal, except the bounded length/debug/refactor case above. A meaningful but ambiguous request defaults to complex.",
    complexExample: "Investigate the situation and decide the best approach."
  },
  ko: {
    simple: "작업·제약·범위·의존 단계가 각각 1개 이하이고 카테고리별 고성능 분류 신호가 제한적입니다. 길이 또는 단일 디버그·리팩터링 신호만으로는 고성능으로 분류되지 않습니다.",
    simpleExample: "긴 배경 설명 뒤 서비스 운영 시간 하나만 요청",
    complex: "위의 제한된 길이·디버그·리팩터링 예외를 제외하고, 공통 고성능 분류 신호가 여러 개이거나 카테고리별 고성능 분류 신호가 있습니다. 의미는 있지만 판정 근거가 모호하면 고성능으로 처리합니다.",
    complexExample: "상황을 조사하고 최선의 접근 방식을 결정해줘"
  }
};

type RoutingProviderOption = TenantChatAdminRuntimeSetup["providers"][number];
export type ChatAppPolicySection =
  | "routing"
  | "cache"
  | "security"
  | "quota"
  | "knowledge";

const chatAppPolicySections: ChatAppPolicySection[] = [
  "routing",
  "cache",
  "security",
  "quota",
  "knowledge"
];
const MONTHLY_TOKEN_LIMIT_SLIDER_MAX = 10_000_000;
const MONTHLY_TOKEN_LIMIT_SLIDER_STEP = 1_000_000;

function isChatAppPolicySection(value: string | null): value is ChatAppPolicySection {
  return chatAppPolicySections.includes(value as ChatAppPolicySection);
}

const copy = {
  en: {
    active: "Active runtime",
    autoLabel: "Auto",
    modeTitle: "Routing mode",
    breadcrumb: "Chat App",
    cacheTab: "Cache",
    knowledgeTab: "Knowledge Base",
    configureProvider: "Register or edit provider",
    degraded: "The active runtime references a provider or model that is no longer available. Review and publish again.",
    description: "Manage the built-in Tenant Chat app and publish its immutable 5 × 2 routing and cache policy.",
    categoryCriteria: "Simple and complex guidance",
    criteriaNote: "Length alone does not make a request complex. Task count, constraints, scope, dependency steps, and category-specific signals are evaluated together.",
    example: "Example",
    routingCriteria: "Simple and complex routing guidance",
    fallbackDescription: "If the primary model times out or fails before a response starts, retry every routing cell with this model.",
    fallbackDisabled: "Do not use fallback",
    fallbackKicker: "Automatic failover",
    fallbackMixed: "Keep existing per-cell fallback settings",
    fallbackTitle: "Fallback model",
    fixedLabel: "Fixed",
    fixedFallbackDescription: "If the fixed model times out or fails before a response starts, retry with the selected fallback model.",
    loadError: "The Chat App policy could not be loaded.",
    manual: "Fixed model",
    manualDescription: "Use this model for every message without category or difficulty classification.",
    model: "Model",
    modelUnavailable: "Selected model unavailable",
    noModel: "No chat model is configured on an active tenant-level provider.",
    noProvider: "Register an active tenant-level provider to configure the Chat App.",
    provider: "Provider",
    providerUnavailable: "Selected Provider unavailable",
    publish: "Publish Chat App policy",
    publishing: "Publishing…",
    ready: "The Chat App policy is active.",
    refresh: "Try again",
    reset: "Reset",
    resetMessage: "Unsaved changes were reset to the active Chat App policy.",
    routing: "Routing policy",
    routingTab: "Routing",
    routingDescription: "Configure models for the selected routing mode. Automatic assignments are preserved while fixed mode is active.",
    securityTab: "Security",
    title: "Chat App"
  },
  ko: {
    active: "현재 적용 중",
    autoLabel: "자동",
    modeTitle: "라우팅 방식",
    breadcrumb: "채팅 앱",
    cacheTab: "캐시",
    knowledgeTab: "지식 베이스",
    configureProvider: "Provider 등록 또는 수정",
    degraded: "현재 Runtime이 더 이상 사용할 수 없는 Provider 또는 모델을 참조합니다. 정책을 확인한 뒤 다시 발행하세요.",
    description: "내장 Tenant Chat 앱과 실제 실행되는 5 × 2 라우팅 및 캐시 정책을 관리합니다.",
    categoryCriteria: "일반·고성능 안내",
    criteriaNote: "요청 길이만으로는 고성능으로 분류되지 않습니다. 작업 수, 제약, 범위, 의존 단계와 카테고리별 신호를 함께 판단합니다.",
    example: "예시",
    routingCriteria: "라우팅 일반·고성능 안내",
    fallbackDescription: "기본 모델이 응답 시작 전에 실패하거나 시간 초과되면 모든 라우팅 셀에서 이 모델로 다시 시도합니다.",
    fallbackDisabled: "Fallback 사용 안 함",
    fallbackKicker: "장애 시 자동 전환",
    fallbackMixed: "기존 셀별 Fallback 설정 유지",
    fallbackTitle: "Fallback 모델",
    fixedLabel: "고정",
    fixedFallbackDescription: "고정 모델이 응답 시작 전에 실패하거나 시간 초과되면 선택한 Fallback 모델로 다시 시도합니다.",
    loadError: "채팅 앱 정책을 불러오지 못했습니다.",
    manual: "고정 모델",
    manualDescription: "카테고리나 난이도 분류 없이 모든 메시지에 이 모델을 사용합니다.",
    model: "모델",
    modelUnavailable: "선택된 모델 사용 불가",
    noModel: "활성 tenant-level Provider에 채팅 모델이 설정되어 있지 않습니다.",
    noProvider: "채팅 앱을 설정하려면 활성 tenant-level Provider를 등록하세요.",
    provider: "Provider",
    providerUnavailable: "선택된 Provider 사용 불가",
    publish: "채팅 앱 정책 발행",
    publishing: "발행 중…",
    ready: "채팅 앱 정책이 적용되었습니다.",
    refresh: "다시 시도",
    reset: "초기화",
    resetMessage: "저장하지 않은 변경사항을 현재 채팅 앱 정책으로 되돌렸습니다.",
    routing: "라우팅 정책",
    routingTab: "라우팅",
    routingDescription: "선택한 라우팅 방식에 맞춰 모델을 설정합니다. 고정 모드에서도 자동 배정은 그대로 보존됩니다.",
    securityTab: "보안",
    title: "채팅 앱"
  }
} satisfies Record<Locale, Record<string, string>>;

const tenantChatPolicyText = {
  en: {
    blockAction: "Block",
    cacheEnabled: "Cache enabled",
    cacheEnabledHint: "Reuse completed responses for identical Tenant Chat requests before a Provider call.",
    cacheSection: "Cache",
    cacheSettings: "Cache settings",
    close: "Close",
    detectorNames: {
      api_key: "API key",
      authorization_header: "Authorization header",
      email: "Email address",
      jwt: "JWT",
      organization_name: "Organization name",
      person_name: "Person name",
      phone_number: "Phone number",
      postal_address: "Postal address",
      private_key: "Private key",
      resident_registration_number: "Resident registration number"
    },
    detectors: "Safety detectors",
    edit: "Edit",
    enabled: "Enabled",
    mandatoryProtection: "Sensitive data protection",
    mandatoryProtectionHint: "These detectors cannot be disabled.",
    mode: "Mode",
    placeholder: "Placeholder",
    privacyMasking: "Personal data masking",
    redactAction: "Redact",
    semanticCache: "Semantic cache",
    semanticCacheDisabled: "disabled",
    semanticCacheEvidenceOnly: "evidence only"
  },
  ko: {
    blockAction: "차단",
    cacheEnabled: "캐시 사용",
    cacheEnabledHint: "동일한 채팅 앱 요청은 Provider 호출 전에 완료된 기존 응답을 재사용합니다.",
    cacheSection: "캐시",
    cacheSettings: "캐시 설정",
    close: "닫기",
    detectorNames: {
      api_key: "API 키",
      authorization_header: "인증 헤더",
      email: "이메일",
      jwt: "JWT",
      organization_name: "조직명",
      person_name: "이름",
      phone_number: "전화번호",
      postal_address: "주소",
      private_key: "개인 키",
      resident_registration_number: "주민등록번호"
    },
    detectors: "안전 탐지 항목",
    edit: "편집",
    enabled: "사용",
    mandatoryProtection: "중요 민감정보 보호",
    mandatoryProtectionHint: "이 항목은 사용 중지할 수 없습니다.",
    mode: "모드",
    placeholder: "치환 문구",
    privacyMasking: "개인정보 마스킹",
    redactAction: "마스킹",
    semanticCache: "Semantic Cache",
    semanticCacheDisabled: "비활성",
    semanticCacheEvidenceOnly: "근거 전용"
  }
} satisfies Record<Locale, CachePolicyControlsText & SafetyDetectorPolicyText>;

const tenantChatExperimentalPolicyText = {
  en: {
    aiModelMaskingHint: "Use an AI model to review and mask sensitive information missed by rule-based detectors.",
    aiModelMaskingTitle: "AI model masking",
    badge: "Lab",
    semanticCacheHint: "Reuse eligible responses for requests with a similar meaning, even when their text is not identical.",
    semanticCacheTitle: "Semantic cache"
  },
  ko: {
    aiModelMaskingHint: "규칙 기반 탐지에서 놓친 민감정보를 AI 모델이 한 번 더 판별해 마스킹합니다.",
    aiModelMaskingTitle: "AI 모델 마스킹",
    badge: "실험실",
    semanticCacheHint: "문장이 완전히 같지 않아도 의미가 유사한 요청의 기존 응답을 재사용합니다.",
    semanticCacheTitle: "시멘틱 캐시"
  }
} satisfies Record<Locale, Record<string, string>>;

export function ChatAppRoutingSetup({
  canManageKnowledgeBase = false,
  initialDocuments = [],
  initialDocumentsError = null,
  initialKnowledgeBaseSettings = null,
  initialKnowledgeBaseSettingsError = null,
  initialLoadError,
  initialPolicySection = "routing",
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
  const [activePolicySection, setActivePolicySection] =
    useState<ChatAppPolicySection>(
      initialPolicySection === "knowledge" && !canManageKnowledgeBase
        ? "routing"
        : initialPolicySection
    );
  const [feedback, setFeedback] = useState<{ message: string; error: boolean; published?: boolean } | null>(null);
  const initialRef = firstModelRef(initialSetup);
  const [routingMode, setRoutingMode] = useState<TenantChatRoutingMode>(initialSetup?.activeSnapshot?.routingMode ?? "auto");
  const [manualModelRef, setManualModelRef] = useState(initialSetup?.activeSnapshot?.manualModelRef ?? initialRef);
  const [routes, setRoutes] = useState<TenantChatRoutingMatrix>(initialSetup?.activeSnapshot?.routes ?? uniformRoutingMatrix(initialRef));
  const [cachePolicy, setCachePolicy] = useState<TenantChatAdminCachePolicy>(
    initialSetup?.activeSnapshot?.cachePolicy ?? defaultCachePolicy()
  );
  const [detectors, setDetectors] = useState<RuntimePolicyDetector[]>(
    toRuntimePolicyDetectors(initialSetup?.activeSnapshot?.safetyPolicy)
  );
  const initialQuota = initialSetup?.activeSnapshot?.quota ?? defaultQuotaPolicy();
  const [quota, setQuota] = useState<TenantChatAdminQuotaPolicy>(initialQuota);
  const [quotaLimitInput, setQuotaLimitInput] = useState(() =>
    formatMonthlyTokenLimitInput(initialQuota.defaultMonthlyTokenLimit)
  );

  useEffect(() => {
    const nextQuota = setup?.activeSnapshot?.quota ?? defaultQuotaPolicy();
    setQuotaLimitInput(formatMonthlyTokenLimitInput(nextQuota.defaultMonthlyTokenLimit));
  }, [setup?.activeSnapshot?.quota, setup?.activeSnapshot?.version]);
  const [aiModelMaskingPreviewEnabled, setAiModelMaskingPreviewEnabled] = useState(false);
  const [semanticCachePreviewEnabled, setSemanticCachePreviewEnabled] = useState(false);

  useEffect(() => {
    function syncSectionFromHistory() {
      const requested = new URL(window.location.href).searchParams.get("section");
      const section = isChatAppPolicySection(requested) ? requested : "routing";
      setActivePolicySection(
        section === "knowledge" && !canManageKnowledgeBase ? "routing" : section
      );
    }

    window.addEventListener("popstate", syncSectionFromHistory);
    return () => window.removeEventListener("popstate", syncSectionFromHistory);
  }, [canManageKnowledgeBase]);

  const providers = useMemo(
    () => (setup?.providers ?? []).filter((provider) => provider.models.length > 0),
    [setup]
  );
  const models = useMemo(
    () => providers.flatMap((provider) => provider.models),
    [providers]
  );
  const fallbackModelRef = selectTenantChatSharedFallbackModelRef(routes);
  const fallbackExcludedModelRefs = getTenantChatFallbackExcludedModelRefs(
    routes,
    manualModelRef
  );
  const fallbackProviders = providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) => !fallbackExcludedModelRefs.has(model.modelRef)
      )
    }))
    .filter((provider) => provider.models.length > 0);
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
        applySetup(
          result.data,
          setSetup,
          setRoutingMode,
          setManualModelRef,
          setRoutes,
          setCachePolicy,
          setDetectors,
          setQuota
        );
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
      applySetup(
        result.data,
        setSetup,
        setRoutingMode,
        setManualModelRef,
        setRoutes,
        setCachePolicy,
        setDetectors,
        setQuota
      );
      setLoadError(null);
    } else setLoadError(result.error);
    setLoading(false);
  }

  async function publish() {
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/control-plane/tenant-chat-runtime?tenantId=${encodeURIComponent(tenantId)}`, {
        body: JSON.stringify({
          cachePolicy,
          manualModelRef,
          routes,
          routingMode,
          safetyPolicy: toTenantChatSafetyPolicy(detectors),
          quota
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok || !isRuntimeSetup(payload)) {
        setFeedback({
          error: true,
          message: localizeTenantChatPolicyError(
            readPayloadError(payload, "Chat App policy publish failed."),
            locale
          )
        });
      } else {
        applySetup(
          payload,
          setSetup,
          setRoutingMode,
          setManualModelRef,
          setRoutes,
          setCachePolicy,
          setDetectors,
          setQuota
        );
        setFeedback({ error: false, message: text.ready, published: true });
      }
    } catch {
      setFeedback({ error: true, message: "Control Plane unavailable." });
    } finally {
      setPending(false);
    }
  }

  function updateRoute(category: TenantChatRoutingCategory, difficulty: TenantChatRoutingDifficulty, modelRef: string) {
    setRoutes((current) =>
      updateTenantChatPrimaryModelRef(current, category, difficulty, modelRef)
    );
    setFeedback(null);
  }

  function updateFallback(modelRef: string) {
    setRoutes((current) =>
      applyTenantChatSharedFallbackModelRef(current, modelRef, manualModelRef)
    );
    setFeedback(null);
  }

  function changeMode(autoRoutingEnabled: boolean) {
    setRoutingMode(autoRoutingEnabled ? "auto" : "manual");
    setFeedback(null);
  }

  function updateQuotaLimitInput(value: string) {
    setQuotaLimitInput(value);
    const parsed = parseMonthlyTokenLimitInput(value);
    if (parsed === null) return;
    setQuota((current) => ({ ...current, defaultMonthlyTokenLimit: parsed }));
    setFeedback(null);
  }

  function resetQuotaLimitInput() {
    setQuotaLimitInput(formatMonthlyTokenLimitInput(quota.defaultMonthlyTokenLimit));
  }

  function updateQuotaFromSlider(value: number) {
    setQuota((current) => ({ ...current, defaultMonthlyTokenLimit: value }));
    setQuotaLimitInput(formatMonthlyTokenLimitInput(value));
    setFeedback(null);
  }

  function resetDraft() {
    if (setup) {
      applySetup(
        setup,
        setSetup,
        setRoutingMode,
        setManualModelRef,
        setRoutes,
        setCachePolicy,
        setDetectors,
        setQuota
      );
      setQuotaLimitInput(
        formatMonthlyTokenLimitInput(
          (setup.activeSnapshot?.quota ?? defaultQuotaPolicy()).defaultMonthlyTokenLimit
        )
      );
    }
    setAiModelMaskingPreviewEnabled(false);
    setSemanticCachePreviewEnabled(false);
    setFeedback({ error: false, message: text.resetMessage });
  }

  function selectPolicySection(section: ChatAppPolicySection) {
    setActivePolicySection(section);
    const url = new URL(window.location.href);
    if (section === "routing") {
      url.searchParams.delete("section");
    } else {
      url.searchParams.set("section", section);
    }
    window.history.pushState(window.history.state, "", url);
  }

  const readiness = setup?.readiness ?? "degraded";
  const refs = new Set(models.map((model) => model.modelRef));
  const canPublish = refs.has(manualModelRef) && matrixUsesOnly(routes, refs);
  const monthlySliderMax = Math.max(
    MONTHLY_TOKEN_LIMIT_SLIDER_MAX,
    Math.ceil(quota.defaultMonthlyTokenLimit / MONTHLY_TOKEN_LIMIT_SLIDER_STEP) *
      MONTHLY_TOKEN_LIMIT_SLIDER_STEP
  );
  const monthlySliderPosition = Math.min(
    100,
    Math.max(0, (quota.defaultMonthlyTokenLimit / monthlySliderMax) * 100)
  );
  const monthlySliderPositionStyle = {
    "--tenant-monthly-token-slider-position": `${monthlySliderPosition}%`
  } as CSSProperties;

  return (
    <ManagementPage
      className="tenant-management-content tenant-chat-app-content"
      title={text.title}
    >
      <div className="tenant-page-header-rule" aria-hidden="true" />
      <div className="policy-section-toolbar">
        <div aria-label={text.breadcrumb} className="policy-section-tabs tenant-management-tabs" role="tablist">
          {chatAppPolicySections
            .filter((section) => section !== "knowledge" || canManageKnowledgeBase)
            .map((section) => {
            const isActive = activePolicySection === section;
            const label = section === "routing"
              ? text.routingTab
              : section === "cache"
                ? text.cacheTab
                : section === "security"
                  ? text.securityTab
                  : section === "quota"
                    ? locale === "ko" ? "사용량 한도" : "Usage limits"
                    : text.knowledgeTab;

            return (
              <button
                aria-controls={`chat-app-${section}-panel`}
                aria-selected={isActive}
                data-active={isActive}
                id={`chat-app-${section}-tab`}
                key={section}
                onClick={() => selectPolicySection(section)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {activePolicySection !== "knowledge" && loadError ? <Alert variant="destructive"><AlertTriangle /><AlertTitle>{text.loadError}</AlertTitle><AlertDescription><p>{loadError}</p><Button disabled={loading} onClick={() => void refresh()} size="sm" variant="outline">{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{text.refresh}</Button></AlertDescription></Alert> : null}
      {activePolicySection !== "knowledge" && readiness === "degraded" && !loadError ? <Alert variant="warning"><AlertTriangle /><AlertDescription>{text.degraded}</AlertDescription></Alert> : null}
      {activePolicySection !== "knowledge" && feedback ? <Alert variant={feedback.error ? "destructive" : "success"}>{feedback.error ? <AlertTriangle /> : <Check />}<AlertDescription>{feedback.message}</AlertDescription></Alert> : null}

      {activePolicySection === "routing" ? (
      <div aria-labelledby="chat-app-routing-tab" className="policy-tab-panel space-y-5" id="chat-app-routing-panel" role="tabpanel" tabIndex={0}>
        {!setup?.providers.length ? (
          <EmptyState action={<Link className={buttonVariants()} href={providerManagementHref}><PlugZap />{text.configureProvider}</Link>} description={text.noProvider} icon={PlugZap} title={text.title} />
        ) : models.length === 0 ? (
          <EmptyState action={<Link className={buttonVariants()} href={providerManagementHref}>{text.configureProvider}</Link>} description={text.noModel} icon={MessageSquareText} title={text.model} />
        ) : (
          <form className="tenant-routing-panel" onSubmit={(event) => { event.preventDefault(); void publish(); }}>
            <section
              aria-labelledby="tenant-routing-model-title"
              className="tenant-routing-model-card"
              data-routing-mode={routingMode}
            >
              <header className="tenant-routing-model-heading">
                <div className="tenant-routing-model-heading-copy">
                  <div className="tenant-routing-title-with-help">
                    <h3 id="tenant-routing-model-title">{text.routing}</h3>
                    <RoutingCriteriaPopover
                      ariaLabel={text.routingCriteria}
                      criteria={routingDifficultyCriteria[locale]}
                      description={text.routingDescription}
                      locale={locale}
                      note={text.criteriaNote}
                    />
                  </div>
                </div>
                <div className="tenant-routing-heading-mode">
                  <div className="tenant-routing-switch-control">
                    <span className="tenant-routing-mode-label" data-active={routingMode === "manual" ? "true" : undefined}>{text.fixedLabel}</span>
                    <Switch
                      aria-label={text.modeTitle}
                      checked={routingMode === "auto"}
                      className="tenant-routing-switch"
                      onCheckedChange={changeMode}
                    />
                    <span className="tenant-routing-mode-label" data-active={routingMode === "auto" ? "true" : undefined}>{text.autoLabel}</span>
                  </div>
                </div>
              </header>
              <div className="tenant-routing-mode-content" key={routingMode}>
                {routingMode === "auto" ? (
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
                            <RoutingCriteriaPopover
                              ariaLabel={`${category[locale]} ${text.categoryCriteria}`}
                              criteria={category.criteria[locale]}
                              locale={locale}
                            />
                          </div>
                          {difficulties.map((difficulty) => (
                            <RoutingCellEditor
                              ariaLabel={`${category[locale]} ${difficulty[locale]}`}
                              columnLabel={difficulty[locale]}
                              key={difficulty.id}
                              locale={locale}
                              onChange={(modelRef) => updateRoute(category.id, difficulty.id, modelRef)}
                              providers={providers}
                              value={routes[category.id]?.[difficulty.id]?.modelRefs?.[0] ?? ""}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div aria-label={text.manual} className="tenant-routing-fixed-panel">
                    <div className="tenant-routing-fixed-heading">
                      <span className="tenant-routing-fallback-kicker">
                        <MessageSquareText aria-hidden="true" />
                        {text.fixedLabel}
                      </span>
                      <h4>{text.manual}</h4>
                      <p>{text.manualDescription}</p>
                    </div>
                    <TenantRoutingProviderModelSelect
                      ariaLabel={text.manual}
                      appearance="standalone"
                      locale={locale}
                      onChange={(value) => { setManualModelRef(value); setFeedback(null); }}
                      providers={providers}
                      value={manualModelRef}
                    />
                  </div>
                )}
                <section className="tenant-routing-fallback-card" aria-labelledby="tenant-routing-fallback-title">
                  <header className="tenant-routing-fallback-heading">
                    <div className="tenant-routing-fallback-title-row">
                      <h3 id="tenant-routing-fallback-title">{text.fallbackTitle}</h3>
                      <span className="tenant-routing-fallback-kicker">
                        <RefreshCcw aria-hidden="true" />
                        {text.fallbackKicker}
                      </span>
                    </div>
                    <p>{routingMode === "manual" ? text.fixedFallbackDescription : text.fallbackDescription}</p>
                  </header>
                  <TenantRoutingProviderModelSelect
                    allowEmpty
                    ariaLabel={text.fallbackTitle}
                    appearance="standalone"
                    emptyLabel={text.fallbackDisabled}
                    locale={locale}
                    mixedLabel={text.fallbackMixed}
                    onChange={updateFallback}
                    providers={fallbackProviders}
                    value={fallbackModelRef}
                  />
                </section>
              </div>
            </section>

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
      ) : (
        activePolicySection === "cache" ||
        activePolicySection === "security" ||
        activePolicySection === "quota"
      ) ? (
        <form
          aria-labelledby={`chat-app-${activePolicySection}-tab`}
          className="chat-app-policy-form"
          id={`chat-app-${activePolicySection}-panel`}
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
          role="tabpanel"
          tabIndex={0}
        >
          <section className="policy-layout policy-settings-list">
            <div className="policy-tab-panel">
              {activePolicySection === "cache" ? (
                <CachePolicyControls
                  enabled={cachePolicy.enabled}
                  experimentalSemanticCache={{
                    badge: tenantChatExperimentalPolicyText[locale].badge,
                    enabled: semanticCachePreviewEnabled,
                    hint: tenantChatExperimentalPolicyText[locale].semanticCacheHint,
                    id: "tenant-chat-semantic-cache-preview",
                    onEnabledChange: (enabled) => {
                      setSemanticCachePreviewEnabled(enabled);
                      setFeedback(null);
                    },
                    title: tenantChatExperimentalPolicyText[locale].semanticCacheTitle
                  }}
                  onEnabledChange={(enabled) => {
                    setCachePolicy((current) => ({ ...current, enabled }));
                    setFeedback(null);
                  }}
                  showSemanticCache={false}
                  text={tenantChatPolicyText[locale]}
                />
              ) : activePolicySection === "security" ? (
                <SafetyDetectorPolicyControls
                  allowPlaceholderEditing={false}
                  detectors={detectors}
                  experimentalModelMasking={{
                    badge: tenantChatExperimentalPolicyText[locale].badge,
                    enabled: aiModelMaskingPreviewEnabled,
                    hint: tenantChatExperimentalPolicyText[locale].aiModelMaskingHint,
                    id: "tenant-chat-ai-model-masking-preview",
                    onEnabledChange: (enabled) => {
                      setAiModelMaskingPreviewEnabled(enabled);
                      setFeedback(null);
                    },
                    title: tenantChatExperimentalPolicyText[locale].aiModelMaskingTitle
                  }}
                  onDetectorChange={(nextDetector) => {
                    setDetectors((current) =>
                      current.map((detector) =>
                        detector.type === nextDetector.type ? nextDetector : detector
                      )
                    );
                    setFeedback(null);
                  }}
                  showAllActionOptions
                  text={tenantChatPolicyText[locale]}
                />
              ) : (
                <section
                  aria-label={locale === "ko" ? "모든 사용자 월간 토큰 한도" : "Monthly token limit for all users"}
                  className="tenant-monthly-token-section"
                >
                  <div className="tenant-monthly-token-title-row">
                    <h3>{locale === "ko" ? "모든 사용자 월간 토큰 한도" : "Monthly token limit for all users"}</h3>
                    <MonthlyTokenQuotaInfo locale={locale} />
                  </div>
                  <article className="tenant-monthly-token-card">
                    <header className="tenant-monthly-token-card-header">
                      <div>
                        <strong>{locale === "ko" ? "월간 한도" : "Monthly limit"}</strong>
                        <p>
                          {locale === "ko"
                            ? "모든 Tenant Chat 사용자의 사용량을 합산해 적용합니다."
                            : "Applies to the combined usage of every Tenant Chat user."}
                        </p>
                      </div>
                    </header>
                    <div className="tenant-monthly-token-controls">
                      <label className="tenant-monthly-token-input-field">
                        <span>{locale === "ko" ? "월간 한도" : "Monthly limit"}</span>
                        <input
                          aria-describedby="tenant-monthly-token-input-hint"
                          aria-label={locale === "ko" ? "월간 토큰 한도" : "Monthly token limit"}
                          disabled={pending}
                          inputMode="decimal"
                          onBlur={resetQuotaLimitInput}
                          onChange={(event) => updateQuotaLimitInput(event.target.value)}
                          placeholder="1M"
                          type="text"
                          value={quotaLimitInput}
                        />
                        <small id="tenant-monthly-token-input-hint">
                          {locale === "ko" ? "예: 1M 또는 1,250,000" : "For example: 1M or 1,250,000"}
                        </small>
                      </label>
                      <div className="tenant-monthly-token-slider-field">
                        <div className="tenant-monthly-token-slider-track" style={monthlySliderPositionStyle}>
                          <output className="tenant-monthly-token-slider-current">
                            {formatCompactMonthlyTokenCount(quota.defaultMonthlyTokenLimit)}
                          </output>
                          <input
                            aria-label={locale === "ko" ? "월간 토큰 한도 슬라이더" : "Monthly token limit slider"}
                            aria-valuetext={formatCompactMonthlyTokenCount(quota.defaultMonthlyTokenLimit)}
                            className="tenant-monthly-token-range"
                            disabled={pending}
                            max={monthlySliderMax}
                            min={0}
                            onChange={(event) => updateQuotaFromSlider(Number(event.target.value))}
                            step={MONTHLY_TOKEN_LIMIT_SLIDER_STEP}
                            type="range"
                            value={quota.defaultMonthlyTokenLimit}
                          />
                        </div>
                        <div className="tenant-monthly-token-slider-endpoints" aria-hidden="true">
                          <span>0</span>
                          <span>{formatCompactMonthlyTokenCount(monthlySliderMax)}</span>
                        </div>
                      </div>
                      {quota.defaultMonthlyTokenLimit === 0 ? (
                        <p className="tenant-monthly-token-block-notice">
                          {locale === "ko"
                            ? "발행하면 다음 새 Provider 요청부터 모든 사용자를 즉시 차단합니다."
                            : "Publishing this blocks every new Provider request immediately."}
                        </p>
                      ) : null}
                    </div>
                    <footer className="tenant-monthly-token-footer">
                      <p>
                        {locale === "ko"
                          ? `기준 시간대: ${quota.timezone} · 적용된 정책: ${setup?.activeSnapshot?.version ?? "-"}`
                          : `Timezone: ${quota.timezone} · Active policy: ${setup?.activeSnapshot?.version ?? "-"}`}
                      </p>
                    </footer>
                  </article>
                </section>
              )}
            </div>
          </section>
          <div className="tenant-routing-actions">
            <button className="secondary-button tenant-routing-reset-button" disabled={pending || loading} onClick={resetDraft} type="button">{text.reset}</button>
            <button className="primary-button tenant-routing-save-button" data-save-confirmed={feedback?.published ? "true" : undefined} disabled={!canPublish || pending || loading} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : feedback?.published ? <Check aria-hidden="true" /> : null}
              {pending ? text.publishing : feedback?.published ? text.active : text.publish}
            </button>
          </div>
        </form>
      ) : null}

      {canManageKnowledgeBase ? (
        <KnowledgeBaseManagement
          active={activePolicySection === "knowledge"}
          initialDocuments={initialDocuments}
          initialDocumentsError={initialDocumentsError}
          initialSettings={initialKnowledgeBaseSettings}
          initialSettingsError={initialKnowledgeBaseSettingsError}
          locale={locale}
          tenantId={tenantId}
        />
      ) : null}
    </ManagementPage>
  );
}

function RoutingCellEditor({ ariaLabel, columnLabel, locale, onChange, providers, value }: {
  ariaLabel: string;
  columnLabel: string;
  locale: Locale;
  onChange: (value: string) => void;
  providers: RoutingProviderOption[];
  value: string;
}) {
  return (
    <div className="tenant-routing-route tenant-routing-model-ref-cell" data-column-label={columnLabel} role="cell">
      <TenantRoutingProviderModelSelect ariaLabel={ariaLabel} locale={locale} onChange={onChange} providers={providers} value={value} />
    </div>
  );
}

function RoutingCriteriaPopover({ ariaLabel, criteria, description, locale, note }: {
  ariaLabel: string;
  criteria: DifficultyCriteria[Locale];
  description?: string;
  locale: Locale;
  note?: string;
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger aria-label={ariaLabel} className="tenant-routing-info-button" type="button">
        <Info aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner align="start" className="tenant-routing-popover-positioner" side="bottom" sideOffset={8}>
          <PopoverPrimitive.Popup className="tenant-routing-criteria-popover">
            {description ? <p className="tenant-routing-criteria-description">{description}</p> : null}
            <section className="tenant-routing-criteria-section" data-difficulty="simple">
              <strong>{difficulties[0][locale]}</strong>
              <p>{criteria.simple}</p>
              <div className="tenant-routing-criteria-example">
                <span>{copy[locale].example}</span>
                <p>{criteria.simpleExample}</p>
              </div>
            </section>
            <section className="tenant-routing-criteria-section" data-difficulty="complex">
              <strong>{difficulties[1][locale]}</strong>
              <p>{criteria.complex}</p>
              <div className="tenant-routing-criteria-example">
                <span>{copy[locale].example}</span>
                <p>{criteria.complexExample}</p>
              </div>
            </section>
            {note ? <p className="tenant-routing-criteria-note">{note}</p> : null}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function TenantRoutingProviderModelSelect({ allowEmpty = false, ariaLabel, appearance = "cell", emptyLabel, locale, mixedLabel, onChange, providers, value }: {
  allowEmpty?: boolean;
  ariaLabel: string;
  appearance?: "cell" | "standalone";
  emptyLabel?: string;
  locale: Locale;
  mixedLabel?: string;
  onChange: (value: string) => void;
  providers: RoutingProviderOption[];
  value: string | null;
}) {
  const selectedProvider = providers.find((provider) =>
    provider.models.some((model) => model.modelRef === value)
  );
  const selectedModels = selectedProvider?.models ?? [];
  const standalone = appearance === "standalone";
  const showProviderIcon = Boolean(selectedProvider || value);
  const providerValue = selectedProvider?.providerConnectionId ?? (
    value === null ? "__mixed" : value ? "__unavailable" : ""
  );
  const emptyStateLabel = value === null
    ? (mixedLabel ?? copy[locale].modelUnavailable)
    : (emptyLabel ?? copy[locale].modelUnavailable);

  return (
    <div
      aria-label={ariaLabel}
      className={standalone ? "tenant-routing-standalone-controls" : "tenant-routing-model-selectors"}
      role="group"
    >
      <label className={standalone ? "tenant-routing-standalone-field" : undefined}>
        <span className={standalone ? undefined : "sr-only"}>{copy[locale].provider}</span>
        <span className="tenant-routing-provider-control">
          {showProviderIcon ? (
            <ProviderFamilyIcon
              className="tenant-routing-provider-icon"
              family={selectedProvider?.providerFamily ?? "unknown"}
              size={22}
            />
          ) : null}
          <select
            aria-label={`${ariaLabel} ${copy[locale].provider}`}
            onChange={(event) => {
              if (event.target.value === "") {
                onChange("");
                return;
              }
              const nextProvider = providers.find(
                (provider) => provider.providerConnectionId === event.target.value
              );
              onChange(nextProvider?.models[0]?.modelRef ?? "");
            }}
            value={providerValue}
          >
            {value === null ? <option disabled value="__mixed">{emptyStateLabel}</option> : null}
            {value && !selectedProvider ? <option disabled value="__unavailable">{copy[locale].providerUnavailable}</option> : null}
            {allowEmpty ? <option value="">{emptyLabel}</option> : null}
            {!allowEmpty && !selectedProvider && !value ? <option disabled value="">{copy[locale].providerUnavailable}</option> : null}
            {providers.map((provider) => (
              <option key={provider.providerConnectionId} value={provider.providerConnectionId}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className={standalone ? "tenant-routing-standalone-field" : undefined}>
        <span className={standalone ? undefined : "sr-only"}>{copy[locale].model}</span>
        <span className="tenant-routing-model-control">
          <select
            aria-label={`${ariaLabel} ${copy[locale].model}`}
            disabled={!selectedProvider}
            onChange={(event) => onChange(event.target.value)}
            value={selectedProvider ? (value ?? "") : ""}
          >
            {selectedProvider ? (
              <>
                <UnavailableModelOption locale={locale} models={selectedModels} value={value ?? ""} />
                {selectedModels.map((model) => (
                  <option key={model.modelRef} value={model.modelRef}>{model.modelKey}</option>
                ))}
              </>
            ) : <option value="">{emptyStateLabel}</option>}
          </select>
        </span>
      </label>
    </div>
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
    const refs = routes[category.id]?.[difficulty.id]?.modelRefs ?? [];
    return refs.length >= 1 && refs.length <= 4 && refs.every((ref) => available.has(ref));
  }));
}

const defaultRuntimePolicyDetectors: RuntimePolicyDetector[] = [
  { type: "email", enabled: true, action: "redact", placeholder: "[EMAIL_REDACTED]" },
  { type: "phone_number", enabled: true, action: "redact", placeholder: "[PHONE_NUMBER_REDACTED]" },
  { type: "person_name", enabled: true, action: "redact", placeholder: "[PERSON_NAME_REDACTED]" },
  { type: "postal_address", enabled: true, action: "redact", placeholder: "[POSTAL_ADDRESS_REDACTED]" },
  { type: "organization_name", enabled: true, action: "redact", placeholder: "[ORGANIZATION_NAME_REDACTED]" },
  { type: "resident_registration_number", enabled: true, action: "block", placeholder: "[RESIDENT_REGISTRATION_NUMBER_REDACTED]" },
  { type: "api_key", enabled: true, action: "block", placeholder: "[API_KEY_REDACTED]" },
  { type: "authorization_header", enabled: true, action: "block", placeholder: "[AUTHORIZATION_HEADER_REDACTED]" },
  { type: "jwt", enabled: true, action: "block", placeholder: "[JWT_REDACTED]" },
  { type: "private_key", enabled: true, action: "block", placeholder: "[SECRET_REDACTED]" }
];
const mandatoryRuntimePolicyDetectorTypes = new Set<RuntimePolicyDetector["type"]>([
  "resident_registration_number",
  "api_key",
  "authorization_header",
  "jwt",
  "private_key"
]);

function defaultCachePolicy(): TenantChatAdminCachePolicy {
  return { enabled: true, maxEntriesPerUser: 100, ttlSeconds: 300 };
}

function defaultQuotaPolicy(): TenantChatAdminQuotaPolicy {
  return {
    defaultMonthlyTokenLimit: 1_000_000,
    timezone: "Asia/Seoul",
    warningPercent: 80,
    economyPercent: 90,
    hardStopPercent: 100
  };
}

function toRuntimePolicyDetectors(
  safetyPolicy?: TenantChatAdminSafetyPolicy
): RuntimePolicyDetector[] {
  const configured = new Map(
    safetyPolicy?.detectorSet.map((detector) => [detector.detectorType, detector]) ?? []
  );
  return defaultRuntimePolicyDetectors.map((detector) => {
    const active = configured.get(detector.type);
    if (!active) {
      return {
        ...detector,
        enabled:
          safetyPolicy === undefined ||
          mandatoryRuntimePolicyDetectorTypes.has(detector.type)
      };
    }
    return {
      ...detector,
      action: active.action === "block" ? "block" : "redact",
      enabled: active.action !== "allow"
    };
  });
}

function toTenantChatSafetyPolicy(
  detectors: RuntimePolicyDetector[]
): TenantChatAdminSafetyPolicy {
  return {
    detectorSet: detectors.map((detector) => ({
      action: detector.enabled ? detector.action : "allow",
      detectorType: detector.type
    }))
  };
}

function MonthlyTokenQuotaInfo({ locale }: { locale: Locale }) {
  const description =
    locale === "ko"
      ? "모든 Tenant Chat 사용자의 합산 월간 토큰 한도입니다. 매월 1일 0시(Asia/Seoul)에 초기화됩니다."
      : "The combined monthly token limit for all Tenant Chat users. It resets on the first day of each month at 00:00 (Asia/Seoul).";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={locale === "ko" ? "월간 토큰 한도 안내" : "Monthly token limit information"}
              className="tenant-monthly-token-info-trigger"
              type="button"
            />
          }
        >
          <Info aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="tenant-monthly-token-info-tooltip" sideOffset={8}>
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function formatCompactMonthlyTokenCount(value: number) {
  const normalized = Math.max(0, Math.trunc(value));
  if (normalized >= 1_000_000 && normalized % 1_000_000 === 0) {
    return `${normalized / 1_000_000}M`;
  }
  if (normalized >= 1_000 && normalized % 1_000 === 0) {
    return `${normalized / 1_000}K`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(normalized);
}

function formatMonthlyTokenLimitInput(value: number) {
  return formatCompactMonthlyTokenCount(value);
}

function parseMonthlyTokenLimitInput(value: string): number | null {
  const normalized = value.replaceAll(",", "").trim();
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(normalized);
  if (!match) return null;

  const multiplier = match[2]?.toLowerCase() === "m"
    ? 1_000_000
    : match[2]?.toLowerCase() === "k"
      ? 1_000
      : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function applySetup(
  next: TenantChatAdminRuntimeSetup,
  setSetup: (value: TenantChatAdminRuntimeSetup) => void,
  setMode: (value: TenantChatRoutingMode) => void,
  setManual: (value: string) => void,
  setRoutes: (value: TenantChatRoutingMatrix) => void,
  setCachePolicy: (value: TenantChatAdminCachePolicy) => void,
  setDetectors: (value: RuntimePolicyDetector[]) => void,
  setQuota: (value: TenantChatAdminQuotaPolicy) => void
) {
  const modelRef = next.activeSnapshot?.manualModelRef ?? firstModelRef(next);
  setSetup(next);
  setMode(next.activeSnapshot?.routingMode ?? "auto");
  setManual(modelRef);
  setRoutes(next.activeSnapshot?.routes ?? uniformRoutingMatrix(modelRef));
  setCachePolicy(next.activeSnapshot?.cachePolicy ?? defaultCachePolicy());
  setDetectors(toRuntimePolicyDetectors(next.activeSnapshot?.safetyPolicy));
  setQuota(next.activeSnapshot?.quota ?? defaultQuotaPolicy());
}

async function loadSetup(tenantId: string): Promise<{ data: TenantChatAdminRuntimeSetup; ok: true } | { error: string; ok: false }> {
  try {
    const response = await fetch(`/api/control-plane/tenant-chat-runtime?tenantId=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as unknown;
    return response.ok && isRuntimeSetup(payload) ? { data: payload, ok: true } : { error: readPayloadError(payload, "Chat App policy load failed."), ok: false };
  } catch { return { error: "Control Plane unavailable.", ok: false }; }
}

function readPayloadError(payload: unknown, fallback: string) {
  const error = payload && typeof payload === "object" ? (payload as Record<string, unknown>).error : null;
  return typeof error === "string" && error.trim() ? error : fallback;
}

function localizeTenantChatPolicyError(error: string, locale: Locale) {
  if (
    locale === "ko" &&
    error === "Employee weekly token limit cannot exceed the shared monthly token limit."
  ) {
    return "공통 월간 한도를 활성 직원의 주간 한도보다 낮게 설정할 수 없습니다.";
  }
  return error;
}
function isRuntimeSetup(value: unknown): value is TenantChatAdminRuntimeSetup {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  return Boolean(record && Array.isArray(record.providers) && typeof record.readiness === "string");
}
