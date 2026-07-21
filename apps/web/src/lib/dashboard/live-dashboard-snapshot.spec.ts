import { expect, test } from "@playwright/test";

import {
  buildLiveDashboardSnapshotQuery,
  DASHBOARD_SNAPSHOT_POLL_INTERVAL_MS,
  isNewerDashboardSnapshot
} from "./live-dashboard-snapshot";

test("builds an aggregate snapshot query without live-request filters", () => {
  const query = new URLSearchParams(
    buildLiveDashboardSnapshotQuery({
      budgetScopeId: "budget-1",
      budgetScopeType: "project",
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
    projectId: "project-1",
    range: "1h",
    resolvedBy: "routing-policy",
    surface: "project_application",
    tenantId: "tenant-1"
  });
});

test("omits empty optional snapshot filters", () => {
  const query = new URLSearchParams(
    buildLiveDashboardSnapshotQuery({
      budgetScopeId: " ",
      budgetScopeType: "",
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

test("uses a thirty-second interval and ignores duplicate or older snapshots", () => {
  expect(DASHBOARD_SNAPSHOT_POLL_INTERVAL_MS).toBe(30_000);
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
