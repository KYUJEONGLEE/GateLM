"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import type { Locale } from "@/lib/i18n/locale";
import { isPasswordPolicySatisfied } from "@/features/auth/password-policy";
import { PasswordInput } from "./password-input";

const changePasswordText: Record<
  Locale,
  {
    cancel: string;
    confirmPassword: string;
    currentPassword: string;
    differentPassword: string;
    mismatch: string;
    newPassword: string;
    passwordHint: string;
    passwordValid: string;
    passwordsMatch: string;
    submit: string;
    title: string;
    unknownError: string;
  }
> = {
  en: {
    cancel: "Close",
    confirmPassword: "Confirm new password",
    currentPassword: "Current password",
    differentPassword: "Enter a new password that is different from your current password.",
    mismatch: "The password confirmation does not match.",
    newPassword: "New password",
    passwordHint: "Use 8 to 15 characters and include at least one uppercase letter, lowercase letter, number, and special character. Spaces are not allowed.",
    passwordValid: "Password requirements met.",
    passwordsMatch: "The new passwords match.",
    submit: "Change password",
    title: "Change password",
    unknownError: "The password could not be changed."
  },
  ko: {
    cancel: "닫기",
    confirmPassword: "새 비밀번호 확인",
    currentPassword: "현재 비밀번호",
    differentPassword: "현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.",
    mismatch: "새 비밀번호가 일치하지 않습니다.",
    newPassword: "새 비밀번호",
    passwordHint: "비밀번호는 8자 이상 15자 이하이며, 영문 대문자·소문자·숫자·특수문자를 각각 1개 이상 포함해야 합니다. 공백은 사용할 수 없습니다.",
    passwordValid: "비밀번호 규칙을 충족했습니다.",
    passwordsMatch: "새 비밀번호가 일치합니다.",
    submit: "비밀번호 변경",
    title: "비밀번호 변경",
    unknownError: "비밀번호를 변경하지 못했습니다."
  }
};

export function ChangePasswordDialog({
  locale,
  onOpenChange,
  open
}: {
  locale: Locale;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const text = changePasswordText[locale];
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sameAsCurrent =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    currentPassword === newPassword;
  const meetsPolicy = isPasswordPolicySatisfied(newPassword);
  const isNewPasswordValid = meetsPolicy && !sameAsCurrent;
  const isConfirmationValid =
    isNewPasswordValid &&
    passwordConfirmation.length > 0 &&
    newPassword === passwordConfirmation;

  function resetFormState() {
    setCurrentPassword("");
    setNewPassword("");
    setPasswordConfirmation("");
    setError(null);
  }

  function changeOpen(nextOpen: boolean) {
    if (!isSubmitting) {
      if (!nextOpen) {
        resetFormState();
      }
      onOpenChange(nextOpen);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    if (sameAsCurrent) {
      setError(text.differentPassword);
      return;
    }
    if (!meetsPolicy) {
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
      const response = await fetch("/api/auth/password/change", {
        body: JSON.stringify({ currentPassword, newPassword }),
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

      window.location.replace("/?auth=login&passwordChanged=1");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : text.unknownError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.passwordHint}</DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <form className="grid gap-4" id="change-password-form" onSubmit={submit}>
          <div className="grid gap-1.5 text-sm font-medium">
            <label htmlFor="change-current-password">{text.currentPassword}</label>
            <PasswordInput
              autoComplete="current-password"
              id="change-current-password"
              locale={locale}
              maxLength={256}
              name="currentPassword"
              onChange={(event) => setCurrentPassword(event.currentTarget.value)}
              required
              value={currentPassword}
            />
          </div>
          <div className="grid gap-1.5 text-sm font-medium">
            <label htmlFor="change-new-password">{text.newPassword}</label>
            <PasswordInput
              aria-invalid={sameAsCurrent || (newPassword.length > 0 && !meetsPolicy)}
              autoComplete="new-password"
              id="change-new-password"
              isValid={isNewPasswordValid}
              locale={locale}
              maxLength={15}
              minLength={8}
              name="newPassword"
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              required
              value={newPassword}
            />
            {sameAsCurrent ? (
              <span className="password-validation-message password-validation-message-error" role="alert">
                {text.differentPassword}
              </span>
            ) : isNewPasswordValid ? (
              <span className="password-validation-message password-validation-message-success" role="status">
                ✓ {text.passwordValid}
              </span>
            ) : null}
          </div>
          <div className="grid gap-1.5 text-sm font-medium">
            <label htmlFor="change-password-confirmation">{text.confirmPassword}</label>
            <PasswordInput
              aria-invalid={passwordConfirmation.length > 0 && !isConfirmationValid}
              autoComplete="new-password"
              id="change-password-confirmation"
              isValid={isConfirmationValid}
              locale={locale}
              maxLength={15}
              minLength={8}
              name="passwordConfirmation"
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
        </form>

        <DialogFooter>
          <Button
            disabled={isSubmitting}
            onClick={() => changeOpen(false)}
            type="button"
            variant="outline"
          >
            {text.cancel}
          </Button>
          <Button disabled={isSubmitting} form="change-password-form" type="submit">
            {text.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
