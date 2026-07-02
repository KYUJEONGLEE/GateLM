import { WebConsoleInitView } from "@/features/onboarding/components/web-console-init-view";
import { getRequestLocale } from "@/lib/i18n/server-locale";

export default async function HomePage() {
  const locale = await getRequestLocale();

  return <WebConsoleInitView locale={locale} />;
}
