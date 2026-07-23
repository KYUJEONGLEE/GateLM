'use client';

import { Button, Card, Input } from '@gatelm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';

import type { ChatSession } from '@/lib/auth-types';
import { api, ChatApiError } from '@/lib/browser-api';
import { PasswordInput } from './password-input';

type LoginMode = 'login' | 'recovery';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<LoginMode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    params.get('error') === 'oauth'
      ? 'Google ???? ???? ?????. ?? ??? ???.'
      : '',
  );
  const [notice, setNotice] = useState(() => {
    if (params.get('passwordChanged') === '1') {
      return '????? ??????. ? ????? ?? ??????.';
    }
    if (params.get('passwordReset') === '1') {
      return '????? ???????. ? ????? ??????.';
    }
    return '';
  });

  function selectMode(nextMode: LoginMode) {
    setMode(nextMode);
    setError('');
    setNotice('');
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const session = await api<ChatSession>('/api/tenant-chat/auth/login', {
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
        method: 'POST',
      });
      router.replace(session.state === 'authenticated' ? '/' : '/tenants');
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof ChatApiError && reason.status === 401
          ? '??? ?? ????? ???? ????.'
          : reason instanceof Error
            ? reason.message
            : '????? ?????.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      await api<{ accepted: true }>(
        '/api/tenant-chat/auth/password-reset/request',
        {
          body: JSON.stringify({ email: form.get('email') }),
          method: 'POST',
        },
      );
      setNotice(
        '???? ??? ??? ??? ??? ?????. ?????? ???? ?????.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '??? ??? ???? ?????.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="auth-panel">
      <h2>{mode === 'login' ? 'GateLM Chat ???' : '??? ?? ? ???? ???'}</h2>
      <p className="auth-lead">
        {mode === 'login'
          ? 'Dashboard? ????? ???? ??? ?? ???? ??????.'
          : '??? ???? ???? ??????. ?? ???? ??? ??? ??? ??????.'}
      </p>
      {notice ? <div className="success-box" role="status">{notice}</div> : null}
      {mode === 'login' ? (
        <form className="form-stack" onSubmit={submitLogin}>
          {error ? <div className="error-box" role="alert">{error}</div> : null}
          <div className="field">
            <label htmlFor="email">???</label>
            <Input
              autoComplete="username"
              id="email"
              inputMode="email"
              maxLength={254}
              name="email"
              placeholder="name@company.com"
              required
              type="email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">????</label>
            <PasswordInput
              autoComplete="current-password"
              id="password"
              maxLength={256}
              name="password"
              required
            />
          </div>
          <p className="field-help">??? ???? ????? ??? ? ??? ??????.</p>
          <button
            className="auth-text-button"
            disabled={busy}
            onClick={() => selectMode('recovery')}
            type="button"
          >
            ??? ?? ????? ??????
          </button>
          <div className="form-actions">
            <Button disabled={busy} type="submit">
              {busy ? '???? ??' : '???'}
            </Button>
          </div>
        </form>
      ) : (
        <form className="form-stack" onSubmit={requestPasswordReset}>
          {error ? <div className="error-box" role="alert">{error}</div> : null}
          <div className="field">
            <label htmlFor="recovery-email">????? ???</label>
            <Input
              autoComplete="email"
              id="recovery-email"
              inputMode="email"
              maxLength={254}
              name="email"
              placeholder="name@company.com"
              required
              type="email"
            />
          </div>
          <div className="form-actions">
            <Button disabled={busy} type="submit">
              {busy ? '???? ??' : '??? ?? ???'}
            </Button>
          </div>
          <button
            className="auth-text-button"
            disabled={busy}
            onClick={() => selectMode('login')}
            type="button"
          >
            ????? ????
          </button>
        </form>
      )}
      <p className="helper">
        GateLM Chat? ?? ????? ???? ????.<br />
        ???? ???? ??? ?? ??? ????? ?? ????? ?????.
      </p>
    </Card>
  );
}
