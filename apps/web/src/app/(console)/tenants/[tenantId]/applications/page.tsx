import { ApplicationManagement } from "@/features/applications/components/application-management";
import { getApplicationsModel } from "@/lib/control-plane/applications-client";
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
  const runtimeConfigEntries = await Promise.all(
    model.applications.map(async (application) => [
      application.id,
      await getRuntimePolicyConfigForApplication(application.id)
    ] as const)
  );

  return (
    <ApplicationManagement
      locale={locale}
      model={model}
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
      tenantId={tenantId}
    />
  );
}
