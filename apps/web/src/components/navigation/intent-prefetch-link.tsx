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
  const shouldPrefetch = intentPrefetch && process.env.NODE_ENV === "production";

  function prefetch() {
    router.prefetch(href);
  }

  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    onFocus?.(event);
    if (!event.defaultPrevented && shouldPrefetch) {
      prefetch();
    }
  }

  function handleMouseEnter(event: MouseEvent<HTMLAnchorElement>) {
    onMouseEnter?.(event);
    if (!event.defaultPrevented && shouldPrefetch) {
      prefetch();
    }
  }

  return (
    <Link
      {...props}
      href={href}
      onFocus={shouldPrefetch ? handleFocus : onFocus}
      onMouseEnter={shouldPrefetch ? handleMouseEnter : onMouseEnter}
      prefetch={false}
    />
  );
}
