import { ProjectManagement } from "@/features/projects/components/project-management";
import {
  getCurrentConsoleAuth,
  getVisibleProjectsForConsoleAuth,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveMonthlyProjectCostReport } from "@/lib/gateway/live-cost-report";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProjectsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ProjectsPage({ params }: ProjectsPageProps) {
  const { tenantId } = await params;
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

  return (
    <ProjectManagement
      budgetThresholds={budgetThresholds}
      canCreateProject={canCreateProject}
      locale={locale}
      model={{ ...projectsModel, projects: visibleProjects }}
      monthlyCostReport={monthlyCostReport}
    />
  );
}
