import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogTable } from "@/features/request-logs/components/request-log-table";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";

type RequestLogsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function RequestLogsPage({ params }: RequestLogsPageProps) {
  const { tenantId } = await params;
  const records = await getLiveGatewayRequestLogs();

  return (
    <ConsoleShell activeSection="request-logs" tenantId={tenantId}>
      <RequestLogTable
        records={records ?? []}
        sourceState={records ? "ready" : "unavailable"}
        tenantId={tenantId}
        timezone="UTC"
      />
    </ConsoleShell>
  );
}
