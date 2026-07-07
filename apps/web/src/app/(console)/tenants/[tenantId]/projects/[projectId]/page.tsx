import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { ProjectAdminManagement } from "@/features/project-admins/components/project-admin-management";
import {
  ProjectDeleteManagement,
  ProjectDetailManagement
} from "@/features/projects/components/project-management";
import { ProjectTeamAssignment } from "@/features/teams/components/team-management";
import { getProjectAdminsModel } from "@/lib/control-plane/project-admins-client";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getProjectTeamsModel } from "@/lib/control-plane/teams-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProjectDetailPageProps = {
  params: Promise<{
    projectId: string;
    tenantId: string;
  }>;
};

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectId, tenantId } = await params;
  const locale = await getRequestLocale();
  const projectsModel = await getProjectsModel(tenantId);
  const project = projectsModel.projects.find((item) => item.id === projectId);

  if (!project) {
    notFound();
  }

  const [projectAdminsModel, projectTeamsModel] = await Promise.all([
    getProjectAdminsModel(tenantId, project.id),
    getProjectTeamsModel(tenantId, project.id)
  ]);

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ProjectDetailManagement
        breadcrumbItems={[
          {
            href: `/tenants/${tenantId}/projects`,
            label: "Projects"
          },
          {
            label: project.name
          }
        ]}
        locale={locale}
        project={project}
        tenantId={tenantId}
      />
      <ProjectAdminManagement locale={locale} model={projectAdminsModel} />
      <ProjectTeamAssignment locale={locale} model={projectTeamsModel} />
      <ProjectDeleteManagement
        locale={locale}
        project={project}
        tenantId={tenantId}
      />
    </ConsoleShell>
  );
}
