'use client';

import { Badge, Button, Card, Input } from '@gatelm/ui';
import { Building2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import type { ChatSession, InvitationSummary } from '@/lib/auth-types';
import { api, startGoogle } from '@/lib/browser-api';
import {
  isPasswordPolicySatisfied,
  PASSWORD_POLICY_MESSAGE_KO,
} from '@/lib/password-policy';
import { PasswordInput } from './password-input';

export function InvitationForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [invite, setInvite] = useState<InvitationSummary | null>(null);
  const entryError = params.get('error');
  const [error, setError] = useState(
    entryError === 'invalid'
      ? '초대 링크가 올바르지 않거나 만료되었습니다.'
      : entryError === 'unavailable'
        ? '초대 확인 서비스에 잠시 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
        : '',
  );
  const [busy, setBusy] = useState(true);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const requiresNewPassword = invite?.accountState !== 'existing';
  const isNewPasswordValid =
    Boolean(requiresNewPassword) && isPasswordPolicySatisfied(password);
  const isConfirmationValid =
    isNewPasswordValid &&
    passwordConfirmation.length > 0 &&
    password === passwordConfirmation;

  useEffect(() => {
    api<InvitationSummary>('/api/tenant-chat/invitations/resolve')
      .then(setInvite)
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : '초대를 확인하지 못했습니다.',
        ),
      )
      .finally(() => setBusy(false));
  }, []);

  function finish(session: ChatSession) {
    router.replace(session.state === 'authenticated' ? '/' : '/tenants');
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite) return;
    if (invite.accountState !== 'existing' && !isNewPasswordValid) {
      setError(PASSWORD_POLICY_MESSAGE_KO);
      return;
    }
    if (
      invite.accountState !== 'existing' &&
      password !== passwordConfirmation
    ) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (invite.accountState !== 'existing') {
        finish(
          await api<ChatSession>('/api/tenant-chat/invitations/accept-password', {
            body: JSON.stringify({ name: form.get('name'), password }),
            method: 'POST',
          }),
        );
      } else {
        await api<ChatSession>('/api/tenant-chat/auth/login', {
          body: JSON.stringify({ email: invite.email, password }),
          method: 'POST',
        });
        finish(
          await api<ChatSession>('/api/tenant-chat/invitations/bind-existing', {
            body: '{}',
            method: 'POST',
          }),
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '초대를 수락하지 못했습니다.');
      setBusy(false);
    }
  }

  return (
    <Card className="auth-panel">
      <Badge>Chat 초대</Badge>
      <h2 className="invitation-heading">
        {busy && !invite ? '초대를 확인하고 있어요' : '조직 초대 확인'}
      </h2>
      <p className="auth-lead">초대받은 조직과 계정을 확인한 뒤 시작하세요.</p>
      {error ? <div className="error-box" role="alert">{error}</div> : null}
      {invite ? (
        <>
          <div className="info-box">
            <strong>
              <Building2 className="inline-heading-icon" size={17} aria-hidden />
              {invite.tenantName}
            </strong>
            <br />
            {invite.email}
          </div>
          <form className="form-stack invitation-form" onSubmit={submit}>
            {invite.accountState !== 'existing' ? (
              <div className="field">
                <label htmlFor="name">이름</label>
                <Input
                  autoComplete="name"
                  defaultValue={invite.employeeName ?? ''}
                  id="name"
                  name="name"
                  required
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="password">
                {invite.accountState !== 'existing' ? '새 비밀번호' : '기존 계정 비밀번호'}
              </label>
              <PasswordInput
                aria-invalid={
                  invite.accountState !== 'existing' &&
                  password.length > 0 &&
                  !isNewPasswordValid
                }
                autoComplete={
                  invite.accountState !== 'existing' ? 'new-password' : 'current-password'
                }
                id="password"
                isValid={isNewPasswordValid}
                maxLength={invite.accountState !== 'existing' ? 15 : 256}
                minLength={invite.accountState !== 'existing' ? 8 : 1}
                name="password"
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
                value={password}
              />
            </div>
            {invite.accountState !== 'existing' ? (
              <>
                <p className="field-help">{PASSWORD_POLICY_MESSAGE_KO}</p>
                {isNewPasswordValid ? (
                  <p className="password-validation-message password-validation-message-success" role="status">
                    ✓ 비밀번호 규칙을 충족했습니다.
                  </p>
                ) : null}
                <div className="field">
                  <label htmlFor="passwordConfirmation">새 비밀번호 확인</label>
                  <PasswordInput
                    aria-invalid={passwordConfirmation.length > 0 && !isConfirmationValid}
                    autoComplete="new-password"
                    id="passwordConfirmation"
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
              </>
            ) : null}
            <Button disabled={busy} type="submit">
              {busy
                ? '처리하는 중…'
                : invite.accountState === 'new'
                  ? '계정 만들고 시작'
                  : invite.accountState === 'reclaimable'
                    ? '새 비밀번호 설정하고 시작'
                    : '로그인하고 초대 수락'}
            </Button>
            <div className="divider" aria-hidden>또는</div>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                startGoogle().catch((reason) => {
                  setBusy(false);
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : 'Google 로그인을 시작하지 못했습니다.',
                  );
                });
              }}
              type="button"
              variant="secondary"
            >
              <span className="google-mark" aria-hidden>G</span> Google로 초대 수락
            </Button>
          </form>
          {invite.accountState === 'existing' ? (
            <p className="helper">기존 계정의 비밀번호나 로그인 제공자는 변경되지 않습니다.</p>
          ) : null}
          {invite.accountState === 'reclaimable' ? (
            <p className="helper">
              이전 조직 연결이 종료된 계정입니다. 새 비밀번호를 설정하면 이전 로그인은
              모두 종료됩니다.
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
