import { expect, test } from "@playwright/test";
import { buildProjectUsagePreview } from "./project-usage-preview";

test("builds deterministic project usage preview data", () => {
  const report = buildProjectUsagePreview([
    { id: "project_hr", status: "ACTIVE", totalBudgetUsd: 100 },
    { id: "project_draft", status: "DRAFT", totalBudgetUsd: 100 },
    { id: "project_faq", status: "ACTIVE", totalBudgetUsd: 200 },
    { id: "project_assignment", status: "ACTIVE", totalBudgetUsd: 100 }
  ]);

  expect(report.source).toBe("preview");
  expect(report.projectCosts).toEqual([
    {
      costMicroUsd: 78_000_000,
      projectId: "project_hr",
      requestCount: 1_840,
      totalTokens: 3_800_000
    },
    {
      costMicroUsd: 124_000_000,
      projectId: "project_faq",
      requestCount: 1_210,
      totalTokens: 2_400_000
    },
    {
      costMicroUsd: 34_000_000,
      projectId: "project_assignment",
      requestCount: 640,
      totalTokens: 1_100_000
    }
  ]);
});
