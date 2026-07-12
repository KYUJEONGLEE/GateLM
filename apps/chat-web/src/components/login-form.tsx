'use client';

import { Button, Card, Input } from '@gatelm/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';

import type { ChatSession } from '@/lib/auth-types';
import { api, startGoogle } from '@/lib/browser-api';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get('error') === 'oauth' ? 'Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.' : '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const session = await api<ChatSession>('/api/auth/login', {
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }), method: 'POST',
      });
      router.replace(session.state === 'authenticated' ? '/' : '/tenants');
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '로그인하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  return <Card className="auth-panel">
    <h2>GateLM Chat 로그인</h2>
    <p className="auth-lead">관리자가 초대한 회사 계정으로 로그인하세요.</p>
    <form className="form-stack" onSubmit={submit}>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="field"><label htmlFor="email">이메일</label><Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required placeholder="name@company.com" /></div>
      <div className="field"><label htmlFor="password">비밀번호</label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      <div className="form-actions"><Button disabled={busy} type="submit">{busy ? '확인하는 중…' : '로그인'}</Button></div>
      <div className="divider" aria-hidden>또는</div>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => { setBusy(true); startGoogle().catch((reason) => { setBusy(false); setError(reason instanceof Error ? reason.message : 'Google 로그인을 시작하지 못했습니다.'); }); }}><span className="google-mark" aria-hidden>G</span> Google로 계속</Button>
    </form>
    <p className="helper">GateLM Chat은 공개 회원가입을 제공하지 않습니다.<br />접근이 필요하면 조직 관리자에게 초대를 요청하세요.</p>
  </Card>;
}
