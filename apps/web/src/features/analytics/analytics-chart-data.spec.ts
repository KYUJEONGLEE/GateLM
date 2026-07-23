import { expect, test } from "@playwright/test";

import {
  ANALYTICS_OTHER_ROW_ID,
  compactAnalyticsValueRows
} from "@/features/analytics/analytics-chart-data";

test("compacts chart rows without losing values outside the visible limit", () => {
  const rows = [
    { id: "sixth", label: "Sixth", value: 1 },
    { id: "first", label: "First", value: 10 },
    { id: "fifth", label: "Fifth", value: 2 },
    { id: "second", label: "Second", value: 8 },
    { id: "fourth", label: "Fourth", value: 3 },
    { id: "third", label: "Third", value: 6 }
  ];

  const compacted = compactAnalyticsValueRows(rows, 5, "Other");

  expect(compacted).toEqual([
    { id: "first", label: "First", value: 10 },
    { id: "second", label: "Second", value: 8 },
    { id: "third", label: "Third", value: 6 },
    { id: "fourth", label: "Fourth", value: 3 },
    { id: ANALYTICS_OTHER_ROW_ID, label: "Other", value: 3 }
  ]);
  expect(compacted.reduce((sum, row) => sum + row.value, 0)).toBe(30);
  expect(rows[0]?.id).toBe("sixth");
});

test("keeps all positive rows when they fit within the visible limit", () => {
  expect(
    compactAnalyticsValueRows(
      [
        { id: "zero", label: "Zero", value: 0 },
        { id: "second", label: "Second", value: 2 },
        { id: "first", label: "First", value: 4 }
      ],
      5,
      "Other"
    )
  ).toEqual([
    { id: "first", label: "First", value: 4 },
    { id: "second", label: "Second", value: 2 }
  ]);
});
