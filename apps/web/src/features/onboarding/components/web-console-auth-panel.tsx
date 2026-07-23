"use client";

import {
  Building2,
  CheckCircle2,
  Crown,
  KeyRound,
  LogIn,
  MailCheck,
  UserPlus,
  X
} from "lucide-react";
import type { FormEvent } from "react";
import type { AuthMode, SignupStepId, WebConsoleInitText } from "./web-console-init-view";

const signupStepOrder: SignupStepId[] = ["account", "verify", "organization", "ready"];

const signupStepIcons: Record<SignupStepId, typeof MailCheck> = {
  account: KeyRound,
  organization: Building2,
  ready: Crown,
  verify: MailCheck
};

export type WebConsoleAuthPanelProps = {
  authError: string | null;
  authMode: AuthMode;
  authNotice: string | null;
  isProjectInviteSignup: boolean;
  isSubmitting: boolean;
  signupStep: SignupStepId;
  text: WebConsoleInitText;
  onClose: () => void;
  onGoogleLogin: () => void;
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onPasswordResetRequestSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSelectAuthMode: (mode: AuthMode) => void;
  onSignupSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function WebConsoleAuthPanel({
  authError,
  authMode,
  authNotice,
  isProjectInviteSignup,
  isSubmitting,
  onClose,
  onGoogleLogin,
  onLoginSubmit,
  onPasswordResetRequestSubmit,
  onSelectAuthMode,
  onSignupSubmit,
  signupStep,
  text
}: WebConsoleAuthPanelProps) {
  const panelTitle =
    authMode === "login"
      ? text.auth.loginTitle
      : authMode === "recovery"
        ? text.auth.recoveryTitle
        : text.auth.signupTitle;

  return (
    <div className="landing-auth-overlay" role="presentation">
      <section
        aria-label={panelTitle}
        aria-modal="true"
        className="landing-auth-panel"
        role="dialog"
      >
        <div className="landing-auth-panel-header">
          <div>
            <p>GateLM</p>
            <h2>{panelTitle}</h2>
          </div>
          <button
            aria-label={text.auth.close}
            className="landing-auth-close"
            onClick={onClose}
            title={text.auth.close}
            type="button"
          >
            <X aria-hidden="true" size={18} strokeWidth={2.4} />
          </button>
        </div>

        {authMode !== "recovery" ? (
          <div className="landing-auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              aria-selected={authMode === "login"}
              data-active={authMode === "login"}
              onClick={() => onSelectAuthMode("login")}
              role="tab"
              type="button"
            >
              {text.actions.login}
            </button>
            <button
              aria-selected={authMode === "signup"}
              data-active={authMode === "signup"}
              onClick={() => onSelectAuthMode("signup")}
              role="tab"
              type="button"
            >
              {text.actions.signup}
            </button>
          </div>
        ) : null}

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
            isSubmitting={isSubmitting}
            text={text}
            onForgotPassword={() => onSelectAuthMode("recovery")}
            onGoogleLogin={onGoogleLogin}
            onSubmit={onLoginSubmit}
          />
        ) : authMode === "recovery" ? (
          <RecoveryForm
            isSubmitting={isSubmitting}
            onBackToLogin={() => onSelectAuthMode("login")}
            onSubmit={onPasswordResetRequestSubmit}
            text={text}
          />
        ) : (
          <SignupFlow
            isProjectInviteSignup={isProjectInviteSignup}
            isSubmitting={isSubmitting}
            signupStep={signupStep}
            text={text}
            onGoogleLogin={onGoogleLogin}
            onSubmit={onSignupSubmit}
          />
        )}
      </section>
    </div>
  );
}

function LoginForm({
  isSubmitting,
  onForgotPassword,
  onGoogleLogin,
  onSubmit,
  text
}: {
  isSubmitting: boolean;
  onForgotPassword: () => void;
  onGoogleLogin: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  text: WebConsoleInitText;
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
        <input
          autoComplete="current-password"
          maxLength={256}
          name="password"
          required
          type="password"
        />
      </label>
      <p className="landing-auth-help">{text.auth.accountEmailHelp}</p>
      <button
        className="landing-auth-text-button"
        disabled={isSubmitting}
        onClick={onForgotPassword}
        type="button"
      >
        {text.auth.forgotPassword}
      </button>
      <button className="landing-auth-submit" disabled={isSubmitting} type="submit">
        <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
        <span>{text.actions.loginSubmit}</span>
      </button>
    </form>
  );
}

function RecoveryForm({
  isSubmitting,
  onBackToLogin,
  onSubmit,
  text
}: {
  isSubmitting: boolean;
  onBackToLogin: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  text: WebConsoleInitText;
}) {
  return (
    <form className="landing-auth-form" onSubmit={onSubmit}>
      <p className="landing-auth-help">{text.auth.recoveryBody}</p>
      <label>
        <span>{text.auth.email}</span>
        <input autoComplete="email" maxLength={254} name="email" required type="email" />
      </label>
      <button className="landing-auth-submit" disabled={isSubmitting} type="submit">
        <MailCheck aria-hidden="true" size={18} strokeWidth={2.4} />
        <span>{text.auth.sendResetLink}</span>
      </button>
      <button className="landing-auth-text-button" disabled={isSubmitting} onClick={onBackToLogin} type="button">
        {text.auth.backToLogin}
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
  text: WebConsoleInitText;
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
            <input autoComplete="new-password" maxLength={256} minLength={15} name="password" required type="password" />
            <small className="landing-auth-help">{text.auth.passwordHint}</small>
          </label>
          <label>
            <span>{text.auth.confirmPassword}</span>
            <input autoComplete="new-password" maxLength={256} minLength={15} name="passwordConfirmation" required type="password" />
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
