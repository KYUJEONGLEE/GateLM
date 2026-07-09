import { WebConsoleInitView } from "@/features/onboarding/components/web-console-init-view";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/locale";

const sessionCookieNames = ["gatelm_session", "gatelm_onboarding"] as const;
const defaultDashboardTenantId = "tenant_demo_acme";

export default async function HomePage() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? "ko");
  const hasSessionCookie = sessionCookieNames.some((name) => cookieStore.has(name));
  const initialAuthStatus = hasSessionCookie
    ? "authenticated"
    : "anonymous";
  const initialDashboardTenantId = hasSessionCookie ? defaultDashboardTenantId : null;

  return (
    <WebConsoleInitView
      initialAuthStatus={initialAuthStatus}
      initialDashboardTenantId={initialDashboardTenantId}
      locale={locale}
    />
  );
}
