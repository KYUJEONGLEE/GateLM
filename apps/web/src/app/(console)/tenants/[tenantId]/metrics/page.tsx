import { ConsoleShell } from "@/components/layout/console-shell";
import { MetricsOverview } from "@/features/metrics/components/metrics-overview";
import { getGatewayMetricsModel } from "@/lib/gateway/metrics-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type MetricsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function MetricsPage({ params }: MetricsPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getGatewayMetricsModel(tenantId);

  return (
    <ConsoleShell
      activeAnalyticsItem="metrics"
      activeSection="analytics"
      locale={locale}
      tenantId={tenantId}
    >
      <MetricsOverview locale={locale} model={model} />
    </ConsoleShell>
  );
}
