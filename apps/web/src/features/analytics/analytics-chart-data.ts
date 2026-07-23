import type { AnalyticsValueRow } from "@/features/analytics/analytics-read-model";

export const ANALYTICS_OTHER_ROW_ID = "analytics:other";

export function compactAnalyticsValueRows(
  rows: AnalyticsValueRow[],
  maxRows: number,
  otherLabel: string
) {
  const positiveRows = rows
    .filter((row) => row.value > 0)
    .toSorted(
      (left, right) =>
        right.value - left.value || left.label.localeCompare(right.label)
    );
  const rowLimit = Math.max(1, Math.trunc(maxRows));

  if (positiveRows.length <= rowLimit) {
    return positiveRows;
  }

  const visibleRows = positiveRows.slice(0, rowLimit - 1);
  const otherValue = positiveRows
    .slice(rowLimit - 1)
    .reduce((sum, row) => sum + row.value, 0);

  return [
    ...visibleRows,
    {
      id: ANALYTICS_OTHER_ROW_ID,
      label: otherLabel,
      value: otherValue
    }
  ];
}
