import { ConsoleShell } from "@/components/layout/console-shell";
import { ApplicationManagement } from "@/features/applications/components/application-management";
import { getApplicationsModel } from "@/lib/control-plane/applications-client";
import { getRuntimePolicyModel } from "@/lib/control-plane/runtime-policy-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ApplicationsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ApplicationsPage({ params }: ApplicationsPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getApplicationsModel(tenantId);
  const runtimePolicyModel = await getRuntimePolicyModel(tenantId);

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ApplicationManagement
        locale={locale}
        model={model}
        modelOptions={runtimePolicyModel.activeConfig.models}
      />
    </ConsoleShell>
  );
}
