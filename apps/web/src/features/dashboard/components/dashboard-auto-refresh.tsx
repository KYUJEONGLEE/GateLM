"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const DASHBOARD_AUTO_REFRESH_INTERVAL_MS = 30000;

export function DashboardAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      router.refresh();
    };

    const intervalId = window.setInterval(refresh, DASHBOARD_AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [router]);

  return null;
}
