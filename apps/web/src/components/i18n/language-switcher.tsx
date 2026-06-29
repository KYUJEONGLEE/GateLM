"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  LOCALE_COOKIE_NAME,
  localeLabels,
  supportedLocales,
  type Locale
} from "@/lib/i18n/locale";

type LanguageSwitcherProps = {
  ariaLabel: string;
  locale: Locale;
};

const cookieMaxAgeSeconds = 60 * 60 * 24 * 365;

export function LanguageSwitcher({ ariaLabel, locale }: LanguageSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectLocale(nextLocale: Locale) {
    if (nextLocale === locale) {
      return;
    }

    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=${cookieMaxAgeSeconds}; SameSite=Lax`;
    document.documentElement.lang = nextLocale;

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="language-switcher" aria-label={ariaLabel}>
      {supportedLocales.map((item) => (
        <button
          aria-pressed={item === locale}
          className="language-option"
          data-active={item === locale}
          disabled={isPending}
          key={item}
          onClick={() => selectLocale(item)}
          type="button"
        >
          {localeLabels[item]}
        </button>
      ))}
    </div>
  );
}
