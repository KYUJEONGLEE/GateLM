'use client';

import { Button, Card } from '@gatelm/ui';
import { Building2, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { ChatSession } from '@/lib/auth-types';
import { api } from '@/lib/browser-api';

export function TenantPicker() {
  const router = useRouter();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { api<ChatSession>('/api/auth/session').then((value) => { if (value.state === 'authenticated') router.replace('/'); else setSession(value); }).catch(() => router.replace('/login')); }, [router]);
  async function select(tenantId: string) {
    setBusy(tenantId); setError('');
    try { await api<ChatSession>('/api/auth/tenant', { body: JSON.stringify({ tenantId }), method: 'POST' }); router.replace('/'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '조직을 선택하지 못했습니다.'); setBusy(''); }
  }
  return <Card className="auth-panel">
    <h2>사용할 조직을 선택하세요</h2>
    <p className="auth-lead">선택한 조직의 정책과 모델 연결이 Chat에 적용됩니다.</p>
    {error && <div className="error-box" role="alert">{error}</div>}
    {!session ? <div className="info-box" role="status">조직 정보를 불러오는 중…</div> : <div className="tenant-list">
      {session.tenants.map((tenant) => <button className="tenant-option" key={tenant.id} disabled={Boolean(busy)} onClick={() => select(tenant.id)}>
        <span><strong><Building2 size={17} aria-hidden style={{ verticalAlign: '-3px', marginRight: 7 }} />{tenant.name}</strong><span>{tenant.actorKind === 'tenant_admin' ? '조직 관리자' : '직원'}</span></span>
        {busy === tenant.id ? '연결 중…' : <ChevronRight size={20} aria-hidden />}
      </button>)}
    </div>}
    <Button variant="ghost" onClick={() => router.replace('/login')}>다른 계정으로 로그인</Button>
  </Card>;
}
