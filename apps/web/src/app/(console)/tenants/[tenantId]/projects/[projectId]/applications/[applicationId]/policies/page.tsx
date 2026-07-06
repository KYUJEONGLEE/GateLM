import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RuntimePolicyEditor } from "@/features/policies/components/runtime-policy-editor";
import { listApiKeysForProject } from "@/lib/control-plane/api-keys-client";
import { getApplicationsModel } from "@/lib/control-plane/applications-client";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getRuntimePolicyModelForApplication } from "@/lib/control-plane/runtime-policy-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ApplicationPoliciesPageProps = {
  params: Promise<{
    applicationId: string;
    projectId: string;
    tenantId: string;
  }>;
};

export default async function ApplicationPoliciesPage({
  params
}: ApplicationPoliciesPageProps) {
  const { applicationId, projectId, tenantId } = await params;
  const locale = await getRequestLocale();
  const projectsModel = await getProjectsModel(tenantId);
  const project = projectsModel.projects.find((item) => item.id === projectId);

  if (!project) {
    notFound();
  }

  const applicationsModel = await getApplicationsModel(tenantId, project.id);
  const application = applicationsModel.applications.find((item) => item.id === applicationId);

  if (!application) {
    notFound();
  }

  const model = await getRuntimePolicyModelForApplication(tenantId, application.id, project.id);
  const apiKeysResult = await listApiKeysForProject(project.id);
  const activeApiKeyCount = apiKeysResult.ok
    ? apiKeysResult.data.filter((apiKey) => isActiveCredential(apiKey.status, apiKey.expiresAt))
        .length
    : 0;

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <RuntimePolicyEditor
        apiKeyReadiness={{
          activeApiKeyCount,
          loadError: apiKeysResult.ok ? null : apiKeysResult.error,
          projectId: project.id,
          projectName: project.name
        }}
        breadcrumbItems={[
          {
            href: `/tenants/${tenantId}/projects`,
            label: "Projects"
          },
          {
            href: `/tenants/${tenantId}/projects/${project.id}`,
            label: project.name
          },
          {
            label: application.name
          },
          {
            label: "Policies"
          }
        ]}
        locale={locale}
        model={model}
      />
    </ConsoleShell>
  );
}

function isActiveCredential(status: string, expiresAt: string | null) {
  if (status !== "active") {
    return false;
  }

  return !expiresAt || new Date(expiresAt).getTime() > Date.now();
}
