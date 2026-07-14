"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

const DASHBOARD_AUTO_REFRESH_INTERVAL_MS = 30000;

export function DashboardAutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const refreshInFlightRef = useRef(false);
  const lastRefreshStartedAtRef = useRef(Date.now());

  useEffect(() => {
    if (!isPending) {
      refreshInFlightRef.current = false;
    }
  }, [isPending]);

  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "visible" ||
        refreshInFlightRef.current ||
        now - lastRefreshStartedAtRef.current < DASHBOARD_AUTO_REFRESH_INTERVAL_MS
      ) {
        return;
      }

      refreshInFlightRef.current = true;
      lastRefreshStartedAtRef.current = now;
      startTransition(() => {
        router.refresh();
      });
    };

    const intervalId = window.setInterval(refresh, DASHBOARD_AUTO_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, startTransition]);

  return null;
}
