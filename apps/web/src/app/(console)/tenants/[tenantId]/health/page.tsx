import { ConsoleShell } from "@/components/layout/console-shell";
import { GatewayHealthOverview } from "@/features/health/components/gateway-health-overview";
import { getGatewayHealthModel } from "@/lib/gateway/health-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type HealthPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function HealthPage({ params }: HealthPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getGatewayHealthModel(tenantId);

  return (
    <ConsoleShell
      activeAnalyticsItem="health"
      activeSection="analytics"
      locale={locale}
      tenantId={tenantId}
    >
      <GatewayHealthOverview locale={locale} model={model} />
    </ConsoleShell>
  );
}
