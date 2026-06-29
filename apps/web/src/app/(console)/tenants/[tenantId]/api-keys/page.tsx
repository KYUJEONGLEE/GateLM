import { ConsoleShell } from "@/components/layout/console-shell";
import { ApiKeyManagement } from "@/features/api-keys/components/api-key-management";
import { getApiKeysModel } from "@/lib/control-plane/api-keys-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ApiKeysPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ApiKeysPage({ params }: ApiKeysPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getApiKeysModel(tenantId);

  return (
    <ConsoleShell
      activeManagementItem="api-keys"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ApiKeyManagement
        key={`${tenantId}:${model.controlPlaneProjectId}`}
        locale={locale}
        model={model}
      />
    </ConsoleShell>
  );
}
