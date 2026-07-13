import { Suspense } from 'react';

import { AuthLayout } from '@/components/auth-layout';
import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<p role="status">로그인 화면을 준비하는 중…</p>}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
