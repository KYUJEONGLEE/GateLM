import { ConsoleShell } from "@/components/layout/console-shell";
import { ProjectManagement } from "@/features/projects/components/project-management";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProjectsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ProjectsPage({ params }: ProjectsPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const projectsModel = await getProjectsModel(tenantId);
  const runtimeApplicationIdsByProjectId = Object.fromEntries(
    projectsModel.projects.map((project) => [
      project.id,
      project.runtimeApplicationId ?? null
    ] as const)
  );

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ProjectManagement
        locale={locale}
        model={projectsModel}
        runtimeApplicationIdsByProjectId={runtimeApplicationIdsByProjectId}
      />
    </ConsoleShell>
  );
}
