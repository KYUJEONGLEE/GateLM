import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { ProjectMonthlyCostReport } from "@/lib/gateway/live-cost-report";

const previewProfiles = [
  { budgetRatio: 0.78, requestCount: 1_840, totalTokens: 3_800_000 },
  { budgetRatio: 0.62, requestCount: 1_210, totalTokens: 2_400_000 },
  { budgetRatio: 0.34, requestCount: 640, totalTokens: 1_100_000 },
  { budgetRatio: 0.18, requestCount: 290, totalTokens: 640_000 }
] as const;

type PreviewProject = Pick<ProjectRecord, "id" | "status" | "totalBudgetUsd">;

export function buildProjectUsagePreview(
  projects: PreviewProject[]
): ProjectMonthlyCostReport {
  return {
    generatedAt: new Date().toISOString(),
    loadError: null,
    projectCosts: projects
      .filter((project) => project.status !== "ARCHIVED" && project.status !== "DRAFT")
      .map((project, index) => {
        const profile = previewProfiles[index % previewProfiles.length];

        return {
          costMicroUsd: Math.round(
            Math.max(0, project.totalBudgetUsd) * profile.budgetRatio * 1_000_000
          ),
          projectId: project.id,
          requestCount: profile.requestCount,
          totalTokens: profile.totalTokens
        };
      }),
    source: "preview"
  };
}
