"use client";

import { Check } from "lucide-react";
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
const localeActionLabels: Record<Locale, string> = {
  en: "Switch console language to English",
  ko: "콘솔 언어를 한국어로 변경"
};

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
    <div className="language-switcher" aria-label={ariaLabel} role="group">
      {supportedLocales.map((item) => {
        const isActive = item === locale;

        return (
          <button
            aria-label={localeActionLabels[item]}
            aria-pressed={isActive}
            className="language-option"
            data-active={isActive}
            disabled={isPending}
            key={item}
            onClick={() => selectLocale(item)}
            type="button"
          >
            <span>{localeLabels[item]}</span>
            {isActive ? <Check aria-hidden="true" className="language-option-check" /> : null}
          </button>
        );
      })}
    </div>
  );
}
