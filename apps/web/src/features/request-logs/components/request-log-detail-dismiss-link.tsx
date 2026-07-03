"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { MouseEvent, ReactNode } from "react";

type RequestLogDetailDismissLinkProps = {
  ariaLabel: string;
  children?: ReactNode;
  className: string;
  href: string;
};

const CLOSE_ANIMATION_MS = 150;

export function RequestLogDetailDismissLink({
  ariaLabel,
  children,
  className,
  href
}: RequestLogDetailDismissLinkProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const closeHref = getCurrentCloseHref(pathname, searchParams, href);

  useEffect(() => {
    return () => {
      delete document.documentElement.dataset.requestLogDetailClosing;
    };
  }, []);

  function dismissDetail(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    document.documentElement.dataset.requestLogDetailClosing = "true";

    window.setTimeout(() => {
      router.push(closeHref, { scroll: false });
    }, CLOSE_ANIMATION_MS);
  }

  return (
    <Link aria-label={ariaLabel} className={className} href={closeHref} onClick={dismissDetail} scroll={false}>
      {children}
    </Link>
  );
}

function getCurrentCloseHref(
  pathname: string | null,
  searchParams: ReturnType<typeof useSearchParams>,
  fallbackHref: string
) {
  if (!pathname || !searchParams.has("requestId")) {
    return fallbackHref;
  }

  const nextSearchParams = new URLSearchParams(searchParams.toString());
  nextSearchParams.delete("requestId");
  const queryString = nextSearchParams.toString();

  return queryString ? `${pathname}?${queryString}` : pathname;
}
