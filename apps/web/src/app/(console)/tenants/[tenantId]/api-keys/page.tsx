import { ApiKeyManagement } from "@/features/api-keys/components/api-key-management";
import {
  getCurrentConsoleAuth,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { getApiKeysModel } from "@/lib/control-plane/api-keys-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ApiKeysPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ApiKeysPage({ params }: ApiKeysPageProps) {
  const { tenantId } = await params;
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const model = await getApiKeysModel(effectiveTenantId);

  return (
    <ApiKeyManagement
      key={`${tenantId}:${model.controlPlaneProjectId}`}
      canManage={isTenantAdminForTenant(auth, effectiveTenantId)}
      locale={locale}
      model={model}
    />
  );
}
