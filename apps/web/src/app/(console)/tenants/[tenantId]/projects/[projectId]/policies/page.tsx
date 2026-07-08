import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { ProjectAdminSection } from "@/features/project-admins/components/project-admin-management";
import {
  ProjectDeleteSection,
  ProjectDetailSection
} from "@/features/projects/components/project-management";
import { ProjectGatewayApiKeyPanel } from "@/features/projects/components/project-gateway-api-key-section";
import { RuntimePolicyEditor } from "@/features/policies/components/runtime-policy-editor";
import { ProjectTeamAssignmentSection } from "@/features/teams/components/team-management";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { getProjectApiKeysModel } from "@/lib/control-plane/api-keys-client";
import { getProjectAdminsModel } from "@/lib/control-plane/project-admins-client";
import { getProjectRuntimePolicyModel } from "@/lib/control-plane/project-runtime-client";
import { getProjectTeamsModel } from "@/lib/control-plane/teams-client";
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

  const [projectAdminsModel, projectTeamsModel, projectApiKeysModel] = await Promise.all([
    getProjectAdminsModel(effectiveTenantId, projectRuntime.project.id),
    getProjectTeamsModel(effectiveTenantId, projectRuntime.project.id),
    getProjectApiKeysModel(effectiveTenantId, projectRuntime.project.id)
  ]);

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={effectiveTenantId}
    >
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
        hideStreamingTab
        locale={locale}
        model={projectRuntime.policyModel}
        moveBudgetToGeneral
        generalFooter={
          <div className="project-policy-general-tab management-line-content">
            <ProjectAdminSection locale={locale} model={projectAdminsModel} />
            <ProjectTeamAssignmentSection locale={locale} model={projectTeamsModel} />
            <ProjectGatewayApiKeyPanel locale={locale} model={projectApiKeysModel} />
            <ProjectDeleteSection
              locale={locale}
              project={projectRuntime.project}
              tenantId={effectiveTenantId}
            />
          </div>
        }
      >
        <div className="project-policy-general-tab management-line-content">
          <ProjectDetailSection
            locale={locale}
            project={projectRuntime.project}
            tenantId={effectiveTenantId}
          />
        </div>
      </RuntimePolicyEditor>
    </ConsoleShell>
  );
}
