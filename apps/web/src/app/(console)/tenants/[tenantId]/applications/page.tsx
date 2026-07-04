import { ConsoleShell } from "@/components/layout/console-shell";
import { ApplicationManagement } from "@/features/applications/components/application-management";
import { getApplicationsModel } from "@/lib/control-plane/applications-client";
import { getProviderConnectionsModel } from "@/lib/control-plane/provider-connections-client";
import { getRuntimePolicyConfigForApplication } from "@/lib/control-plane/runtime-policy-client";
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
  const providerConnectionsModel = await getProviderConnectionsModel(tenantId);
  const runtimeConfigEntries = await Promise.all(
    model.applications.map(async (application) => [
      application.id,
      await getRuntimePolicyConfigForApplication(application.id)
    ] as const)
  );
  const runtimeConfig = runtimeConfigEntries.find(([, config]) => config !== null)?.[1] ?? null;

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
        modelOptions={runtimeConfig?.models ?? []}
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
        providerConnections={providerConnectionsModel.providers}
        tenantId={tenantId}
      />
    </ConsoleShell>
  );
}
