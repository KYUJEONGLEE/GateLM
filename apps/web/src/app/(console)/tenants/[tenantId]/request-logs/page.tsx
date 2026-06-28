import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogTable } from "@/features/request-logs/components/request-log-table";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type RequestLogsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function RequestLogsPage({ params }: RequestLogsPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const records = await getLiveGatewayRequestLogs();

  return (
    <ConsoleShell
      activeAnalyticsItem="invocation-history"
      activeSection="analytics"
      locale={locale}
      tenantId={tenantId}
    >
      <RequestLogTable
        locale={locale}
        records={records ?? []}
        sourceState={records ? "ready" : "unavailable"}
        tenantId={tenantId}
        timezone="UTC"
      />
    </ConsoleShell>
  );
}
