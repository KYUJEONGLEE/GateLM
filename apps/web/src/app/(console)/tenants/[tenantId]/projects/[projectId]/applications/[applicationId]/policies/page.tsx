import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RuntimePolicyEditor } from "@/features/policies/components/runtime-policy-editor";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
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
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const projectsModel = await getProjectsModel(effectiveTenantId);
  const project = projectsModel.projects.find((item) => item.id === projectId);

  if (!project || project.status !== "ACTIVE") {
    notFound();
  }

  const applicationsModel = await getApplicationsModel(effectiveTenantId, project.id);
  const application = applicationsModel.applications.find((item) => item.id === applicationId);

  if (!application) {
    notFound();
  }

  const model = await getRuntimePolicyModelForApplication(effectiveTenantId, application.id, project.id);
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
      tenantId={effectiveTenantId}
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
            href: `/tenants/${effectiveTenantId}/projects`,
            label: "Projects"
          },
          {
            href: `/tenants/${effectiveTenantId}/projects/${project.id}`,
            label: project.name
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
