"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, FocusEvent, MouseEvent } from "react";

type IntentPrefetchLinkProps = Omit<
  ComponentProps<typeof Link>,
  "href" | "prefetch"
> & {
  href: string;
  intentPrefetch?: boolean;
};

export function IntentPrefetchLink({
  href,
  intentPrefetch = true,
  onFocus,
  onMouseEnter,
  ...props
}: IntentPrefetchLinkProps) {
  const router = useRouter();

  function prefetch() {
    router.prefetch(href);
  }

  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    onFocus?.(event);
    if (!event.defaultPrevented && intentPrefetch) {
      prefetch();
    }
  }

  function handleMouseEnter(event: MouseEvent<HTMLAnchorElement>) {
    onMouseEnter?.(event);
    if (!event.defaultPrevented && intentPrefetch) {
      prefetch();
    }
  }

  return (
    <Link
      {...props}
      href={href}
      onFocus={intentPrefetch ? handleFocus : onFocus}
      onMouseEnter={intentPrefetch ? handleMouseEnter : onMouseEnter}
      prefetch={false}
    />
  );
}
