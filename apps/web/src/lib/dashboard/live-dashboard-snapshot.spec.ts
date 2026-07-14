import { expect, test } from "@playwright/test";

import {
  buildLiveDashboardSnapshotQuery,
  DASHBOARD_SNAPSHOT_POLL_INTERVAL_MS,
  isNewerDashboardSnapshot
} from "./live-dashboard-snapshot";

test("builds one snapshot query for dashboard and live-request filters", () => {
  const query = new URLSearchParams(
    buildLiveDashboardSnapshotQuery({
      budgetScopeId: "budget-1",
      budgetScopeType: "project",
      liveModel: "gpt-5",
      liveStatus: "success",
      projectId: "project-1",
      range: "1h",
      resolvedBy: "routing-policy",
      surface: "project_application",
      tenantId: "tenant-1"
    })
  );

  expect(Object.fromEntries(query.entries())).toEqual({
    budgetScopeId: "budget-1",
    budgetScopeType: "project",
    model: "gpt-5",
    projectId: "project-1",
    range: "1h",
    resolvedBy: "routing-policy",
    status: "success",
    surface: "project_application",
    tenantId: "tenant-1"
  });
});

test("omits empty optional snapshot filters", () => {
  const query = new URLSearchParams(
    buildLiveDashboardSnapshotQuery({
      budgetScopeId: " ",
      budgetScopeType: "",
      liveModel: "",
      liveStatus: "",
      projectId: "",
      range: "15m",
      resolvedBy: "",
      surface: "all",
      tenantId: "tenant-1"
    })
  );

  expect(Object.fromEntries(query.entries())).toEqual({
    range: "15m",
    surface: "all",
    tenantId: "tenant-1"
  });
});

test("uses a one-second interval and ignores duplicate or older snapshots", () => {
  expect(DASHBOARD_SNAPSHOT_POLL_INTERVAL_MS).toBe(1000);
  expect(isNewerDashboardSnapshot({ generatedAt: "2026-07-15T00:00:01Z" }, null)).toBe(true);
  expect(
    isNewerDashboardSnapshot(
      { generatedAt: "2026-07-15T00:00:01Z" },
      "2026-07-15T00:00:00Z"
    )
  ).toBe(true);
  expect(
    isNewerDashboardSnapshot(
      { generatedAt: "2026-07-15T00:00:01Z" },
      "2026-07-15T00:00:01Z"
    )
  ).toBe(false);
  expect(
    isNewerDashboardSnapshot(
      { generatedAt: "2026-07-15T00:00:00Z" },
      "2026-07-15T00:00:01Z"
    )
  ).toBe(false);
});
