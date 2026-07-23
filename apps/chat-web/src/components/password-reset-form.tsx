'use client';

import { Button, Card, Input } from '@gatelm/ui';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { api } from '@/lib/browser-api';

export function PasswordResetForm() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get('token'));
    setTokenReady(true);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const newPassword = formValue(formData, 'newPassword');
    if (newPassword !== formValue(formData, 'passwordConfirmation')) {
      setError('비밀번호 확인이 일치하지 않습니다.');
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
      form.reset();
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
      <p className="auth-lead">
        새 비밀번호는 15자 이상이어야 하며 흔하거나 반복된 값은 사용할 수 없습니다.
      </p>
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
            <Input
              autoComplete="new-password"
              id="new-password"
              maxLength={256}
              minLength={15}
              name="newPassword"
              required
              type="password"
            />
          </div>
          <div className="field">
            <label htmlFor="password-confirmation">새 비밀번호 확인</label>
            <Input
              autoComplete="new-password"
              id="password-confirmation"
              maxLength={256}
              minLength={15}
              name="passwordConfirmation"
              required
              type="password"
            />
          </div>
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

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}
