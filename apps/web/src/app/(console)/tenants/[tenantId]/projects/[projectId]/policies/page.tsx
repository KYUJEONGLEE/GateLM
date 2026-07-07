import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RuntimePolicyEditor } from "@/features/policies/components/runtime-policy-editor";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
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
            href: `/tenants/${effectiveTenantId}/projects/${projectRuntime.project.id}`,
            label: projectRuntime.project.name
          },
          {
            label: "Policies"
          }
        ]}
        locale={locale}
        model={projectRuntime.policyModel}
      />
    </ConsoleShell>
  );
}
