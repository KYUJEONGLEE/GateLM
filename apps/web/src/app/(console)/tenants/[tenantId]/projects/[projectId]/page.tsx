import { notFound } from "next/navigation";
import { ProjectAdminManagement } from "@/features/project-admins/components/project-admin-management";
import {
  ProjectDeleteManagement,
  ProjectDetailManagement
} from "@/features/projects/components/project-management";
import { ProjectGatewayApiKeySection } from "@/features/projects/components/project-gateway-api-key-section";
import { ProjectTeamAssignment } from "@/features/teams/components/team-management";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { getProjectApiKeysModel } from "@/lib/control-plane/api-keys-client";
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
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const projectsModel = await getProjectsModel(effectiveTenantId);
  const project = projectsModel.projects.find((item) => item.id === projectId);

  if (!project) {
    notFound();
  }

  const [projectAdminsModel, projectTeamsModel, projectApiKeysModel] = await Promise.all([
    getProjectAdminsModel(effectiveTenantId, project.id),
    getProjectTeamsModel(effectiveTenantId, project.id),
    getProjectApiKeysModel(effectiveTenantId, project.id)
  ]);

  return (
    <>
      <ProjectDetailManagement
        breadcrumbItems={[
          {
            href: `/tenants/${effectiveTenantId}/projects`,
            label: "Projects"
          },
          {
            label: project.name
          }
        ]}
        locale={locale}
        project={project}
        tenantId={effectiveTenantId}
      />
      <ProjectAdminManagement locale={locale} model={projectAdminsModel} />
      <ProjectTeamAssignment locale={locale} model={projectTeamsModel} />
      <ProjectGatewayApiKeySection
        locale={locale}
        model={projectApiKeysModel}
      />
      <ProjectDeleteManagement
        locale={locale}
        project={project}
        tenantId={effectiveTenantId}
      />
    </>
  );
}
