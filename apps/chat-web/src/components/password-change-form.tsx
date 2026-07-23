'use client';

import { Button, Card, Input } from '@gatelm/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { api } from '@/lib/browser-api';

export function PasswordChangeForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const formData = new FormData(event.currentTarget);
    const currentPassword = formValue(formData, 'currentPassword');
    const newPassword = formValue(formData, 'newPassword');
    if (newPassword !== formValue(formData, 'passwordConfirmation')) {
      setError('비밀번호 확인이 일치하지 않습니다.');
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
        현재 비밀번호를 확인한 뒤 15자 이상의 새 비밀번호를 입력하세요. 변경하면
        Dashboard와 Tenant Chat의 기존 로그인 세션이 모두 종료됩니다.
      </p>
      {error ? <div className="error-box" role="alert">{error}</div> : null}
      <form className="form-stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="current-password">현재 비밀번호</label>
          <Input
            autoComplete="current-password"
            id="current-password"
            maxLength={256}
            name="currentPassword"
            required
            type="password"
          />
        </div>
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
        <p className="field-help">
          흔하거나 반복된 비밀번호는 사용할 수 없습니다.
        </p>
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

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}
