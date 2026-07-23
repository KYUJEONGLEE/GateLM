"use client";

import { CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { GateLMLogo } from "@/components/brand/gatelm-logo";
import { isPasswordPolicySatisfied } from "@/features/auth/password-policy";
import type { Locale } from "@/lib/i18n/locale";
import { PasswordInput } from "./password-input";

const resetText: Record<
  Locale,
  {
    confirmPassword: string;
    invalidLink: string;
    login: string;
    mismatch: string;
    newPassword: string;
    passwordHint: string;
    passwordValid: string;
    passwordsMatch: string;
    submit: string;
    success: string;
    title: string;
    unknownError: string;
  }
> = {
  en: {
    confirmPassword: "Confirm new password",
    invalidLink: "This password reset link is missing, invalid, or expired. Request a new link from the login screen.",
    login: "Return to login",
    mismatch: "The new passwords do not match.",
    newPassword: "New password",
    passwordHint: "Use 8 to 15 characters and include at least one uppercase letter, lowercase letter, number, and special character. Spaces are not allowed.",
    passwordValid: "Password requirements met.",
    passwordsMatch: "The new passwords match.",
    submit: "Change password",
    success: "Your password was changed. All existing sessions were signed out.",
    title: "Reset your GateLM password",
    unknownError: "The password could not be changed. Request a new reset link and try again."
  },
  ko: {
    confirmPassword: "새 비밀번호 확인",
    invalidLink: "비밀번호 재설정 링크가 없거나 유효하지 않거나 만료되었습니다. 로그인 화면에서 새 링크를 요청하세요.",
    login: "로그인으로 돌아가기",
    mismatch: "새 비밀번호가 일치하지 않습니다.",
    newPassword: "새 비밀번호",
    passwordHint: "비밀번호는 8자 이상 15자 이하이며, 영문 대문자·소문자·숫자·특수문자를 각각 1개 이상 포함해야 합니다. 공백은 사용할 수 없습니다.",
    passwordValid: "비밀번호 규칙을 충족했습니다.",
    passwordsMatch: "새 비밀번호가 일치합니다.",
    submit: "비밀번호 변경",
    success: "비밀번호를 변경했습니다. 기존 로그인 세션은 모두 로그아웃되었습니다.",
    title: "GateLM 비밀번호 재설정",
    unknownError: "비밀번호를 변경하지 못했습니다. 새 재설정 링크를 요청한 뒤 다시 시도하세요."
  }
};

export function PasswordResetForm({ locale }: { locale: Locale }) {
  const text = resetText[locale];
  const [token, setToken] = useState<string | null>(null);
  const [isTokenReady, setIsTokenReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const isNewPasswordValid = isPasswordPolicySatisfied(newPassword);
  const isConfirmationValid =
    isNewPasswordValid &&
    passwordConfirmation.length > 0 &&
    newPassword === passwordConfirmation;

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get("token"));
    setIsTokenReady(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || isSubmitting) {
      return;
    }
    if (!isNewPasswordValid) {
      setError(text.passwordHint);
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setError(text.mismatch);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        body: JSON.stringify({ newPassword, token }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? text.unknownError);
      }

      setToken(null);
      setIsComplete(true);
      setNewPassword("");
      setPasswordConfirmation("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : text.unknownError);
    } finally {
      setIsSubmitting(false);
    }
  }

  const isInvalid = isTokenReady && !token && !isComplete;

  return (
    <main className="password-reset-page">
      <section className="password-reset-card" aria-labelledby="password-reset-title">
        <Link className="password-reset-brand" href="/" aria-label="GateLM home">
          <GateLMLogo />
        </Link>
        <div className="password-reset-heading">
          <KeyRound aria-hidden="true" size={24} strokeWidth={2.2} />
          <h1 id="password-reset-title">{text.title}</h1>
        </div>

        {isComplete ? (
          <div className="password-reset-result" data-status="success">
            <CheckCircle2 aria-hidden="true" size={22} strokeWidth={2.2} />
            <p>{text.success}</p>
          </div>
        ) : null}
        {isInvalid ? (
          <p className="password-reset-result" data-status="error" role="alert">
            {text.invalidLink}
          </p>
        ) : null}
        {error ? (
          <p className="password-reset-result" data-status="error" role="alert">
            {error}
          </p>
        ) : null}

        {token && !isComplete ? (
          <form className="password-reset-form" onSubmit={submit}>
            <div className="password-reset-field">
              <label htmlFor="reset-new-password">{text.newPassword}</label>
              <PasswordInput
                id="reset-new-password"
                aria-invalid={newPassword.length > 0 && !isNewPasswordValid}
                autoComplete="new-password"
                isValid={isNewPasswordValid}
                locale={locale}
                maxLength={15}
                minLength={8}
                name="newPassword"
                native
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                required
                value={newPassword}
              />
              <small>{text.passwordHint}</small>
              {isNewPasswordValid ? (
                <span className="password-validation-message password-validation-message-success" role="status">
                  ✓ {text.passwordValid}
                </span>
              ) : null}
            </div>
            <div className="password-reset-field">
              <label htmlFor="reset-password-confirmation">{text.confirmPassword}</label>
              <PasswordInput
                id="reset-password-confirmation"
                aria-invalid={passwordConfirmation.length > 0 && !isConfirmationValid}
                autoComplete="new-password"
                isValid={isConfirmationValid}
                locale={locale}
                maxLength={15}
                minLength={8}
                name="passwordConfirmation"
                native
                onChange={(event) => setPasswordConfirmation(event.currentTarget.value)}
                required
                value={passwordConfirmation}
              />
              {passwordConfirmation.length > 0 ? (
                <span
                  className={`password-validation-message ${
                    isConfirmationValid
                      ? "password-validation-message-success"
                      : "password-validation-message-error"
                  }`}
                  role={isConfirmationValid ? "status" : "alert"}
                >
                  {isConfirmationValid ? `✓ ${text.passwordsMatch}` : text.mismatch}
                </span>
              ) : null}
            </div>
            <button disabled={isSubmitting} type="submit">
              {text.submit}
            </button>
          </form>
        ) : null}

        <Link className="password-reset-login" href="/?auth=login">
          {text.login}
        </Link>
      </section>
    </main>
  );
}
