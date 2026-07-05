"use client";

import {
  Building2,
  CheckCircle2,
  Crown,
  KeyRound,
  LogIn,
  MailCheck,
  Route,
  ShieldCheck,
  UserPlus,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/lib/i18n/locale";

const defaultTenantId = "tenant_demo_acme";

type WebConsoleInitViewProps = {
  locale: Locale;
};

type AuthMode = "login" | "signup";
type SignupStepId = "account" | "verify" | "organization" | "ready";

const signupStepOrder: SignupStepId[] = ["account", "verify", "organization", "ready"];

const signupStepIcons: Record<SignupStepId, typeof MailCheck> = {
  account: KeyRound,
  organization: Building2,
  ready: Crown,
  verify: MailCheck
};

const initText: Record<
  Locale,
  {
    actions: {
      chat: string;
      dashboard: string;
      googleLogin: string;
      login: string;
      loginSubmit: string;
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
  }
> = {
  en: {
    actions: {
      chat: "Employee Chat",
      dashboard: "Open Dashboard",
      googleLogin: "Continue with Google",
      login: "Login",
      loginSubmit: "Login",
      signup: "Sign up",
      signupSubmit: "Continue"
    },
    auth: {
      close: "Close authentication panel",
      email: "Email",
      loginTitle: "Login to GateLM",
      name: "Name",
      organization: "Organization name",
      organizationPlaceholder: "Acme AI Operations",
      password: "Password",
      readyBody: "The organization is ready and your account has Owner/Admin access.",
      readyTitle: "Owner/Admin granted",
      signupTitle: "Create an organization account",
      verificationCode: "Verification code"
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
      organization: "Organization name",
      ready: "Organization + Owner/Admin",
      verify: "Email verification"
    },
    summary: {
      body:
        "GateLM lets administrators control cost and security policy from one console while preserving the LLM workflows employees and services already use.",
      eyebrow: "About GateLM",
      title: "Do not block AI usage. Make it operational."
    }
  },
  ko: {
    actions: {
      chat: "직원 Chat 확인",
      dashboard: "대시보드 열기",
      googleLogin: "Google로 계속하기",
      login: "로그인",
      loginSubmit: "로그인",
      signup: "회원가입",
      signupSubmit: "계속",
    },
    auth: {
      close: "인증 패널 닫기",
      email: "이메일",
      loginTitle: "GateLM 로그인",
      name: "이름",
      organization: "조직 이름",
      organizationPlaceholder: "Acme AI 운영팀",
      password: "비밀번호",
      readyBody: "조직이 생성되고 이 계정에 Owner/Admin 권한이 부여된 상태입니다.",
      readyTitle: "Owner/Admin 권한 부여",
      signupTitle: "기업 계정 만들기",
      verificationCode: "인증 코드"
    },
    hero: {
      body:
        "고객사의 기존 서비스와 사내 UI를 유지한 채 모든 LLM 요청을 하나의 Gateway로 통과시켜 비용, 정책, 로그, 보안을 운영 레벨에서 관리합니다.",
      chips: ["Cost Control", "Policy", "Gateway API"],
      eyebrow: "B2B LLMOps Gateway for enterprise teams",
      title: "기업의 LLM 사용을",
      titleAccent: "운영 가능한 Gateway로 전환합니다."
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
      organization: "조직 이름 입력",
      ready: "조직 생성 + Owner/Admin",
      verify: "이메일 인증"
    },
    summary: {
      body:
        "GateLM은 직원과 서비스가 이미 사용하던 LLM 흐름을 유지하면서 관리자가 비용과 보안 정책을 한 곳에서 제어하도록 돕는 B2B LLMOps Gateway입니다.",
      eyebrow: "About GateLM",
      title: "기업의 AI 사용을 막지 않고, 운영 가능한 형태로 바꿉니다."
    }
  }
};

export function WebConsoleInitView({ locale }: WebConsoleInitViewProps) {
  const router = useRouter();
  const text = initText[locale];
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthPanelOpen, setIsAuthPanelOpen] = useState(false);
  const [signupStep, setSignupStep] = useState<SignupStepId>("account");

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function openAuthPanel(mode: AuthMode) {
    setAuthMode(mode);
    setIsAuthPanelOpen(true);
  }

  function closeAuthPanel() {
    setIsAuthPanelOpen(false);
  }

  function redirectHome() {
    setIsAuthPanelOpen(false);
    setSignupStep("account");
    router.push("/");
  }

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    redirectHome();
  }

  function continueSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentIndex = signupStepOrder.indexOf(signupStep);
    const nextStep = signupStepOrder[currentIndex + 1];

    if (!nextStep) {
      redirectHome();
      return;
    }

    setSignupStep(nextStep);
  }

  return (
    <main className="landing-shell">
      <nav className="landing-topbar" aria-label="GateLM landing navigation">
        <Link className="landing-brand" href="/" aria-label="GateLM home">
          <span className="landing-brand-mark">G</span>
          <strong>GateLM</strong>
        </Link>
        <div className="landing-nav-links">
          <a href="#gateway">{text.nav.gateway}</a>
          <a href="#policies">{text.nav.policies}</a>
          <a href="#integrations">{text.nav.integrations}</a>
          <a href="#company">{text.nav.company}</a>
        </div>
        <div className="landing-top-actions">
          <LanguageSwitcher ariaLabel={text.language} locale={locale} />
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
        </div>
      </nav>

      <section className="landing-hero" id="gateway">
        <GatewayScene text={text.scene} />
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">{text.hero.eyebrow}</p>
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
          <div className="landing-hero-actions">
            <button className="landing-cta" onClick={() => openAuthPanel("login")} type="button">
              <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
              <span>{text.actions.login}</span>
            </button>
            <button className="landing-secondary-cta" onClick={() => openAuthPanel("signup")} type="button">
              <UserPlus aria-hidden="true" size={18} strokeWidth={2.4} />
              <span>{text.actions.signup}</span>
            </button>
          </div>
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
          <Link className="landing-summary-link" href={`/tenants/${defaultTenantId}/dashboard`}>
            <Route aria-hidden="true" size={16} strokeWidth={2.3} />
            <span>{text.actions.dashboard}</span>
          </Link>
          <Link className="landing-summary-link" href="/application">
            <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.3} />
            <span>{text.actions.chat}</span>
          </Link>
        </div>
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
                onClick={() => setAuthMode("signup")}
                role="tab"
                type="button"
              >
                {text.actions.signup}
              </button>
            </div>

            {authMode === "login" ? (
              <LoginForm
                text={text}
                onGoogleLogin={redirectHome}
                onSubmit={submitLogin}
              />
            ) : (
              <SignupFlow
                signupStep={signupStep}
                text={text}
                onGoogleLogin={redirectHome}
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

function LoginForm({
  onGoogleLogin,
  onSubmit,
  text
}: {
  onGoogleLogin: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  text: (typeof initText)[Locale];
}) {
  return (
    <form className="landing-auth-form" onSubmit={onSubmit}>
      <label>
        <span>{text.auth.email}</span>
        <input autoComplete="email" name="email" required type="email" />
      </label>
      <label>
        <span>{text.auth.password}</span>
        <input autoComplete="current-password" name="password" required type="password" />
      </label>
      <button className="landing-auth-submit" type="submit">
        <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
        <span>{text.actions.loginSubmit}</span>
      </button>
      <button className="landing-google-button" onClick={onGoogleLogin} type="button">
        <span aria-hidden="true">G</span>
        <strong>{text.actions.googleLogin}</strong>
      </button>
    </form>
  );
}

function SignupFlow({
  onGoogleLogin,
  onSubmit,
  signupStep,
  text
}: {
  onGoogleLogin: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  signupStep: SignupStepId;
  text: (typeof initText)[Locale];
}) {
  const activeIndex = signupStepOrder.indexOf(signupStep);
  const isReadyStep = signupStep === "ready";

  return (
    <form className="landing-auth-form" onSubmit={onSubmit}>
      <ol className="landing-signup-steps" aria-label={text.auth.signupTitle}>
        {signupStepOrder.map((step, index) => {
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
            name="organization"
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

      <button className="landing-auth-submit" type="submit">
        {isReadyStep ? (
          <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
        ) : (
          <UserPlus aria-hidden="true" size={18} strokeWidth={2.4} />
        )}
        <span>{isReadyStep ? text.actions.loginSubmit : text.actions.signupSubmit}</span>
      </button>
      <button className="landing-google-button" onClick={onGoogleLogin} type="button">
        <span aria-hidden="true">G</span>
        <strong>{text.actions.googleLogin}</strong>
      </button>
    </form>
  );
}
