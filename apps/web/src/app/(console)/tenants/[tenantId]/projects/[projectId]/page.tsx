import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { ApplicationManagement } from "@/features/applications/components/application-management";
import { ProjectDetailManagement } from "@/features/projects/components/project-management";
import { getApplicationsModel } from "@/lib/control-plane/applications-client";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getRuntimePolicyConfigForApplication } from "@/lib/control-plane/runtime-policy-client";
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
  const activeApplication = applicationsModel.applications.find(
    (application) => application.status === "ACTIVE"
  );
  const runtimeConfig = activeApplication
    ? await getRuntimePolicyConfigForApplication(activeApplication.id)
    : null;

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ProjectDetailManagement
        locale={locale}
        project={project}
        tenantId={tenantId}
        runtimeSettings={
          runtimeConfig
            ? {
                cacheEnabled: runtimeConfig.cachePolicy.enabled,
                cacheType: runtimeConfig.cachePolicy.type,
                publishState: runtimeConfig.publishState,
                safetyMode: runtimeConfig.safetyPolicy.mode
              }
            : null
        }
      />
      <ApplicationManagement locale={locale} model={applicationsModel} />
    </ConsoleShell>
  );
}
