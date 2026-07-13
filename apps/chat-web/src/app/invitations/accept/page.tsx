import { Suspense } from 'react';

import { AuthLayout } from '@/components/auth-layout';
import { InvitationForm } from '@/components/invitation-form';

export default function InvitationPage() {
  return (
    <AuthLayout invitation>
      <Suspense fallback={<p role="status">초대 화면을 준비하는 중…</p>}>
        <InvitationForm />
      </Suspense>
    </AuthLayout>
  );
}
