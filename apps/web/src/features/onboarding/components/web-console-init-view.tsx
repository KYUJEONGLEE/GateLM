"use client";

import { LogIn, LogOut, Route, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { GateLMLogo } from "@/components/brand/gatelm-logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/lib/i18n/locale";
import type { WebConsoleAuthPanelProps } from "./web-console-auth-panel";
import type { WebConsoleLandingSectionsProps } from "./web-console-landing-sections";

const defaultTenantId = "tenant_demo_acme";
const stayOnLandingHistoryStateKey = "gatelmStayOnLanding";
const createdTenantDisplayNameStorageKeyPrefix = "gatelmCreatedTenantDisplayName:";

const WebConsoleAuthPanel = dynamic<WebConsoleAuthPanelProps>(
  () => import("./web-console-auth-panel").then((module) => module.WebConsoleAuthPanel),
  {
    loading: () => null,
    ssr: false
  }
);

const WebConsoleLandingSections = dynamic<WebConsoleLandingSectionsProps>(
  () =>
    import("./web-console-landing-sections").then(
      (module) => module.WebConsoleLandingSections
    ),
  {
    loading: () => null,
    ssr: false
  }
);

type WebConsoleInitViewProps = {
  initialAuthStatus: AuthStatus;
  initialDashboardTenantId?: string | null;
  locale: Locale;
};

export type AuthMode = "login" | "recovery" | "signup";
export type AuthStatus = "anonymous" | "authenticated";
export type SignupStepId = "account" | "verify" | "organization" | "ready";

type AcceptedProjectInvitation = {
  acceptedAt?: string | null;
  email: string;
  expiresAt: string;
  projectId: string;
  projectName?: string | null;
  status: string;
  tenantId: string;
  tenantName?: string | null;
};

type AcceptedEmployeeInvitation = {
  acceptedAt?: string | null;
  email: string;
  employeeId: string;
  expiresAt: string;
  name?: string | null;
  status: string;
  tenantId: string;
  tenantName?: string | null;
};

type AuthAccessRecord = {
  status?: string;
  tenantId?: string | null;
};

type AuthResponseData = {
  acceptedEmployeeInvitation?: AcceptedEmployeeInvitation;
  acceptedProjectInvitation?: AcceptedProjectInvitation;
  memberships?: AuthAccessRecord[];
  projectAdmins?: AuthAccessRecord[];
  session?: {
    kind?: string;
  };
  tenant?: {
    id?: string;
    name?: string;
  };
  verificationRequired?: boolean;
};

function getDashboardHref(tenantId = defaultTenantId) {
  return `/tenants/${tenantId}/dashboard`;
}

function getProjectsHref(tenantId: string) {
  return `/tenants/${encodeURIComponent(tenantId)}/projects`;
}

function getSafeNextPath(params: URLSearchParams) {
  const nextPath = params.get("next")?.trim();

  if (
    !nextPath ||
    !nextPath.startsWith("/") ||
    nextPath.startsWith("//") ||
    nextPath.startsWith("/\\")
  ) {
    return null;
  }

  return nextPath;
}

function redirectToPath(path: string, replace = false) {
  if (replace) {
    window.location.replace(path);
    return;
  }

  window.location.assign(path);
}

function redirectToDashboard(replace = false, tenantId = defaultTenantId) {
  const href = getDashboardHref(tenantId);
  if (replace) {
    window.location.replace(href);
    return;
  }

  window.location.assign(href);
}

function resolveDashboardTenantId(data: AuthResponseData | null | undefined) {
  const tenantIdFromMembership = findActiveTenantId(data?.memberships);
  if (tenantIdFromMembership) {
    return tenantIdFromMembership;
  }

  const tenantIdFromProjectAdmin = findActiveTenantId(data?.projectAdmins);
  if (tenantIdFromProjectAdmin) {
    return tenantIdFromProjectAdmin;
  }

  const tenantIdFromTenant = normalizeTenantId(data?.tenant?.id);
  return tenantIdFromTenant;
}

function findActiveTenantId(records: AuthAccessRecord[] | undefined) {
  return records
    ?.find((record) => record.status === undefined || record.status === "active")
    ?.tenantId?.trim() || null;
}

function normalizeTenantId(value: string | null | undefined) {
  return value?.trim() || null;
}

function redirectToProjects(tenantId: string, replace = false) {
  const href = getProjectsHref(tenantId);
  if (replace) {
    window.location.replace(href);
    return;
  }

  window.location.assign(href);
}

function getCreatedTenantDisplayNameStorageKey(tenantId: string) {
  return `${createdTenantDisplayNameStorageKeyPrefix}${tenantId}`;
}

function storeCreatedTenantDisplayName(tenantId: string, tenantName: string) {
  try {
    window.sessionStorage.setItem(getCreatedTenantDisplayNameStorageKey(tenantId), tenantName);
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

function hasStayOnLandingHistoryState() {
  const state = window.history.state;

  return Boolean(
    state &&
      typeof state === "object" &&
      (state as Record<string, unknown>)[stayOnLandingHistoryStateKey] === true
  );
}

function replaceLandingUrl() {
  const state = window.history.state;
  const nextState =
    state && typeof state === "object"
      ? { ...(state as Record<string, unknown>), [stayOnLandingHistoryStateKey]: true }
      : { [stayOnLandingHistoryStateKey]: true };

  window.history.replaceState(nextState, "", "/");
}

const initText: Record<
  Locale,
  {
    actions: {
      chat: string;
      dashboard: string;
      gatewayRequest: string;
      googleLogin: string;
      login: string;
      loginSubmit: string;
      logout: string;
      onboarding: string;
      requestLogs: string;
      signup: string;
      signupSubmit: string;
    };
    auth: {
      accountEmailHelp: string;
      backToLogin: string;
      close: string;
      confirmPassword: string;
      email: string;
      forgotPassword: string;
      loginTitle: string;
      name: string;
      organization: string;
      organizationPlaceholder: string;
      password: string;
      passwordChangedNotice: string;
      passwordHint: string;
      passwordMismatch: string;
      readyBody: string;
      readyTitle: string;
      recoveryBody: string;
      recoveryNotice: string;
      recoveryTitle: string;
      sendResetLink: string;
      signupTitle: string;
      verificationCode: string;
    };
    console: {
      title: string;
    };
    hero: {
      eyebrow: string;
      title: string;
      titleAccent: string;
      body: string;
      chips: string[];
    };
    language: string;
    nav: {
      gateway: string;
      integrations: string;
      policies: string;
      company: string;
    };
    providers: {
      label: string;
      names: string[];
    };
    scene: {
      live: string;
      title: string;
      app: string;
      appSubcopy: string;
      metrics: Array<[string, string]>;
      providers: string[];
      stages: string[];
    };
    signupSteps: Record<SignupStepId, string>;
    summary: {
      eyebrow: string;
      title: string;
      body: string;
    };
    features: {
      title: string;
      body: string;
      items: Array<{
        title: string;
        body: string;
      }>;
    };
    policies: {
      title: string;
      body: string;
      items: Array<{
        title: string;
        body: string;
      }>;
    };
    workflow: {
      title: string;
      body: string;
      steps: string[];
    };
    bottomCta: {
      title: string;
      body: string;
      action: string;
    };
  }
> = {
  en: {
    actions: {
      chat: "Employee Chat",
      dashboard: "Open Dashboard",
      gatewayRequest: "Gateway request",
      googleLogin: "Continue with Google",
      login: "Login",
      loginSubmit: "Login",
      logout: "Logout",
      onboarding: "Management",
      requestLogs: "Request logs",
      signup: "Sign up",
      signupSubmit: "Continue"
    },
    auth: {
      accountEmailHelp: "Your login ID is the email address used to sign up. If you cannot remember it, check your invitation or contact your administrator.",
      backToLogin: "Back to login",
      close: "Close authentication panel",
      confirmPassword: "Confirm password",
      email: "Email",
      forgotPassword: "Forgot your email or password?",
      loginTitle: "Login to GateLM",
      name: "Name",
      organization: "Tenant name",
      organizationPlaceholder: "Acme AI Operations",
      password: "Password",
      passwordChangedNotice: "Password changed. Sign in again with your new password.",
      passwordHint: "Use at least 15 characters. Passphrases are welcome; common or repeated passwords are blocked.",
      passwordMismatch: "The password confirmation does not match.",
      readyBody: "The tenant is ready and your account has Owner/Admin access.",
      readyTitle: "Owner/Admin granted",
      recoveryBody: "Enter your sign-up email. If a local account exists, GateLM will send a one-time reset link.",
      recoveryNotice: "If an eligible account exists, a reset link has been sent. Check your inbox and spam folder.",
      recoveryTitle: "Find your account or reset password",
      sendResetLink: "Send reset link",
      signupTitle: "Create a tenant account",
      verificationCode: "Verification code"
    },
    console: {
      title: "Web Console"
    },
    hero: {
      body:
        "GateLM adds budget, security, and audit controls to enterprise AI usage without changing how employees work.",
      chips: [],
      eyebrow: "Enterprise AI management platform",
      title: "Employees use AI.",
      titleAccent: "The company stays in control."
    },
    language: "Console language",
    nav: {
      company: "Company",
      gateway: "Product",
      integrations: "Getting started",
      policies: "Security"
    },
    providers: {
      label: "Available AI models",
      names: [
        "OpenAI GPT family",
        "Anthropic Claude family",
        "Google Gemini family",
        "Automatic failover"
      ]
    },
    scene: {
      app: "Customer App",
      appSubcopy: "Internal service / Chat UI",
      live: "Live Routing",
      metrics: [
        ["Monthly savings", "37%"],
        ["Policy events", "128"],
        ["Cache response", "21ms"]
      ],
      providers: ["OpenAI", "Claude", "Gemini"],
      stages: ["Cache", "Routing", "Budget", "Masking", "Logging", "Rate Limit"],
      title: "GateLM AI Gateway"
    },
    signupSteps: {
      account: "Email/password sign up",
      organization: "Tenant name",
      ready: "Tenant + Owner/Admin",
      verify: "Email verification"
    },
    summary: {
      body:
        "GateLM lets administrators control cost and security policy from one console while preserving the LLM workflows employees and services already use.",
      eyebrow: "About GateLM",
      title: "Do not block AI usage. Make it operational."
    },
    features: {
      title: "Four reasons enterprises can adopt AI with confidence",
      body: "",
      items: [
        {
          title: "Predictable spend",
          body: "Set budget limits by project and service, then stop over-budget requests before provider charges occur."
        },
        {
          title: "Sensitive data protection",
          body: "Detect and mask personal or confidential information before it reaches an external AI provider."
        },
        {
          title: "Auditable usage",
          body: "Track who used which model, when it was used, and how much it cost without exposing raw secrets."
        },
        {
          title: "Operational continuity",
          body: "Keep existing employee workflows and route around model or provider failures automatically."
        }
      ]
    },
    policies: {
      title: "Built for enterprise security boundaries",
      body:
        "GateLM keeps provider credentials and sensitive request evidence out of user-facing surfaces while applying policy before provider calls.",
      items: [
        {
          title: "Raw conversations stay private",
          body: "Raw prompts and responses are not exposed in console evidence."
        },
        {
          title: "Credentials remain protected",
          body: "API keys, app tokens, authorization headers, and provider secrets are never shown in plaintext."
        },
        {
          title: "Sensitive values are handled first",
          body: "Masking and blocking policies run before requests are sent to providers."
        }
      ]
    },
    workflow: {
      title: "Keep the workflow. Bring control back to the company.",
      body:
        "Employees continue using familiar tools while administrators configure models, budgets, and security policy in four steps.",
      steps: [
        "Create an organization account and register employees.",
        "Connect providers and choose the models the organization can use.",
        "Create a project and configure budget and security policy.",
        "Monitor cost, usage, and policy outcomes from the console."
      ]
    },
    bottomCta: {
      action: "Open console",
      body:
        "Centralize enterprise AI cost, security, routing, and audit evidence in one operating layer.",
      title: "AI adoption without losing operational control."
    }
  },
  ko: {
    actions: {
      gatewayRequest: "Gateway 요청",
      logout: "로그아웃",
      chat: "직원 Chat 확인",
      dashboard: "대시보드로 이동",
      googleLogin: "Google로 계속하기",
      login: "로그인",
      loginSubmit: "로그인",
      onboarding: "관리",
      requestLogs: "요청 로그",
      signup: "회원가입",
      signupSubmit: "계속",
    },
    auth: {
      accountEmailHelp: "로그인 아이디는 가입할 때 사용한 이메일입니다. 기억나지 않으면 초대 메일을 확인하거나 관리자에게 문의하세요.",
      backToLogin: "로그인으로 돌아가기",
      close: "인증 패널 닫기",
      confirmPassword: "비밀번호 확인",
      email: "이메일",
      forgotPassword: "아이디 또는 비밀번호를 잊으셨나요?",
      loginTitle: "GateLM 로그인",
      name: "이름",
      organization: "Tenant 이름",
      organizationPlaceholder: "Acme AI 운영팀",
      password: "비밀번호",
      passwordChangedNotice: "비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인하세요.",
      passwordHint: "15자 이상 입력하세요. 긴 문구를 사용할 수 있으며 흔하거나 반복된 비밀번호는 사용할 수 없습니다.",
      passwordMismatch: "비밀번호 확인이 일치하지 않습니다.",
      readyBody: "Tenant가 생성되고 이 계정에 Owner/Admin 권한이 부여된 상태입니다.",
      readyTitle: "Owner/Admin 권한 부여",
      recoveryBody: "가입 이메일을 입력하세요. 로컬 계정이 있으면 GateLM이 일회용 재설정 링크를 보냅니다.",
      recoveryNotice: "해당되는 계정이 있다면 재설정 링크를 보냈습니다. 받은편지함과 스팸함을 확인하세요.",
      recoveryTitle: "아이디 확인 및 비밀번호 재설정",
      sendResetLink: "재설정 링크 보내기",
      signupTitle: "Tenant 계정 만들기",
      verificationCode: "인증 코드"
    },
    console: {
      title: "웹 콘솔"
    },
    hero: {
      body:
        "GateLM은 회사의 AI 사용에 예산, 보안, 기록이라는 세 가지 장치를 더합니다. 직원의 업무 방식은 바뀌지 않습니다.",
      chips: [],
      eyebrow: "기업용 AI 관리 플랫폼",
      title: "직원은 AI를 쓰고,",
      titleAccent: "회사는 안심합니다."
    },
    language: "콘솔 언어",
    nav: {
      company: "회사 소개",
      gateway: "제품",
      integrations: "도입 안내",
      policies: "보안"
    },
    providers: {
      label: "사용 가능한 AI 모델",
      names: [
        "OpenAI GPT 계열",
        "Anthropic Claude 계열",
        "Google Gemini 계열",
        "장애 시 자동 전환"
      ]
    },
    scene: {
      app: "Customer App",
      appSubcopy: "사내 서비스 / Chat UI",
      live: "Live Routing",
      metrics: [
        ["월 비용 절감", "37%"],
        ["정책 이벤트", "128건"],
        ["캐시 응답", "21ms"]
      ],
      providers: ["OpenAI", "Claude", "Gemini"],
      stages: ["Cache", "Routing", "Budget", "Masking", "Logging", "Rate Limit"],
      title: "GateLM AI Gateway"
    },
    signupSteps: {
      account: "이메일/비밀번호 회원가입",
      organization: "Tenant 이름 입력",
      ready: "Tenant 생성 + Owner/Admin",
      verify: "이메일 인증"
    },
    summary: {
      body:
        "GateLM은 직원과 서비스가 이미 사용하던 LLM 흐름을 유지하면서 관리자가 비용과 보안 정책을 한 곳에서 제어하도록 돕는 B2B LLMOps Gateway입니다.",
      eyebrow: "About GateLM",
      title: "기업의 AI 사용을 막지 않고, 운영 가능한 형태로 바꿉니다."
    },
    features: {
      title: "회사가 안심할 수 있는 네 가지 이유",
      body: "",
      items: [
        {
          title: "예측 가능한 비용",
          body: "프로젝트와 서비스 단위로 예산 한도를 정합니다. 한도를 넘는 사용은 결제가 발생하기 전에 자동으로 차단합니다."
        },
        {
          title: "새지 않는 민감정보",
          body: "개인정보와 사내 기밀은 외부 AI로 전달되기 전에 탐지하고 정책에 따라 마스킹하거나 차단합니다."
        },
        {
          title: "감사에 대응하는 기록",
          body: "누가 어떤 모델을 얼마나 사용했는지 기록으로 남겨 보안 감사와 내부 검토에 활용할 수 있습니다."
        },
        {
          title: "바뀌지 않는 업무 방식",
          body: "직원은 쓰던 서비스와 도구를 그대로 사용합니다. 모델 장애가 발생하면 정책에 따라 다른 경로로 전환합니다."
        }
      ]
    },
    policies: {
      title: "기업 보안 경계를 고려해 설계했습니다.",
      body:
        "Provider 호출 전에 정책을 적용하고, 사용자 화면과 운영 증거에는 자격 증명과 민감한 원문을 노출하지 않습니다.",
      items: [
        {
          title: "대화 원문 보호",
          body: "운영 화면에는 raw prompt와 raw response를 노출하지 않습니다."
        },
        {
          title: "인증 정보 보호",
          body: "API Key, App Token, Authorization header, Provider secret은 평문으로 표시하지 않습니다."
        },
        {
          title: "민감정보 사전 처리",
          body: "외부 Provider로 요청을 보내기 전에 마스킹과 차단 정책을 적용합니다."
        }
      ]
    },
    workflow: {
      title: "직원은 그대로, 통제권만 회사로.",
      body:
        "직원은 익숙한 도구를 그대로 사용하고, 관리자는 네 단계로 모델과 예산·보안 정책을 운영합니다.",
      steps: [
        "조직 계정을 만들고 직원을 등록합니다.",
        "사용할 Provider와 모델을 연결합니다.",
        "프로젝트를 만들고 예산·보안 정책을 설정합니다.",
        "대시보드에서 비용과 사용 현황을 확인합니다."
      ]
    },
    bottomCta: {
      action: "콘솔 로그인",
      body: "비용, 보안, 라우팅, 감사 기록을 하나의 운영 계층에서 관리합니다.",
      title: "기업의 AI 도입, 운영 통제까지 함께 시작합니다."
    }
  }
};

export type WebConsoleInitText = (typeof initText)[Locale];

export function WebConsoleInitView({
  initialAuthStatus,
  initialDashboardTenantId,
  locale
}: WebConsoleInitViewProps) {
  const text = initText[locale];
  const initialDashboardTenantIdForAuth =
    initialAuthStatus === "authenticated"
      ? normalizeTenantId(initialDashboardTenantId) ?? defaultTenantId
      : null;
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(initialAuthStatus);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isAuthPanelOpen, setIsAuthPanelOpen] = useState(false);
  const [dashboardTenantId, setDashboardTenantId] = useState<string | null>(
    initialDashboardTenantIdForAuth
  );
  const [employeeInviteToken, setEmployeeInviteToken] = useState<string | null>(null);
  const [projectInviteToken, setProjectInviteToken] = useState<string | null>(null);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupStep, setSignupStep] = useState<SignupStepId>("account");

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextPath = getSafeNextPath(params);
    if (params.get("auth") === "login") {
      const passwordChanged = params.get("passwordChanged") === "1";
      window.history.replaceState(null, "", "/");
      setAuthMode("login");
      setAuthNotice(passwordChanged ? text.auth.passwordChangedNotice : null);
      setIsAuthPanelOpen(true);
    }
    if (params.get("auth") === "organization" || params.get("auth") === "tenant") {
      window.history.replaceState(null, "", "/");
      setAuthMode("signup");
      setSignupStep("organization");
      setIsAuthPanelOpen(true);
    }
    const projectInvite = params.get("projectInvite") ?? params.get("invite");
    const employeeInvite = params.get("employeeInvite");
    if (projectInvite) {
      setProjectInviteToken(projectInvite);
      setAuthMode("signup");
      setSignupStep("account");
      setIsAuthPanelOpen(true);
    }
    if (employeeInvite) {
      setEmployeeInviteToken(employeeInvite);
      setAuthMode("signup");
      setSignupStep("account");
      setIsAuthPanelOpen(true);
    }

    const hasLandingViewParam = params.get("view") === "landing";
    const shouldStayOnLanding =
      Boolean(projectInvite || employeeInvite) || hasLandingViewParam || hasStayOnLandingHistoryState();
    if (hasLandingViewParam || projectInvite || employeeInvite) {
      replaceLandingUrl();
    }

    if (initialAuthStatus === "anonymous") {
      if (nextPath) {
        setAuthMode("login");
        setIsAuthPanelOpen(true);
      }
      return;
    }

    let isMounted = true;

    async function restoreSession() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include"
        });

        if (!isMounted) {
          return;
        }

        if (!response.ok) {
          setAuthStatus("anonymous");
          return;
        }

        const body = (await response.json()) as { data?: AuthResponseData };

        if (!isMounted) {
          return;
        }

        const sessionKind = body.data?.session?.kind;
        const restoredTenantId =
          resolveDashboardTenantId(body.data) ??
          (sessionKind === "full" ? initialDashboardTenantIdForAuth : null);
        const hasConsoleSession = sessionKind === "full" || sessionKind === "onboarding";

        setAuthStatus(hasConsoleSession ? "authenticated" : "anonymous");
        setDashboardTenantId(restoredTenantId);

        if (hasConsoleSession && nextPath && !shouldStayOnLanding) {
          redirectToPath(nextPath, true);
          return;
        }

        if (sessionKind === "full" && restoredTenantId && !shouldStayOnLanding) {
          redirectToDashboard(true, restoredTenantId);
          return;
        }

        if (sessionKind === "onboarding" && !restoredTenantId && !projectInvite && !employeeInvite) {
          setAuthMode("signup");
          setSignupStep("organization");
          setIsAuthPanelOpen(true);
        }
      } catch {
        // Anonymous visitors should still see the landing page.
        if (isMounted) {
          setAuthStatus("anonymous");
        }
      }
    }

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, [
    initialAuthStatus,
    initialDashboardTenantIdForAuth,
    text.auth.passwordChangedNotice
  ]);

  function openAuthPanel(mode: AuthMode) {
    setAuthError(null);
    setAuthNotice(null);
    setAuthMode(mode);
    if (mode === "signup") {
      setSignupStep("account");
    }
    setIsAuthPanelOpen(true);
  }

  function switchAuthMode(mode: AuthMode) {
    setAuthError(null);
    setAuthNotice(null);
    setAuthMode(mode);
    if (mode === "signup") {
      setSignupStep("account");
    }
  }

  function closeAuthPanel() {
    setIsAuthPanelOpen(false);
    setAuthError(null);
    setAuthNotice(null);
  }

  async function logout() {
    setIsAuthPanelOpen(false);
    setAuthError(null);
    setAuthNotice(null);
    setAuthStatus("anonymous");
    setDashboardTenantId(null);
    window.history.replaceState(null, "", "/");
    await fetch("/api/auth/logout", {
      credentials: "include",
      method: "POST"
    }).catch(() => undefined);
  }

  function completeAuth(tenantId: string | null = dashboardTenantId) {
    setIsAuthPanelOpen(false);
    setAuthError(null);
    setAuthNotice(null);
    setSignupStep("account");
    setAuthStatus("authenticated");
    setDashboardTenantId(tenantId);
    const nextPath = getSafeNextPath(new URLSearchParams(window.location.search));
    if (nextPath) {
      redirectToPath(nextPath);
      return;
    }
    if (tenantId) {
      redirectToDashboard(false, tenantId);
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAuthSubmitting) {
      return;
    }

    const formData = new FormData(event.currentTarget);

    await runAuthAction(async () => {
      const result = await postAuth("login", {
        email: readFormString(formData, "email"),
        password: readFormValue(formData, "password")
      });
      completeAuth(resolveDashboardTenantId(result.data));
    });
  }

  async function submitPasswordResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAuthSubmitting) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    await runAuthAction(async () => {
      await postAuth("password-reset/request", {
        email: readFormString(formData, "email")
      });
      setAuthNotice(text.auth.recoveryNotice);
    });
  }

  async function continueSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAuthSubmitting) {
      return;
    }

    const formData = new FormData(event.currentTarget);

    if (signupStep === "ready") {
      completeAuth(dashboardTenantId);
      return;
    }

    if (
      signupStep === "account" &&
      readFormValue(formData, "password") !==
        readFormValue(formData, "passwordConfirmation")
    ) {
      setAuthNotice(null);
      setAuthError(text.auth.passwordMismatch);
      return;
    }

    await runAuthAction(async () => {
      if (signupStep === "account") {
        const email = readFormString(formData, "email");
        const result = await postAuth("signup", {
          email,
          name: readFormString(formData, "name"),
          password: readFormValue(formData, "password"),
          ...(employeeInviteToken ? { employeeInviteToken } : {}),
          ...(projectInviteToken ? { projectInviteToken } : {})
        });
        setSignupEmail(email);
        const acceptedEmployeeInvitation = result.data?.acceptedEmployeeInvitation;
        if (acceptedEmployeeInvitation) {
          setDashboardTenantId(acceptedEmployeeInvitation.tenantId);
          setAuthNotice("Employee account activated.");
          setSignupStep("ready");
          return;
        }
        const acceptedInvitation = result.data?.acceptedProjectInvitation;
        if (acceptedInvitation) {
          setDashboardTenantId(acceptedInvitation.tenantId);
          setAuthNotice("Project admin invitation accepted.");
          setSignupStep("ready");
          return;
        }
        if (result.data?.verificationRequired === false) {
          setAuthNotice("Email verification skipped in local fake mode. Create your tenant.");
          setSignupStep("organization");
          return;
        }
        setAuthNotice("Verification code sent. Check your email.");
        setSignupStep("verify");
        return;
      }

      if (signupStep === "verify") {
        const result = await postAuth("email/verify", {
          code: readFormString(formData, "verificationCode"),
          email: signupEmail,
          ...(employeeInviteToken ? { employeeInviteToken } : {}),
          ...(projectInviteToken ? { projectInviteToken } : {})
        });
        const acceptedInvitation = result.data?.acceptedProjectInvitation;
        if (acceptedInvitation) {
          setDashboardTenantId(acceptedInvitation.tenantId);
          setAuthNotice("Project admin access granted.");
          setSignupStep("ready");
          return;
        }
        setAuthNotice("Email verified. Create your tenant.");
        setSignupStep("organization");
        return;
      }

      const tenantName = readFormString(formData, "tenant");
      const result = await postAuth("organizations", {
        organizationName: tenantName
      });
      if (result.error) {
        setAuthNotice(null);
        setAuthError(result.error.message ?? "Failed to create tenant.");
        return;
      }

      const tenant = result.data?.tenant;
      const tenantId = typeof tenant?.id === "string" && tenant.id.trim()
        ? tenant.id.trim()
        : defaultTenantId;

      storeCreatedTenantDisplayName(tenantId, tenantName);
      setIsAuthPanelOpen(false);
      setAuthError(null);
      setAuthNotice(null);
      setSignupStep("account");
      setAuthStatus("authenticated");
      redirectToProjects(tenantId);
    });
  }

  async function runAuthAction(action: () => Promise<void>) {
    setAuthError(null);
    setIsAuthSubmitting(true);

    try {
      await action();
    } catch (error) {
      setAuthNotice(null);
      setAuthError(extractAuthErrorMessage(error));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function startGoogleLogin() {
    window.location.assign("/api/auth/google/start");
  }

  return (
    <main className="landing-shell">
      <div className="landing-hero-block">
        <nav className="landing-topbar" aria-label="GateLM landing navigation">
          <Link className="landing-brand" href="/" aria-label="GateLM home">
            <GateLMLogo />
          </Link>
          <div className="landing-nav-links">
            <a href="#gateway">{text.nav.gateway}</a>
            <a href="#policies">{text.nav.policies}</a>
            <a href="#integrations">{text.nav.integrations}</a>
          </div>
          <div className="landing-top-actions">
            <LanguageSwitcher ariaLabel={text.language} locale={locale} />
            {authStatus === "authenticated" ? (
              <>
                {dashboardTenantId ? (
                  <Link
                    className="landing-auth-button landing-auth-button-primary"
                    href={getDashboardHref(dashboardTenantId)}
                  >
                    <Route aria-hidden="true" size={17} strokeWidth={2.4} />
                    <span>{text.actions.dashboard}</span>
                  </Link>
                ) : null}
                <button className="landing-auth-button" onClick={logout} type="button">
                  <LogOut aria-hidden="true" size={17} strokeWidth={2.4} />
                  <span>{text.actions.logout}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  className="landing-auth-button"
                  onClick={() => openAuthPanel("login")}
                  type="button"
                >
                  <LogIn aria-hidden="true" size={17} strokeWidth={2.4} />
                  <span>{text.actions.login}</span>
                </button>
                <button
                  className="landing-auth-button landing-auth-button-primary"
                  onClick={() => openAuthPanel("signup")}
                  type="button"
                >
                  <UserPlus aria-hidden="true" size={17} strokeWidth={2.4} />
                  <span>{text.actions.signup}</span>
                </button>
              </>
            )}
          </div>
        </nav>

        <header className="landing-hero" id="top">
          <p className="landing-eyebrow">{text.hero.eyebrow}</p>
          <h1>
            {text.hero.title}
            <span>{text.hero.titleAccent}</span>
          </h1>
          <p>{text.hero.body}</p>
          <div className="landing-hero-actions">
            {authStatus === "authenticated" && dashboardTenantId ? (
              <Link className="landing-cta" href={getDashboardHref(dashboardTenantId)}>
                <Route aria-hidden="true" size={18} strokeWidth={2.4} />
                <span>{text.actions.dashboard}</span>
              </Link>
            ) : (
              <>
                <button className="landing-cta" onClick={() => openAuthPanel("login")} type="button">
                  <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
                  <span>{text.actions.login}</span>
                </button>
                <button
                  className="landing-secondary-cta"
                  onClick={() => openAuthPanel("signup")}
                  type="button"
                >
                  <UserPlus aria-hidden="true" size={18} strokeWidth={2.4} />
                  <span>{text.actions.signup}</span>
                </button>
              </>
            )}
          </div>
          <div className="landing-hero-cards">
            {text.features.items.slice(0, 3).map((item) => (
              <article key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </article>
            ))}
          </div>
        </header>
      </div>

      <WebConsoleLandingSections
        authStatus={authStatus}
        dashboardTenantId={dashboardTenantId}
        getDashboardHref={getDashboardHref}
        onOpenAuthPanel={openAuthPanel}
        text={text}
      />

      {isAuthPanelOpen ? (
        <WebConsoleAuthPanel
          authError={authError}
          authMode={authMode}
          authNotice={authNotice}
          isProjectInviteSignup={Boolean(projectInviteToken || employeeInviteToken)}
          isSubmitting={isAuthSubmitting}
          signupStep={signupStep}
          text={text}
          onClose={closeAuthPanel}
          onGoogleLogin={startGoogleLogin}
          onLoginSubmit={submitLogin}
          onPasswordResetRequestSubmit={submitPasswordResetRequest}
          onSelectAuthMode={switchAuthMode}
          onSignupSubmit={continueSignup}
        />
      ) : null}
    </main>
  );
}

type AuthPostResponse = {
  data?: {
    acceptedEmployeeInvitation?: AcceptedEmployeeInvitation;
    acceptedProjectInvitation?: AcceptedProjectInvitation;
    session?: {
      kind?: string;
    };
    tenant?: {
      id?: string;
      name?: string;
    };
    verificationRequired?: boolean;
  };
  error?: {
    message?: string;
  };
};

async function postAuth(path: string, payload: Record<string, string>) {
  const response = await fetch(`/api/auth/${path}`, {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
  const body = (await response.json().catch(() => null)) as AuthPostResponse | null;

  if (!response.ok) {
    throw new Error(body?.error?.message ?? "Authentication request failed.");
  }

  return body ?? {};
}

function readFormString(formData: FormData, key: string) {
  return readFormValue(formData, key).trim();
}

function readFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function extractAuthErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Authentication request failed.";
}
