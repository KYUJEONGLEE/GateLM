'use client';

import { Button, Card, Input } from '@gatelm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';

import type { ChatSession } from '@/lib/auth-types';
import { api, ChatApiError } from '@/lib/browser-api';

type LoginMode = 'login' | 'recovery';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<LoginMode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    params.get('error') === 'oauth'
      ? 'Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.'
      : '',
  );
  const [notice, setNotice] = useState(() => {
    if (params.get('passwordChanged') === '1') {
      return '비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인하세요.';
    }
    if (params.get('passwordReset') === '1') {
      return '비밀번호를 재설정했습니다. 새 비밀번호로 로그인하세요.';
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
          ? '이메일 또는 비밀번호가 올바르지 않습니다.'
          : reason instanceof Error
            ? reason.message
            : '로그인하지 못했습니다.',
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
        '해당되는 계정이 있다면 재설정 링크를 보냈습니다. 받은편지함과 스팸함을 확인하세요.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '재설정 요청을 처리하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="auth-panel">
      <h2>{mode === 'login' ? 'GateLM Chat 로그인' : '아이디 확인 및 비밀번호 재설정'}</h2>
      <p className="auth-lead">
        {mode === 'login'
          ? '관리자가 초대한 회사 계정으로 로그인하세요.'
          : '로그인 아이디는 초대받은 이메일입니다. 해당 이메일로 일회용 재설정 링크를 보내드립니다.'}
      </p>
      {notice ? <div className="success-box" role="status">{notice}</div> : null}
      {mode === 'login' ? (
        <form className="form-stack" onSubmit={submitLogin}>
          {error ? <div className="error-box" role="alert">{error}</div> : null}
          <div className="field">
            <label htmlFor="email">이메일</label>
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
            <label htmlFor="password">비밀번호</label>
            <Input
              autoComplete="current-password"
              id="password"
              maxLength={256}
              name="password"
              required
              type="password"
            />
          </div>
          <p className="field-help">로그인 아이디는 초대받거나 가입할 때 사용한 이메일입니다.</p>
          <button
            className="auth-text-button"
            disabled={busy}
            onClick={() => selectMode('recovery')}
            type="button"
          >
            아이디 또는 비밀번호를 잊으셨나요?
          </button>
          <div className="form-actions">
            <Button disabled={busy} type="submit">
              {busy ? '확인하는 중…' : '로그인'}
            </Button>
          </div>
        </form>
      ) : (
        <form className="form-stack" onSubmit={requestPasswordReset}>
          {error ? <div className="error-box" role="alert">{error}</div> : null}
          <div className="field">
            <label htmlFor="recovery-email">가입·초대 이메일</label>
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
              {busy ? '요청하는 중…' : '재설정 링크 보내기'}
            </Button>
          </div>
          <button
            className="auth-text-button"
            disabled={busy}
            onClick={() => selectMode('login')}
            type="button"
          >
            로그인으로 돌아가기
          </button>
        </form>
      )}
      <p className="helper">
        GateLM Chat은 공개 회원가입을 제공하지 않습니다.<br />
        이메일이 기억나지 않으면 초대 메일을 확인하거나 조직 관리자에게 문의하세요.
      </p>
    </Card>
  );
}
