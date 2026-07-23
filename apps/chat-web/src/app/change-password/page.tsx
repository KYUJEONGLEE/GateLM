import { AuthLayout } from '@/components/auth-layout';
import { PasswordChangeForm } from '@/components/password-change-form';

export default function ChangePasswordPage() {
  return (
    <AuthLayout>
      <PasswordChangeForm />
    </AuthLayout>
  );
}
