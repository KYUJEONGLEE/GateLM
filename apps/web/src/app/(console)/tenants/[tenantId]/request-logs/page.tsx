import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogTable } from "@/features/request-logs/components/request-log-table";
import {
  getDashboardOverview,
  getInvocationRecords
} from "@/lib/fixtures/v1-observability-fixtures";

type RequestLogsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function RequestLogsPage({ params }: RequestLogsPageProps) {
  const { tenantId } = await params;
  const overview = getDashboardOverview();

  if (tenantId !== overview.filters.tenantId) {
    notFound();
  }

  return (
    <ConsoleShell activeSection="request-logs" tenantId={tenantId}>
      <RequestLogTable
        records={getInvocationRecords()}
        tenantId={tenantId}
        timezone={overview.range.timezone}
      />
    </ConsoleShell>
  );
}
