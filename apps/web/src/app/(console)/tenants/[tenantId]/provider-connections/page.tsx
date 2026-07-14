import { ProviderConnectionManagement } from "@/features/provider-connections/components/provider-connection-management";
import { getTenantChatProviderSetupContext } from "@/features/provider-connections/tenant-chat-setup-return";
import { getProviderConnectionsModel } from "@/lib/control-plane/provider-connections-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ProviderConnectionsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams: Promise<{
    intent?: string | string[];
    returnTo?: string | string[];
  }>;
};

export default async function ProviderConnectionsPage({
  params,
  searchParams
}: ProviderConnectionsPageProps) {
  const [{ tenantId }, query, locale] = await Promise.all([
    params,
    searchParams,
    getRequestLocale()
  ]);
  const [model, tenantChatSetupContext] = await Promise.all([
    getProviderConnectionsModel(tenantId),
    Promise.resolve(
      getTenantChatProviderSetupContext({
        intent: query.intent,
        returnTo: query.returnTo,
        tenantId
      })
    )
  ]);

  return (
    <ProviderConnectionManagement
      locale={locale}
      model={model}
      tenantChatSetupContext={tenantChatSetupContext}
    />
  );
}
