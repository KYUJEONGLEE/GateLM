export const DASHBOARD_RANGE_PREFERENCE_COOKIE = "gatelm_dashboard_range";
export const DASHBOARD_RANGE_PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export const dashboardRangePreferenceValues = ["5m", "15m", "1h", "1d", "1w"] as const;

export type DashboardRangePreference = (typeof dashboardRangePreferenceValues)[number];

export const DEFAULT_DASHBOARD_RANGE: DashboardRangePreference = "15m";

export function normalizeDashboardRangePreference(
  value: string | null | undefined
): DashboardRangePreference | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return dashboardRangePreferenceValues.find((range) => range === normalized);
}
