import { AuthLayout } from '@/components/auth-layout';
import { PasswordResetForm } from '@/components/password-reset-form';

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <PasswordResetForm />
    </AuthLayout>
  );
}
