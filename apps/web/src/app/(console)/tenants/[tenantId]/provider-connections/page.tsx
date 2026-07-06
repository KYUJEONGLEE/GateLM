import { ConsoleShell } from "@/components/layout/console-shell";
import { ProviderConnectionManagement } from "@/features/provider-connections/components/provider-connection-management";
import { getProviderConnectionsModel } from "@/lib/control-plane/provider-connections-client";
import { getRuntimePolicyModel } from "@/lib/control-plane/runtime-policy-client";
import { getModelCatalogModel } from "@/lib/gateway/model-catalog-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProviderConnectionsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ProviderConnectionsPage({ params }: ProviderConnectionsPageProps) {
  const { tenantId } = await params;
  const [locale, model, modelCatalog, runtimePolicy] = await Promise.all([
    getRequestLocale(),
    getProviderConnectionsModel(tenantId),
    getModelCatalogModel(tenantId),
    getRuntimePolicyModel(tenantId)
  ]);

  return (
    <ConsoleShell
      activeManagementItem="provider"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ProviderConnectionManagement
        locale={locale}
        model={model}
        modelCatalogItems={modelCatalog.models}
        pricingRules={runtimePolicy.activeConfig.pricingRules}
        runtimeModels={runtimePolicy.activeConfig.models}
      />
    </ConsoleShell>
  );
}
