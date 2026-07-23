'use client';

import { Button, Card } from '@gatelm/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { api } from '@/lib/browser-api';
import {
  isPasswordPolicySatisfied,
  PASSWORD_POLICY_MESSAGE_KO,
} from '@/lib/password-policy';
import { PasswordInput } from './password-input';

export function PasswordChangeForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (sameAsCurrent) {
      setError('현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.');
      return;
    }
    if (!meetsPolicy) {
      setError(PASSWORD_POLICY_MESSAGE_KO);
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api<{ passwordChanged: true }>(
        '/api/tenant-chat/auth/password/change',
        {
          body: JSON.stringify({ currentPassword, newPassword }),
          method: 'POST',
        },
      );
      router.replace('/login?passwordChanged=1');
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '비밀번호를 변경하지 못했습니다.',
      );
      setBusy(false);
    }
  }

  return (
    <Card className="auth-panel">
      <h2>GateLM Chat 비밀번호 변경</h2>
      <p className="auth-lead">
        새 비밀번호는 8자 이상 15자 이하이며, 영문 대문자·소문자·숫자·특수문자를
        각각 1개 이상 포함해야 합니다. 공백은 사용할 수 없습니다. 변경하면
        Dashboard와 Tenant Chat의 기존 로그인 세션이 모두 종료됩니다.
      </p>
      {error ? <div className="error-box" role="alert">{error}</div> : null}
      <form className="form-stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="current-password">현재 비밀번호</label>
          <PasswordInput
            autoComplete="current-password"
            id="current-password"
            maxLength={256}
            name="currentPassword"
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            required
            value={currentPassword}
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">새 비밀번호</label>
          <PasswordInput
            aria-invalid={sameAsCurrent || (newPassword.length > 0 && !meetsPolicy)}
            autoComplete="new-password"
            id="new-password"
            isValid={isNewPasswordValid}
            maxLength={15}
            minLength={8}
            name="newPassword"
            onChange={(event) => setNewPassword(event.currentTarget.value)}
            required
            value={newPassword}
          />
        </div>
        {sameAsCurrent ? (
          <p className="password-validation-message password-validation-message-error" role="alert">
            현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.
          </p>
        ) : isNewPasswordValid ? (
          <p className="password-validation-message password-validation-message-success" role="status">
            ✓ 비밀번호 규칙을 충족했습니다.
          </p>
        ) : (
          <p className="field-help">{PASSWORD_POLICY_MESSAGE_KO}</p>
        )}
        <div className="field">
          <label htmlFor="password-confirmation">새 비밀번호 확인</label>
          <PasswordInput
            aria-invalid={passwordConfirmation.length > 0 && !isConfirmationValid}
            autoComplete="new-password"
            id="password-confirmation"
            isValid={isConfirmationValid}
            maxLength={15}
            minLength={8}
            name="passwordConfirmation"
            onChange={(event) => setPasswordConfirmation(event.currentTarget.value)}
            required
            value={passwordConfirmation}
          />
        </div>
        {passwordConfirmation.length > 0 ? (
          <p
            className={`password-validation-message ${
              isConfirmationValid
                ? 'password-validation-message-success'
                : 'password-validation-message-error'
            }`}
            role={isConfirmationValid ? 'status' : 'alert'}
          >
            {isConfirmationValid ? '✓ 새 비밀번호가 일치합니다.' : '새 비밀번호가 일치하지 않습니다.'}
          </p>
        ) : null}
        <div className="form-actions">
          <Button disabled={busy} type="submit">
            {busy ? '변경하는 중…' : '비밀번호 변경'}
          </Button>
        </div>
      </form>
      <Link className="auth-link" href="/">
        채팅으로 돌아가기
      </Link>
    </Card>
  );
}
