import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { ApplicationManagement } from "@/features/applications/components/application-management";
import {
  ProjectDeleteManagement,
  ProjectDetailManagement
} from "@/features/projects/components/project-management";
import { ProjectTeamAssignment } from "@/features/teams/components/team-management";
import { getApplicationsModel } from "@/lib/control-plane/applications-client";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getRuntimePolicyConfigForApplication } from "@/lib/control-plane/runtime-policy-client";
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

  const applicationsModel = await getApplicationsModel(tenantId, project.id);
  const projectTeamsModel = await getProjectTeamsModel(tenantId, project.id);
  const runtimeConfigEntries = await Promise.all(
    applicationsModel.applications.map(async (application) => [
      application.id,
      await getRuntimePolicyConfigForApplication(application.id)
    ] as const)
  );

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
      <ApplicationManagement
        locale={locale}
        model={applicationsModel}
        policySummariesByApplicationId={Object.fromEntries(
          runtimeConfigEntries.map(([applicationId, config]) => [
            applicationId,
            config
              ? {
                  defaultModel: config.routingPolicy.defaultModel,
                  defaultProvider: config.routingPolicy.defaultProvider,
                  modelCount: config.models.length,
                  publishedAt: config.publishedAt,
                  publishState: config.publishState
                }
              : null
          ])
        )}
        projectBudgetUsd={project.totalBudgetUsd}
        tenantId={tenantId}
      />
      <ProjectTeamAssignment locale={locale} model={projectTeamsModel} />
      <ProjectDeleteManagement
        locale={locale}
        project={project}
        tenantId={tenantId}
      />
    </ConsoleShell>
  );
}
