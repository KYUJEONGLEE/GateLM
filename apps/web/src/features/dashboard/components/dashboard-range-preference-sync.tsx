"use client";

import { useEffect } from "react";
import {
  DASHBOARD_RANGE_PREFERENCE_COOKIE,
  DASHBOARD_RANGE_PREFERENCE_MAX_AGE_SECONDS,
  normalizeDashboardRangePreference,
  type DashboardRangePreference
} from "@/features/dashboard/dashboard-range-preference";

type DashboardRangePreferenceSyncProps = {
  range: DashboardRangePreference;
};

export function DashboardRangePreferenceSync({
  range
}: DashboardRangePreferenceSyncProps) {
  useEffect(() => {
    const normalizedRange = normalizeDashboardRangePreference(range);

    if (!normalizedRange) {
      return;
    }

    document.cookie = [
      `${DASHBOARD_RANGE_PREFERENCE_COOKIE}=${normalizedRange}`,
      "Path=/",
      `Max-Age=${DASHBOARD_RANGE_PREFERENCE_MAX_AGE_SECONDS}`,
      "SameSite=Lax"
    ].join("; ");
  }, [range]);

  return null;
}
