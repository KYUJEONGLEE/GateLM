export const LOCALE_COOKIE_NAME = "gatelm_locale";

export const supportedLocales = ["en", "ko"] as const;

export type Locale = (typeof supportedLocales)[number];

export const localeLabels: Record<Locale, string> = {
  en: "English",
  ko: "한국어"
};

export function normalizeLocale(value: string | undefined | null): Locale {
  return value === "ko" ? "ko" : "en";
}
