import { ConsoleShell } from "@/components/layout/console-shell";
import { ProjectManagement } from "@/features/projects/components/project-management";
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
  const locale = await getRequestLocale();
  const [projectsModel, monthlyCostReport] = await Promise.all([
    getProjectsModel(tenantId),
    getLiveMonthlyProjectCostReport(tenantId)
  ]);
  const budgetThresholds = await getProjectBudgetThresholds(projectsModel.projects);

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ProjectManagement
        budgetThresholds={budgetThresholds}
        locale={locale}
        model={projectsModel}
        monthlyCostReport={monthlyCostReport}
      />
    </ConsoleShell>
  );
}
