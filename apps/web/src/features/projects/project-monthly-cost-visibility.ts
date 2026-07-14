import type { ProjectMonthlyCostReport } from "@/lib/gateway/live-cost-report";

export function filterProjectMonthlyCostReport(
  report: ProjectMonthlyCostReport,
  allowedProjectIds: string[]
): ProjectMonthlyCostReport {
  const allowed = new Set(
    allowedProjectIds.map((projectId) => projectId.trim()).filter(Boolean)
  );

  return {
    ...report,
    projectCosts: report.projectCosts.filter((cost) => allowed.has(cost.projectId))
  };
}
