'use client';

import { Badge, Button, Card, Input } from '@gatelm/ui';
import { Building2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import type { ChatSession, InvitationSummary } from '@/lib/auth-types';
import { api, startGoogle } from '@/lib/browser-api';

export function InvitationForm() {
  const router = useRouter(); const params = useSearchParams();
  const [invite, setInvite] = useState<InvitationSummary | null>(null);
  const entryError = params.get('error');
  const [error, setError] = useState(entryError === 'invalid'
    ? '초대 링크가 올바르지 않거나 만료되었습니다.'
    : entryError === 'unavailable' ? '초대 확인 서비스에 잠시 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' : '');
  const [busy, setBusy] = useState(true);
  useEffect(() => { api<InvitationSummary>('/api/tenant-chat/invitations/resolve').then(setInvite).catch((reason) => setError(reason instanceof Error ? reason.message : '초대를 확인하지 못했습니다.')).finally(() => setBusy(false)); }, []);

  function finish(session: ChatSession) { router.replace(session.state === 'authenticated' ? '/' : '/tenants'); router.refresh(); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!invite) return; setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (invite.accountState === 'new') {
        finish(await api<ChatSession>('/api/tenant-chat/invitations/accept-password', { body: JSON.stringify({ name: form.get('name'), password: form.get('password') }), method: 'POST' }));
      } else {
        await api<ChatSession>('/api/tenant-chat/auth/login', { body: JSON.stringify({ email: invite.email, password: form.get('password') }), method: 'POST' });
        finish(await api<ChatSession>('/api/tenant-chat/invitations/bind-existing', { body: '{}', method: 'POST' }));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '초대를 수락하지 못했습니다.'); setBusy(false); }
  }

  return <Card className="auth-panel">
    <Badge>Chat 초대</Badge>
    <h2 className="invitation-heading">{busy && !invite ? '초대를 확인하고 있어요' : '조직 초대 확인'}</h2>
    <p className="auth-lead">초대받은 조직과 계정을 확인한 뒤 시작하세요.</p>
    {error && <div className="error-box" role="alert">{error}</div>}
    {invite && <>
      <div className="info-box"><strong><Building2 className="inline-heading-icon" size={17} aria-hidden />{invite.tenantName}</strong><br />{invite.email}</div>
      <form className="form-stack invitation-form" onSubmit={submit}>
        {invite.accountState === 'new' && <div className="field"><label htmlFor="name">이름</label><Input id="name" name="name" defaultValue={invite.employeeName ?? ''} autoComplete="name" required /></div>}
        <div className="field"><label htmlFor="password">{invite.accountState === 'new' ? '새 비밀번호' : '기존 계정 비밀번호'}</label><Input id="password" name="password" type="password" minLength={8} autoComplete={invite.accountState === 'new' ? 'new-password' : 'current-password'} required /></div>
        <Button disabled={busy} type="submit">{busy ? '처리하는 중…' : invite.accountState === 'new' ? '계정 만들고 시작' : '로그인하고 초대 수락'}</Button>
        <div className="divider" aria-hidden>또는</div>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setBusy(true); startGoogle().catch((reason) => { setBusy(false); setError(reason instanceof Error ? reason.message : 'Google 로그인을 시작하지 못했습니다.'); }); }}><span className="google-mark" aria-hidden>G</span> Google로 초대 수락</Button>
      </form>
      {invite.accountState === 'existing' && <p className="helper">기존 계정의 비밀번호나 로그인 제공자는 변경되지 않습니다.</p>}
    </>}
  </Card>;
}
