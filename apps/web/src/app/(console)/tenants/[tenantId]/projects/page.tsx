import { ProjectManagement } from "@/features/projects/components/project-management";
import {
  getCurrentConsoleAuth,
  getVisibleProjectsForConsoleAuth,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveMonthlyProjectCostReport } from "@/lib/gateway/live-cost-report";
import { buildProjectUsagePreview } from "@/lib/gateway/project-usage-preview";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProjectsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams: Promise<{
    usagePreview?: string | string[];
  }>;
};

export default async function ProjectsPage({ params, searchParams }: ProjectsPageProps) {
  const [{ tenantId }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const [projectsModel, monthlyCostReport] = await Promise.all([
    getProjectsModel(effectiveTenantId),
    getLiveMonthlyProjectCostReport(effectiveTenantId)
  ]);
  const visibleProjects = getVisibleProjectsForConsoleAuth(projectsModel.projects, auth, effectiveTenantId);
  const budgetThresholds = visibleProjects.map((project) => ({
    projectId: project.id,
    warningThresholdPercent: project.warningThresholdPercent
  }));
  const canCreateProject = isTenantAdminForTenant(auth, effectiveTenantId);
  const usageReport = shouldUseUsagePreview(resolvedSearchParams.usagePreview)
    ? buildProjectUsagePreview(visibleProjects)
    : monthlyCostReport;

  return (
    <ProjectManagement
      budgetThresholds={budgetThresholds}
      canCreateProject={canCreateProject}
      locale={locale}
      model={{ ...projectsModel, projects: visibleProjects }}
      monthlyCostReport={usageReport}
    />
  );
}

function shouldUseUsagePreview(value: string | string[] | undefined) {
  return process.env.NODE_ENV !== "production" && value === "1";
}
