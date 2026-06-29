import { ConsoleShell } from "@/components/layout/console-shell";
import { ProjectManagement } from "@/features/projects/components/project-management";
import { getApplicationsModel } from "@/lib/control-plane/applications-client";
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
  const applicationModels = await Promise.all(
    projectsModel.projects.map((project) => getApplicationsModel(tenantId, project.id))
  );
  const applicationCounts = Object.fromEntries(
    projectsModel.projects.map((project, index) => [
      project.id,
      applicationModels[index]?.applications.length ?? 0
    ])
  );

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ProjectManagement
        applicationCounts={applicationCounts}
        locale={locale}
        model={projectsModel}
      />
    </ConsoleShell>
  );
}
