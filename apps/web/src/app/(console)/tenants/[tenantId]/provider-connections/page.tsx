import { ProviderConnectionManagement } from "@/features/provider-connections/components/provider-connection-management";
import { getProviderConnectionsModel } from "@/lib/control-plane/provider-connections-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProviderConnectionsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ProviderConnectionsPage({ params }: ProviderConnectionsPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getProviderConnectionsModel(tenantId);

  return <ProviderConnectionManagement locale={locale} model={model} />;
}
