"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { MouseEvent, ReactNode } from "react";
import { REQUEST_LOG_DETAIL_CLOSE_EVENT } from "./request-log-detail-anchor";

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
      const targetHref = getCurrentCloseHrefFromLocation(closeHref);
      window.history.pushState(null, "", targetHref);
      window.dispatchEvent(new CustomEvent(REQUEST_LOG_DETAIL_CLOSE_EVENT));
      delete document.documentElement.dataset.requestLogDetailClosing;
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

function getCurrentCloseHrefFromLocation(fallbackHref: string) {
  const currentUrl = new URL(window.location.href);
  if (!currentUrl.searchParams.has("requestId")) {
    return fallbackHref;
  }

  currentUrl.searchParams.delete("requestId");
  const queryString = currentUrl.searchParams.toString();

  return queryString ? `${currentUrl.pathname}?${queryString}` : currentUrl.pathname;
}
