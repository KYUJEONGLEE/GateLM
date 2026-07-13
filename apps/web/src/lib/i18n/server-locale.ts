import { cookies } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE_NAME, normalizeLocale, type Locale } from "@/lib/i18n/locale";

export const getRequestLocale = cache(async (): Promise<Locale> => {
  const cookieStore = await cookies();

  return normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
});
