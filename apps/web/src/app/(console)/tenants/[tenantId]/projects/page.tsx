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
  const runtimeApplicationIdsByProjectId = Object.fromEntries(
    await Promise.all(
      projectsModel.projects.map(async (project) => {
        const applicationsModel = await getApplicationsModel(tenantId, project.id);
        const runtimeApplication =
          applicationsModel.applications.find((application) => application.status === "ACTIVE") ??
          applicationsModel.applications.find((application) => application.status !== "ARCHIVED") ??
          null;

        return [project.id, runtimeApplication?.id ?? null] as const;
      })
    )
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
