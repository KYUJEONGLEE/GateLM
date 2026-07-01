import { ConsoleShell } from "@/components/layout/console-shell";
import { TenantManagement } from "@/features/tenants/components/tenant-management";
import { getTenantsModel } from "@/lib/control-plane/tenants-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type TenantsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function TenantsPage({ params }: TenantsPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getTenantsModel(tenantId);

  return (
    <ConsoleShell
      activeManagementItem="tenants"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <TenantManagement locale={locale} model={model} />
    </ConsoleShell>
  );
}
