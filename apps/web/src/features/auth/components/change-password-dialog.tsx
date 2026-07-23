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
import { Input } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/locale";

const changePasswordText: Record<
  Locale,
  {
    cancel: string;
    confirmPassword: string;
    currentPassword: string;
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
    cancel: "Close",
    confirmPassword: "Confirm new password",
    currentPassword: "Current password",
    mismatch: "The password confirmation does not match.",
    newPassword: "New password",
    passwordHint: "Use at least 15 characters. Common or repeated passwords are blocked.",
    submit: "Change password",
    success: "Password changed. Your other GateLM sessions were signed out.",
    title: "Change password",
    unknownError: "The password could not be changed."
  },
  ko: {
    cancel: "닫기",
    confirmPassword: "새 비밀번호 확인",
    currentPassword: "현재 비밀번호",
    mismatch: "비밀번호 확인이 일치하지 않습니다.",
    newPassword: "새 비밀번호",
    passwordHint: "15자 이상 입력하세요. 흔하거나 반복된 비밀번호는 사용할 수 없습니다.",
    submit: "비밀번호 변경",
    success: "비밀번호를 변경했습니다. 다른 GateLM 로그인 세션은 로그아웃되었습니다.",
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
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  function changeOpen(nextOpen: boolean) {
    if (!isSubmitting) {
      if (!nextOpen) {
        setError(null);
        setSuccess(null);
      }
      onOpenChange(nextOpen);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = readFormValue(formData, "currentPassword");
    const newPassword = readFormValue(formData, "newPassword");
    const passwordConfirmation = readFormValue(formData, "passwordConfirmation");
    if (newPassword !== passwordConfirmation) {
      setError(text.mismatch);
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess(null);
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

      form.reset();
      setSuccess(text.success);
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
        {success ? (
          <Alert variant="success">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        <form className="grid gap-4" id="change-password-form" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>{text.currentPassword}</span>
            <Input
              autoComplete="current-password"
              maxLength={256}
              name="currentPassword"
              required
              type="password"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>{text.newPassword}</span>
            <Input
              autoComplete="new-password"
              maxLength={256}
              minLength={15}
              name="newPassword"
              required
              type="password"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>{text.confirmPassword}</span>
            <Input
              autoComplete="new-password"
              maxLength={256}
              minLength={15}
              name="passwordConfirmation"
              required
              type="password"
            />
          </label>
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

function readFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
