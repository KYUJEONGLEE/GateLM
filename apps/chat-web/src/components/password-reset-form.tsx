'use client';

import { Button, Card } from '@gatelm/ui';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { api } from '@/lib/browser-api';
import {
  isPasswordPolicySatisfied,
  PASSWORD_POLICY_INVALID_MESSAGE_KO,
  PASSWORD_POLICY_MESSAGE_KO,
} from '@/lib/password-policy';
import { PasswordInput } from './password-input';

export function PasswordResetForm() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [hasNewPasswordBlurred, setHasNewPasswordBlurred] = useState(false);
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const isNewPasswordValid = isPasswordPolicySatisfied(newPassword);
  const showPasswordPolicyError =
    hasNewPasswordBlurred && newPassword.length > 0 && !isNewPasswordValid;
  const isConfirmationValid =
    isNewPasswordValid &&
    passwordConfirmation.length > 0 &&
    newPassword === passwordConfirmation;

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get('token'));
    setTokenReady(true);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;
    if (!isNewPasswordValid) {
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
      await api<{ passwordReset: true }>(
        '/api/tenant-chat/auth/password-reset/confirm',
        {
          body: JSON.stringify({ newPassword, token }),
          method: 'POST',
        },
      );
      setToken(null);
      setComplete(true);
      setNewPassword('');
      setHasNewPasswordBlurred(false);
      setPasswordConfirmation('');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '비밀번호를 재설정하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }

  const invalid = tokenReady && !token && !complete;

  return (
    <Card className="auth-panel">
      <h2>GateLM Chat 비밀번호 재설정</h2>
      <p className="auth-lead">새 {PASSWORD_POLICY_MESSAGE_KO}</p>
      {complete ? (
        <div className="success-box" role="status">
          비밀번호를 재설정했습니다. 기존 Dashboard와 Tenant Chat 로그인 세션은 모두
          로그아웃되었습니다.
        </div>
      ) : null}
      {invalid ? (
        <div className="error-box" role="alert">
          재설정 링크가 없거나 유효하지 않거나 만료되었습니다. 로그인 화면에서 새
          링크를 요청하세요.
        </div>
      ) : null}
      {error ? <div className="error-box" role="alert">{error}</div> : null}
      {token && !complete ? (
        <form className="form-stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="new-password">새 비밀번호</label>
            <PasswordInput
              aria-invalid={showPasswordPolicyError}
              autoComplete="new-password"
              id="new-password"
              isValid={isNewPasswordValid}
              maxLength={15}
              minLength={8}
              name="newPassword"
              onBlur={() => setHasNewPasswordBlurred(true)}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              required
              value={newPassword}
            />
          </div>
          {showPasswordPolicyError ? (
            <p className="password-validation-message password-validation-message-error" role="alert">
              {PASSWORD_POLICY_INVALID_MESSAGE_KO}
            </p>
          ) : isNewPasswordValid ? (
            <p className="password-validation-message password-validation-message-success" role="status">
              ✓ 비밀번호 규칙을 충족했습니다.
            </p>
          ) : null}
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
              {busy ? '변경하는 중…' : '비밀번호 재설정'}
            </Button>
          </div>
        </form>
      ) : null}
      <Link className="auth-link" href={complete ? '/login?passwordReset=1' : '/login'}>
        로그인으로 돌아가기
      </Link>
    </Card>
  );
}
