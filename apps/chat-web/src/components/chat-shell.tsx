'use client';

import { Badge, Button } from '@gatelm/ui';
import { Building2, LogOut, Menu, MessageSquareText, Plus, Send, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { ChatSession } from '@/lib/auth-types';
import { api } from '@/lib/browser-api';

export function ChatShell() {
  const router = useRouter(); const [session, setSession] = useState<ChatSession | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { api<ChatSession>('/api/auth/session').then((value) => { if (value.state !== 'authenticated') router.replace('/tenants'); else setSession(value); }).catch(() => router.replace('/login')); }, [router]);
  async function logout() { try { await api('/api/auth/logout', { body: '{}', method: 'POST' }); } finally { router.replace('/login'); router.refresh(); } }
  if (!session?.selectedTenant) return <main className="empty-chat"><div className="info-box" role="status">GateLM Chat을 준비하는 중…</div></main>;
  const displayName = session.user.name || session.user.email.split('@')[0];
  return <main className="chat-shell">
    {menuOpen && <button className="mobile-backdrop" aria-label="메뉴 닫기" onClick={() => setMenuOpen(false)} />}
    <aside className={`chat-sidebar${menuOpen ? ' is-open' : ''}`} aria-label="Chat 탐색">
      <div>
        <div className="brand"><span className="brand-mark"><MessageSquareText size={21} aria-hidden /></span>GateLM Chat</div>
        <nav className="chat-nav"><Link className="nav-item active" href="/" aria-current="page"><MessageSquareText size={19} aria-hidden />새 대화</Link><span className="nav-item" aria-disabled><Settings2 size={19} aria-hidden />모델 연결 대기</span></nav>
      </div>
      <div className="sidebar-account">
        <Badge><Building2 size={14} aria-hidden style={{ marginRight: 6 }} />{session.selectedTenant.name}</Badge>
        <div><div className="account-name">{displayName}</div><div className="account-email">{session.user.email}</div></div>
        <Button variant="ghost" onClick={logout}><LogOut size={17} aria-hidden />로그아웃</Button>
      </div>
    </aside>
    <section className="chat-main">
      <header className="chat-topbar">
        <Button className="mobile-menu" variant="ghost" aria-label="메뉴 열기" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={21} aria-hidden /></Button>
        <div className="topbar-title"><strong>새 대화</strong><span>{session.selectedTenant.name}</span></div>
        <Button variant="secondary" disabled><Plus size={17} aria-hidden />새 대화</Button>
      </header>
      <div className="chat-content">
        <div className="empty-chat"><div className="empty-chat-inner"><div className="empty-icon"><MessageSquareText size={30} aria-hidden /></div><h1>무엇을 함께 해결할까요?</h1><p>조직 관리자가 모델 연결을 완료하면 이곳에서 안전하게 대화를 시작할 수 있어요.</p></div></div>
        <div>
          <div className="composer" aria-disabled="true"><input disabled aria-label="메시지 입력" placeholder="관리자의 모델 연결이 필요합니다" /><Button disabled aria-label="보내기"><Send size={18} aria-hidden /></Button></div>
          <p className="composer-note">현재는 인증과 조직 연결을 확인하는 첫 번째 Chat shell입니다.</p>
        </div>
      </div>
    </section>
  </main>;
}
