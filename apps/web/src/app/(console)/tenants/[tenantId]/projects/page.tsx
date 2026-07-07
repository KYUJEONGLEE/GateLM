import { ConsoleShell } from "@/components/layout/console-shell";
import { ProjectManagement } from "@/features/projects/components/project-management";
import {
  getCurrentConsoleAuth,
  getVisibleProjectsForConsoleAuth,
  isTenantAdminForTenant
} from "@/lib/auth/current-console-auth";
import { getProjectBudgetThresholds, getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveMonthlyProjectCostReport } from "@/lib/gateway/live-cost-report";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProjectsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ProjectsPage({ params }: ProjectsPageProps) {
  const { tenantId } = await params;
  const [locale, auth, projectsModel, monthlyCostReport] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth(),
    getProjectsModel(tenantId),
    getLiveMonthlyProjectCostReport(tenantId)
  ]);
  const visibleProjects = getVisibleProjectsForConsoleAuth(projectsModel.projects, auth, tenantId);
  const budgetThresholds = await getProjectBudgetThresholds(visibleProjects);
  const canCreateProject = isTenantAdminForTenant(auth, tenantId);

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ProjectManagement
        budgetThresholds={budgetThresholds}
        canCreateProject={canCreateProject}
        locale={locale}
        model={{ ...projectsModel, projects: visibleProjects }}
        monthlyCostReport={monthlyCostReport}
      />
    </ConsoleShell>
  );
}
