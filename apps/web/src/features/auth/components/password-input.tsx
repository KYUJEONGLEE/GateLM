"use client";

import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useState, type ComponentPropsWithoutRef } from "react";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  isValid?: boolean;
  locale: Locale;
  native?: boolean;
};

export function PasswordInput({
  className,
  isValid = false,
  locale,
  native = false,
  ...props
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  const showLabel = locale === "ko" ? "비밀번호 보기" : "Show password";
  const hideLabel = locale === "ko" ? "비밀번호 숨기기" : "Hide password";
  const validLabel = locale === "ko" ? "입력 조건 충족" : "Requirements met";
  const inputClassName = cn("password-input-control", className);
  const inputProps = {
    ...props,
    className: inputClassName,
    type: isVisible ? "text" : "password"
  };

  return (
    <div className="password-input-wrapper">
      {native ? <input {...inputProps} /> : <Input {...inputProps} />}
      {isValid ? (
        <span aria-label={validLabel} className="password-input-valid-icon" role="img">
          <CheckCircle2 aria-hidden="true" size={18} strokeWidth={2.5} />
        </span>
      ) : null}
      <button
        aria-label={isVisible ? hideLabel : showLabel}
        aria-pressed={isVisible}
        className="password-visibility-toggle"
        onClick={() => setIsVisible((visible) => !visible)}
        title={isVisible ? hideLabel : showLabel}
        type="button"
      >
        {isVisible ? (
          <EyeOff aria-hidden="true" size={18} strokeWidth={2.2} />
        ) : (
          <Eye aria-hidden="true" size={18} strokeWidth={2.2} />
        )}
      </button>
    </div>
  );
}
