'use client';

import { Input } from '@gatelm/ui';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { ComponentProps, useState } from 'react';

type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'> & {
  isValid?: boolean;
};

export function PasswordInput({
  className = '',
  isValid = false,
  ...props
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  const inputClassName = `password-input-control ${className}`.trim();

  return (
    <div className="password-input-wrapper">
      <Input
        {...props}
        className={inputClassName}
        type={isVisible ? 'text' : 'password'}
      />
      {isValid ? (
        <span aria-label="입력 조건 충족" className="password-input-valid-icon" role="img">
          <CheckCircle2 aria-hidden="true" size={18} strokeWidth={2.5} />
        </span>
      ) : null}
      <button
        aria-label={isVisible ? '비밀번호 숨기기' : '비밀번호 보기'}
        aria-pressed={isVisible}
        className="password-visibility-toggle"
        onClick={() => setIsVisible((visible) => !visible)}
        title={isVisible ? '비밀번호 숨기기' : '비밀번호 보기'}
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
