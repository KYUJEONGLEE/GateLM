"use client";

import {
  Building2,
  CheckCircle2,
  Crown,
  KeyRound,
  LogIn,
  LogOut,
  MailCheck,
  Route,
  Send,
  ShieldCheck,
  UserPlus,
  X
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/lib/i18n/locale";

const defaultTenantId = "tenant_demo_acme";
const stayOnLandingHistoryStateKey = "gatelmStayOnLanding";
const createdTenantDisplayNameStorageKeyPrefix = "gatelmCreatedTenantDisplayName:";

type WebConsoleInitViewProps = {
  initialAuthStatus: AuthStatus;
  locale: Locale;
};

type AuthMode = "login" | "signup";
type AuthStatus = "anonymous" | "authenticated";
type SignupStepId = "account" | "verify" | "organization" | "ready";

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

type AuthAccessRecord = {
  status?: string;
  tenantId?: string | null;
};

type AuthResponseData = {
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

const signupStepOrder: SignupStepId[] = ["account", "verify", "organization", "ready"];

const signupStepIcons: Record<SignupStepId, typeof MailCheck> = {
  account: KeyRound,
  organization: Building2,
  ready: Crown,
  verify: MailCheck
};

function getDashboardHref(tenantId = defaultTenantId) {
  return `/tenants/${tenantId}/dashboard`;
}

function getProjectsHref(tenantId: string) {
  return `/tenants/${encodeURIComponent(tenantId)}/projects`;
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
      close: string;
      email: string;
      loginTitle: string;
      name: string;
      organization: string;
      organizationPlaceholder: string;
      password: string;
      readyBody: string;
      readyTitle: string;
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
      close: "Close authentication panel",
      email: "Email",
      loginTitle: "Login to GateLM",
      name: "Name",
      organization: "Tenant name",
      organizationPlaceholder: "Acme AI Operations",
      password: "Password",
      readyBody: "The tenant is ready and your account has Owner/Admin access.",
      readyTitle: "Owner/Admin granted",
      signupTitle: "Create a tenant account",
      verificationCode: "Verification code"
    },
    console: {
      title: "Web Console"
    },
    hero: {
      body:
        "Keep existing customer services and internal UI intact while routing every LLM request through one place for cost, policy, logs, and security operations.",
      chips: ["Cost Control", "Policy", "Gateway API"],
      eyebrow: "B2B LLMOps Gateway for enterprise teams",
      title: "Turn enterprise LLM usage into an",
      titleAccent: "operable Gateway."
    },
    language: "Console language",
    nav: {
      company: "Company",
      gateway: "AI Gateway",
      integrations: "Integrations",
      policies: "Policies"
    },
    providers: {
      label: "Supported AI Providers",
      names: ["OpenAI", "Anthropic", "Google Gemini", "Cohere", "Azure OpenAI", "AWS Bedrock"]
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
      title: "Manage cost, models, and security policy from one Gateway.",
      body:
        "Provider calls, API keys, logs, and budget policy are standardized at the gateway layer instead of being scattered across services.",
      items: [
        {
          title: "Unified API",
          body: "Connect multiple providers and models through one OpenAI-compatible gateway surface."
        },
        {
          title: "Spend Tracking",
          body: "Track tokens and cost by tenant, project, application, and budget scope."
        },
        {
          title: "Smart Cache",
          body: "Answer repeated requests through exact cache paths and reduce provider spend."
        },
        {
          title: "Model Access",
          body: "Control which teams can use each provider, model, and budget boundary."
        }
      ]
    },
    policies: {
      title: "Change operating policy in the console without redeploying code.",
      body:
        "Administrators can separate budget, rate limit, masking, and routing policy by scope and publish controlled runtime snapshots.",
      items: [
        {
          title: "Budget Policy",
          body: "Set budget thresholds and block runaway spend before it reaches providers."
        },
        {
          title: "Security Policy",
          body: "Apply request-side masking and keep sensitive evidence sanitized."
        },
        {
          title: "Routing Policy",
          body: "Select models by cost, latency, provider health, and application context."
        }
      ]
    },
    workflow: {
      title: "Keep the customer UI. Route only the LLM request through GateLM.",
      body:
        "Employees keep using the product surfaces they already know while customer servers call the GateLM Gateway with scoped application credentials.",
      steps: [
        "An Owner/Admin creates a tenant, project, and application.",
        "Provider credentials and GateLM application tokens are registered.",
        "The customer server calls the Gateway instead of calling providers directly.",
        "Dashboard, request logs, and policy events show the outcome in one place."
      ]
    },
    bottomCta: {
      action: "Open console",
      body:
        "GateLM adds an operating layer for LLM usage without changing the employee experience.",
      title: "Operations gets control. Employees keep their workflow."
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
      close: "인증 패널 닫기",
      email: "이메일",
      loginTitle: "GateLM 로그인",
      name: "이름",
      organization: "Tenant 이름",
      organizationPlaceholder: "Acme AI 운영팀",
      password: "비밀번호",
      readyBody: "Tenant가 생성되고 이 계정에 Owner/Admin 권한이 부여된 상태입니다.",
      readyTitle: "Owner/Admin 권한 부여",
      signupTitle: "Tenant 계정 만들기",
      verificationCode: "인증 코드"
    },
    console: {
      title: "웹 콘솔"
    },
    hero: {
      body:
        "고객사의 기존 서비스와 사내 UI를 유지한 채 모든 LLM 요청을 하나의 Gateway로 통과시켜 비용, 정책, 로그, 보안을 운영 레벨에서 관리합니다.",
      chips: [],
      eyebrow: "",
      title: "기업의 LLM 사용을",
      titleAccent: "운영 가능한 Gateway로\n전환합니다."
    },
    language: "콘솔 언어",
    nav: {
      company: "회사 소개",
      gateway: "AI Gateway",
      integrations: "연동",
      policies: "정책"
    },
    providers: {
      label: "연동 가능한 AI Provider",
      names: ["OpenAI", "Anthropic", "Google Gemini", "Cohere", "Azure OpenAI", "AWS Bedrock"]
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
      title: "Gateway 한 곳에서 비용, 모델, 보안 정책을 관리합니다.",
      body:
        "서비스마다 흩어진 Provider 호출, API Key, 로그, 예산 정책을 Gateway 계층에서 표준화합니다.",
      items: [
        {
          title: "Unified API",
          body: "OpenAI 호환 API 하나로 여러 Provider와 모델을 연결합니다."
        },
        {
          title: "Spend Tracking",
          body: "테넌트, 프로젝트, 애플리케이션, budget scope 단위로 토큰과 비용을 추적합니다."
        },
        {
          title: "Smart Cache",
          body: "반복 요청은 exact cache 경로로 응답해 Provider 호출 비용을 줄입니다."
        },
        {
          title: "Model Access",
          body: "팀과 서비스가 사용할 수 있는 Provider, 모델, 예산 경계를 제어합니다."
        }
      ]
    },
    policies: {
      title: "운영 정책은 코드 배포 없이 콘솔에서 변경합니다.",
      body:
        "관리자는 예산, rate limit, masking, routing 정책을 scope별로 분리하고 RuntimeSnapshot으로 publish할 수 있습니다.",
      items: [
        {
          title: "Budget Policy",
          body: "예산 임계값을 설정해 과금 급증을 Provider 호출 전에 차단합니다."
        },
        {
          title: "Security Policy",
          body: "request-side masking을 적용하고 민감한 evidence는 sanitized 형태로 유지합니다."
        },
        {
          title: "Routing Policy",
          body: "비용, 지연 시간, Provider 상태, 애플리케이션 맥락에 따라 모델을 선택합니다."
        }
      ]
    },
    workflow: {
      title: "고객 UI는 그대로 두고, LLM 요청만 GateLM으로 보냅니다.",
      body:
        "직원은 익숙한 제품 화면을 계속 사용하고, 고객 서버는 scope가 정해진 application credential로 GateLM Gateway를 호출합니다.",
      steps: [
        "Owner/Admin이 tenant, project, application을 생성합니다.",
        "Provider credential과 GateLM application token을 등록합니다.",
        "고객 서버가 Provider 직접 호출 대신 Gateway를 호출합니다.",
        "Dashboard, request log, policy event에서 결과를 한 곳에 확인합니다."
      ]
    },
    bottomCta: {
      action: "콘솔 열기",
      body:
        "GateLM은 직원 경험을 바꾸지 않고 LLM 사용을 운영 가능한 레이어로 묶습니다.",
      title: "운영자는 통제하고, 직원은 하던 대로 사용합니다."
    }
  }
};

export function WebConsoleInitView({ initialAuthStatus, locale }: WebConsoleInitViewProps) {
  const text = initText[locale];
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(initialAuthStatus);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isAuthPanelOpen, setIsAuthPanelOpen] = useState(false);
  const [dashboardTenantId, setDashboardTenantId] = useState<string | null>(null);
  const [projectInviteToken, setProjectInviteToken] = useState<string | null>(null);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupStep, setSignupStep] = useState<SignupStepId>("account");

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "organization" || params.get("auth") === "tenant") {
      window.history.replaceState(null, "", "/");
      setAuthMode("signup");
      setSignupStep("organization");
      setIsAuthPanelOpen(true);
    }
    const projectInvite = params.get("projectInvite") ?? params.get("invite");
    if (projectInvite) {
      setProjectInviteToken(projectInvite);
      setAuthMode("signup");
      setSignupStep("account");
      setIsAuthPanelOpen(true);
    }

    const hasLandingViewParam = params.get("view") === "landing";
    const shouldStayOnLanding =
      Boolean(projectInvite) || hasLandingViewParam || hasStayOnLandingHistoryState();
    if (hasLandingViewParam || projectInvite) {
      replaceLandingUrl();
    }

    if (initialAuthStatus === "anonymous") {
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
        const restoredTenantId = resolveDashboardTenantId(body.data);
        const hasConsoleSession = sessionKind === "full" || sessionKind === "onboarding";

        setAuthStatus(hasConsoleSession ? "authenticated" : "anonymous");
        setDashboardTenantId(restoredTenantId);

        if (sessionKind === "full" && restoredTenantId && !shouldStayOnLanding) {
          redirectToDashboard(true, restoredTenantId);
          return;
        }

        if (sessionKind === "onboarding" && !restoredTenantId && !projectInvite) {
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
  }, [initialAuthStatus]);

  function openAuthPanel(mode: AuthMode) {
    setAuthError(null);
    setAuthNotice(null);
    setAuthMode(mode);
    if (mode === "signup") {
      setSignupStep("account");
    }
    setIsAuthPanelOpen(true);
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
        password: readFormString(formData, "password")
      });
      completeAuth(resolveDashboardTenantId(result.data));
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

    await runAuthAction(async () => {
      if (signupStep === "account") {
        const email = readFormString(formData, "email");
        const result = await postAuth("signup", {
          email,
          name: readFormString(formData, "name"),
          password: readFormString(formData, "password"),
          ...(projectInviteToken ? { projectInviteToken } : {})
        });
        setSignupEmail(email);
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
      <nav className="landing-topbar" aria-label="GateLM landing navigation">
        <div className="landing-brand-cluster">
          <Link className="landing-brand" href="/" aria-label="GateLM home">
            <span className="landing-brand-mark">G</span>
            <strong>GateLM</strong>
          </Link>
          {authStatus === "authenticated" ? (
            <Link className="landing-auth-button landing-gateway-request-button" href="/application">
              <Send aria-hidden="true" size={16} strokeWidth={2.4} />
              <span>{text.actions.gatewayRequest}</span>
            </Link>
          ) : null}
          {authStatus === "authenticated" && dashboardTenantId ? (
            <Link className="landing-auth-button landing-auth-button-primary" href={getDashboardHref(dashboardTenantId)}>
              <Route aria-hidden="true" size={17} strokeWidth={2.4} />
              <span>{text.actions.dashboard}</span>
            </Link>
          ) : null}
        </div>
        <div className="landing-nav-links">
          <a href="#gateway">{text.nav.gateway}</a>
          <a href="#policies">{text.nav.policies}</a>
          <a href="#integrations">{text.nav.integrations}</a>
          <a href="#company">{text.nav.company}</a>
        </div>
        <div className="landing-top-actions">
          <LanguageSwitcher ariaLabel={text.language} locale={locale} />
          {authStatus === "authenticated" ? (
            <button className="landing-auth-button" onClick={logout} type="button">
              <LogOut aria-hidden="true" size={17} strokeWidth={2.4} />
              <span>{text.actions.logout}</span>
            </button>
          ) : null}
          {authStatus === "anonymous" ? (
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
          ) : null}
        </div>
      </nav>

      <section className="landing-hero">
        <GatewayScene text={text.scene} />
        <div className="landing-hero-copy">
          <div className="landing-chip-row">
            {text.hero.chips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
          <h1>
            {text.hero.title}
            <span>{text.hero.titleAccent}</span>
          </h1>
          <p>{text.hero.body}</p>
        </div>
      </section>

      <section className="landing-provider-band" id="integrations" aria-label={text.providers.label}>
        <strong>{text.providers.label}</strong>
        <div>
          {text.providers.names.map((provider) => (
            <span key={provider}>{provider}</span>
          ))}
        </div>
      </section>

      <section className="landing-summary-band" id="company">
        <div>
          <p>{text.summary.eyebrow}</p>
          <h2>{text.summary.title}</h2>
        </div>
        <p>{text.summary.body}</p>
        <div className="landing-summary-actions">
          {authStatus === "authenticated" ? (
            <>
              {dashboardTenantId ? (
                <Link className="landing-summary-link" href={getDashboardHref(dashboardTenantId)}>
                  <Route aria-hidden="true" size={16} strokeWidth={2.3} />
                  <span>{text.actions.dashboard}</span>
                </Link>
              ) : null}
              <Link className="landing-summary-link" href="/application">
                <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.3} />
                <span>{text.actions.chat}</span>
              </Link>
            </>
          ) : (
            <>
              <button className="landing-summary-link" onClick={() => openAuthPanel("login")} type="button">
                <Route aria-hidden="true" size={16} strokeWidth={2.3} />
                <span>{text.actions.dashboard}</span>
              </button>
              <button className="landing-summary-link" onClick={() => openAuthPanel("login")} type="button">
                <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.3} />
                <span>{text.actions.chat}</span>
              </button>
            </>
          )}
        </div>
      </section>

      <LandingFeatureSection text={text.features} />
      <LandingPolicySection text={text.policies} />
      <LandingWorkflowSection text={text.workflow} />
      <section className="landing-section landing-bottom-cta">
        <div>
          <h2>{text.bottomCta.title}</h2>
          <p>{text.bottomCta.body}</p>
        </div>
        <button className="landing-cta" onClick={() => openAuthPanel("login")} type="button">
          <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
          <span>{text.bottomCta.action}</span>
        </button>
      </section>

      {isAuthPanelOpen ? (
        <div className="landing-auth-overlay" role="presentation">
          <section
            aria-label={authMode === "login" ? text.auth.loginTitle : text.auth.signupTitle}
            aria-modal="true"
            className="landing-auth-panel"
            role="dialog"
          >
            <div className="landing-auth-panel-header">
              <div>
                <p>GateLM</p>
                <h2>{authMode === "login" ? text.auth.loginTitle : text.auth.signupTitle}</h2>
              </div>
              <button
                aria-label={text.auth.close}
                className="landing-auth-close"
                onClick={closeAuthPanel}
                title={text.auth.close}
                type="button"
              >
                <X aria-hidden="true" size={18} strokeWidth={2.4} />
              </button>
            </div>

            <div className="landing-auth-tabs" role="tablist" aria-label="Authentication mode">
              <button
                aria-selected={authMode === "login"}
                data-active={authMode === "login"}
                onClick={() => setAuthMode("login")}
                role="tab"
                type="button"
              >
                {text.actions.login}
              </button>
              <button
                aria-selected={authMode === "signup"}
                data-active={authMode === "signup"}
                onClick={() => {
                  setAuthMode("signup");
                  setSignupStep("account");
                }}
                role="tab"
                type="button"
              >
                {text.actions.signup}
              </button>
            </div>

            {authError ? (
              <p className="landing-auth-message landing-auth-message-error" role="alert">
                {authError}
              </p>
            ) : null}
            {authNotice ? (
              <p className="landing-auth-message landing-auth-message-success">
                {authNotice}
              </p>
            ) : null}

            {authMode === "login" ? (
              <LoginForm
                isSubmitting={isAuthSubmitting}
                text={text}
                onGoogleLogin={startGoogleLogin}
                onSubmit={submitLogin}
              />
            ) : (
              <SignupFlow
                isSubmitting={isAuthSubmitting}
                isProjectInviteSignup={Boolean(projectInviteToken)}
                signupStep={signupStep}
                text={text}
                onGoogleLogin={startGoogleLogin}
                onSubmit={continueSignup}
              />
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function GatewayScene({ text }: { text: (typeof initText)[Locale]["scene"] }) {
  return (
    <div className="landing-hero-scene" aria-hidden="true">
      <div className="landing-gateway-window">
        <div className="landing-window-bar">
          <span />
          <strong>{text.title}</strong>
          <em>{text.live}</em>
        </div>
        <div className="landing-window-grid">
          <div className="landing-customer-node">
            <strong>{text.app}</strong>
            <span>{text.appSubcopy}</span>
          </div>
          <div className="landing-gateway-node">
            <h2>GateLM</h2>
            <div>
              {text.stages.map((stage) => (
                <span key={stage}>{stage}</span>
              ))}
            </div>
          </div>
          <div className="landing-provider-row">
            {text.providers.map((provider) => (
              <span key={provider}>{provider}</span>
            ))}
          </div>
          <div className="landing-metric-row">
            {text.metrics.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type AuthPostResponse = {
  data?: {
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
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function extractAuthErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Authentication request failed.";
}

function LandingFeatureSection({
  text
}: {
  text: (typeof initText)[Locale]["features"];
}) {
  return (
    <section className="landing-section" id="gateway">
      <div className="landing-section-heading">
        <h2>{text.title}</h2>
        <p>{text.body}</p>
      </div>
      <div className="landing-feature-grid">
        {text.items.map((item) => (
          <article className="landing-feature-card" key={item.title}>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LandingPolicySection({
  text
}: {
  text: (typeof initText)[Locale]["policies"];
}) {
  return (
    <section className="landing-section landing-policy-showcase" id="policies">
      <div className="landing-section-heading">
        <h2>{text.title}</h2>
        <p>{text.body}</p>
      </div>
      <div className="landing-policy-grid">
        {text.items.map((item) => (
          <article className="landing-policy-card" key={item.title}>
            <span aria-hidden="true" />
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LandingWorkflowSection({
  text
}: {
  text: (typeof initText)[Locale]["workflow"];
}) {
  return (
    <section className="landing-section landing-workflow-section">
      <div>
        <h2>{text.title}</h2>
        <p>{text.body}</p>
      </div>
      <ol className="landing-workflow-list">
        {text.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

function LoginForm({
  isSubmitting,
  onGoogleLogin,
  onSubmit,
  text
}: {
  isSubmitting: boolean;
  onGoogleLogin: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  text: (typeof initText)[Locale];
}) {
  return (
    <form className="landing-auth-form" onSubmit={onSubmit}>
      <button
        className="landing-google-button"
        disabled={isSubmitting}
        onClick={onGoogleLogin}
        type="button"
      >
        <GoogleMark />
        <strong>{text.actions.googleLogin}</strong>
      </button>
      <div className="landing-auth-divider" role="separator">
        <span>or</span>
      </div>
      <label>
        <span>{text.auth.email}</span>
        <input autoComplete="email" name="email" required type="email" />
      </label>
      <label>
        <span>{text.auth.password}</span>
        <input autoComplete="current-password" name="password" required type="password" />
      </label>
      <button className="landing-auth-submit" disabled={isSubmitting} type="submit">
        <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
        <span>{text.actions.loginSubmit}</span>
      </button>
    </form>
  );
}

function SignupFlow({
  isProjectInviteSignup,
  isSubmitting,
  onGoogleLogin,
  onSubmit,
  signupStep,
  text
}: {
  isProjectInviteSignup: boolean;
  isSubmitting: boolean;
  onGoogleLogin: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  signupStep: SignupStepId;
  text: (typeof initText)[Locale];
}) {
  const visibleSignupSteps = isProjectInviteSignup
    ? signupStepOrder.filter((step) => step !== "organization")
    : signupStepOrder;
  const activeIndex = visibleSignupSteps.indexOf(signupStep);
  const isReadyStep = signupStep === "ready";

  return (
    <form className="landing-auth-form" onSubmit={onSubmit}>
      <ol className="landing-signup-steps" aria-label={text.auth.signupTitle}>
        {visibleSignupSteps.map((step, index) => {
          const StepIcon = signupStepIcons[step];

          return (
            <li
              aria-current={step === signupStep ? "step" : undefined}
              data-active={step === signupStep}
              data-complete={index < activeIndex}
              key={step}
            >
              <StepIcon aria-hidden="true" size={15} strokeWidth={2.4} />
              <span>{text.signupSteps[step]}</span>
            </li>
          );
        })}
      </ol>

      {signupStep === "account" ? (
        <>
          <label>
            <span>{text.auth.name}</span>
            <input autoComplete="name" name="name" required type="text" />
          </label>
          <label>
            <span>{text.auth.email}</span>
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            <span>{text.auth.password}</span>
            <input autoComplete="new-password" name="password" required type="password" />
          </label>
        </>
      ) : null}

      {signupStep === "verify" ? (
        <label>
          <span>{text.auth.verificationCode}</span>
          <input inputMode="numeric" name="verificationCode" placeholder="123456" required type="text" />
        </label>
      ) : null}

      {signupStep === "organization" ? (
        <label>
          <span>{text.auth.organization}</span>
          <input
            autoComplete="organization"
            name="tenant"
            placeholder={text.auth.organizationPlaceholder}
            required
            type="text"
          />
        </label>
      ) : null}

      {isReadyStep ? (
        <div className="landing-ready-state">
          <CheckCircle2 aria-hidden="true" size={22} strokeWidth={2.4} />
          <div>
            <strong>{text.auth.readyTitle}</strong>
            <span>{text.auth.readyBody}</span>
          </div>
        </div>
      ) : null}

      <button className="landing-auth-submit" disabled={isSubmitting} type="submit">
        {isReadyStep ? (
          <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
        ) : (
          <UserPlus aria-hidden="true" size={18} strokeWidth={2.4} />
        )}
        <span>{isReadyStep ? text.actions.loginSubmit : text.actions.signupSubmit}</span>
      </button>
      {!isProjectInviteSignup ? (
        <>
          <div className="landing-auth-divider" role="separator">
            <span>or</span>
          </div>
          <button
            className="landing-google-button"
            disabled={isSubmitting}
            onClick={onGoogleLogin}
            type="button"
          >
            <GoogleMark />
            <strong>{text.actions.googleLogin}</strong>
          </button>
        </>
      ) : null}
    </form>
  );
}

function GoogleMark() {
  return (
    <span className="landing-google-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          d="M21.6 12.23c0-.76-.07-1.49-.2-2.19H12v4.15h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.49Z"
          fill="#4285f4"
        />
        <path
          d="M12 22c2.7 0 4.97-.9 6.62-2.44l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A9.99 9.99 0 0 0 12 22Z"
          fill="#34a853"
        />
        <path
          d="M6.4 13.89a6.01 6.01 0 0 1 0-3.78V7.52H3.06a10 10 0 0 0 0 8.96l3.34-2.59Z"
          fill="#fbbc05"
        />
        <path
          d="M12 5.99c1.47 0 2.8.51 3.84 1.5l2.86-2.86A9.58 9.58 0 0 0 12 2 9.99 9.99 0 0 0 3.06 7.52l3.34 2.59C7.19 7.75 9.4 5.99 12 5.99Z"
          fill="#ea4335"
        />
      </svg>
    </span>
  );
}
