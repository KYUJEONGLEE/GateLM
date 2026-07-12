import { MessageSquareText } from 'lucide-react';
import type { ReactNode } from 'react';

export function AuthLayout({ children, invitation = false }: { children: ReactNode; invitation?: boolean }) {
  return <main className="auth-page">
    <section className="auth-aside" aria-label="GateLM Chat 소개">
      <div className="brand"><span className="brand-mark"><MessageSquareText size={21} aria-hidden /></span>GateLM Chat</div>
      <div className="aside-copy">
        <h1>{invitation ? '팀과 함께할 준비가 되었어요.' : '업무의 맥락을 잇는 안전한 AI 대화.'}</h1>
        <p>{invitation ? '초대한 조직과 계정을 확인하고 GateLM Chat을 시작하세요.' : '조직의 정책과 권한 안에서 필요한 모델을 한곳에서 사용하세요.'}</p>
      </div>
      <div className="aside-note">GateLM이 조직의 모델 연결과 접근 권한을 안전하게 관리합니다.</div>
    </section>
    <section className="auth-main">{children}</section>
  </main>;
}
