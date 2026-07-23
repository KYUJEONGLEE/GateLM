"use client";

import { CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { GateLMLogo } from "@/components/brand/gatelm-logo";
import type { Locale } from "@/lib/i18n/locale";

const resetText: Record<
  Locale,
  {
    confirmPassword: string;
    invalidLink: string;
    login: string;
    mismatch: string;
    newPassword: string;
    passwordHint: string;
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
    mismatch: "The password confirmation does not match.",
    newPassword: "New password",
    passwordHint: "Use at least 15 characters. Common or repeated passwords are blocked.",
    submit: "Change password",
    success: "Your password was changed. All existing sessions were signed out.",
    title: "Reset your GateLM password",
    unknownError: "The password could not be changed. Request a new reset link and try again."
  },
  ko: {
    confirmPassword: "새 비밀번호 확인",
    invalidLink: "비밀번호 재설정 링크가 없거나 유효하지 않거나 만료되었습니다. 로그인 화면에서 새 링크를 요청하세요.",
    login: "로그인으로 돌아가기",
    mismatch: "비밀번호 확인이 일치하지 않습니다.",
    newPassword: "새 비밀번호",
    passwordHint: "15자 이상 입력하세요. 흔하거나 반복된 비밀번호는 사용할 수 없습니다.",
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

    const form = event.currentTarget;
    const formData = new FormData(form);
    const newPassword = readFormValue(formData, "newPassword");
    const passwordConfirmation = readFormValue(formData, "passwordConfirmation");
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
      form.reset();
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
            <label>
              <span>{text.newPassword}</span>
              <input
                autoComplete="new-password"
                maxLength={256}
                minLength={15}
                name="newPassword"
                required
                type="password"
              />
              <small>{text.passwordHint}</small>
            </label>
            <label>
              <span>{text.confirmPassword}</span>
              <input
                autoComplete="new-password"
                maxLength={256}
                minLength={15}
                name="passwordConfirmation"
                required
                type="password"
              />
            </label>
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

function readFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
