import { WebConsoleInitView } from "@/features/onboarding/components/web-console-init-view";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/locale";

export default async function HomePage() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? "ko");

  return <WebConsoleInitView locale={locale} />;
}
