import { TenantChatRuntimeSetup } from "@/features/tenant-chat-admin/components/tenant-chat-runtime-setup";
import { getTenantChatAdminRuntimeSetup } from "@/lib/control-plane/tenant-chat-runtime-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type TenantChatPageProps = {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{
    onboarding?: string | string[];
    providerConnectionId?: string | string[];
  }>;
};

export default async function TenantChatPage({ params, searchParams }: TenantChatPageProps) {
  const [{ tenantId }, query, locale] = await Promise.all([
    params,
    searchParams,
    getRequestLocale()
  ]);
  const result = await getTenantChatAdminRuntimeSetup(tenantId);
  const requestedProviderConnectionId =
    typeof query.providerConnectionId === "string" && isUuid(query.providerConnectionId)
      ? query.providerConnectionId
      : undefined;

  return (
    <TenantChatRuntimeSetup
      initialLoadError={result.ok ? null : result.error}
      initialSetup={result.ok ? result.data : null}
      locale={locale}
      onboardingReturn={query.onboarding === "provider-created"}
      requestedProviderConnectionId={requestedProviderConnectionId}
      tenantId={tenantId}
    />
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
