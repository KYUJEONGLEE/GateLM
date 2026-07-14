import { expect, test } from "@playwright/test";
import { filterProjectMonthlyCostReport } from "./project-monthly-cost-visibility";

test("keeps only assigned project costs before serializing a project-admin view", () => {
  const report = {
    generatedAt: "2026-07-14T00:00:00.000Z",
    loadError: null,
    projectCosts: [
      {
        costMicroUsd: 100,
        projectId: "project-assigned",
        requestCount: 2,
        totalTokens: 30
      },
      {
        costMicroUsd: 900,
        projectId: "project-foreign",
        requestCount: 8,
        totalTokens: 70
      }
    ],
    source: "gateway" as const
  };

  const filtered = filterProjectMonthlyCostReport(report, ["project-assigned"]);

  expect(filtered.projectCosts).toEqual([report.projectCosts[0]]);
  expect(report.projectCosts).toHaveLength(2);
});

test("fails closed when a project admin has no visible project", () => {
  const report = {
    generatedAt: null,
    loadError: null,
    projectCosts: [
      {
        costMicroUsd: 100,
        projectId: "project-foreign",
        requestCount: 2,
        totalTokens: 30
      }
    ],
    source: "gateway" as const
  };

  expect(filterProjectMonthlyCostReport(report, []).projectCosts).toEqual([]);
});
