import { PasswordResetForm } from "@/features/auth/components/password-reset-form";
import { getRequestLocale } from "@/lib/i18n/server-locale";

export default async function PasswordResetPage() {
  const locale = await getRequestLocale();

  return <PasswordResetForm locale={locale} />;
}
