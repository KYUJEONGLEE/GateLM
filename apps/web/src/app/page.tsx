import { WebConsoleInitView } from "@/features/onboarding/components/web-console-init-view";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/locale";

const sessionCookieNames = ["gatelm_session", "gatelm_onboarding"] as const;

export default async function HomePage() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? "ko");
  const initialAuthStatus = sessionCookieNames.some((name) => cookieStore.has(name))
    ? "authenticated"
    : "anonymous";

  return <WebConsoleInitView initialAuthStatus={initialAuthStatus} locale={locale} />;
}
