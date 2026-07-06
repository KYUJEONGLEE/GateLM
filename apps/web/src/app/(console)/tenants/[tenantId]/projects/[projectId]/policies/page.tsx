import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RuntimePolicyEditor } from "@/features/policies/components/runtime-policy-editor";
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
  const locale = await getRequestLocale();
  const projectRuntime = await getProjectRuntimePolicyModel(tenantId, projectId);

  if (!projectRuntime) {
    notFound();
  }

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <RuntimePolicyEditor
        breadcrumbItems={[
          {
            href: `/tenants/${tenantId}/projects`,
            label: "Projects"
          },
          {
            href: `/tenants/${tenantId}/projects/${projectRuntime.project.id}`,
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
