import { notFound } from "next/navigation";
import { ProjectPolicyEmployeeContent } from "@/features/policies/components/project-policy-employee-content";
import { ProjectPolicyGeneralContent } from "@/features/policies/components/project-policy-general-content";
import { RuntimePolicyEditor } from "@/features/policies/components/runtime-policy-editor";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { getProjectApiKeysModel } from "@/lib/control-plane/api-keys-client";
import { getProjectEmployeeControlModel } from "@/lib/control-plane/employees-client";
import { getProjectAdminsModel } from "@/lib/control-plane/project-admins-client";
import { getProjectRuntimePolicyModel } from "@/lib/control-plane/project-runtime-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProjectPoliciesPageProps = {
  params: Promise<{
    projectId: string;
    tenantId: string;
  }>;
};

export default async function ProjectPoliciesPage({ params }: ProjectPoliciesPageProps) {
  const { projectId, tenantId } = await params;
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const projectRuntime = await getProjectRuntimePolicyModel(effectiveTenantId, projectId);

  if (!projectRuntime) {
    notFound();
  }

  const [projectAdminsModel, projectEmployeeModel, projectApiKeysModel] = await Promise.all([
    getProjectAdminsModel(effectiveTenantId, projectRuntime.project.id),
    getProjectEmployeeControlModel(effectiveTenantId, projectRuntime.project),
    getProjectApiKeysModel(effectiveTenantId, projectRuntime.project.id)
  ]);

  return (
    <RuntimePolicyEditor
      breadcrumbItems={[
        {
          href: `/tenants/${effectiveTenantId}/projects`,
          label: "Projects"
        },
        {
          label: projectRuntime.project.name
        },
        {
          label: "Policies"
        }
      ]}
      fullWidth
      hideStreamingTab
      locale={locale}
      model={projectRuntime.policyModel}
      generalBudgetPanelPlacement="childSlot"
      moveBudgetToGeneral
      employeeSection={
        <ProjectPolicyEmployeeContent
          locale={locale}
          model={projectEmployeeModel}
          project={projectRuntime.project}
        />
      }
    >
      <ProjectPolicyGeneralContent
        locale={locale}
        project={projectRuntime.project}
        projectAdminsModel={projectAdminsModel}
        projectApiKeysModel={projectApiKeysModel}
        tenantId={effectiveTenantId}
      />
    </RuntimePolicyEditor>
  );
}
