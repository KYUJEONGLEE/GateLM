import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogDetail } from "@/features/request-logs/components/request-log-detail";
import {
  getDashboardOverview,
  getInvocationRecord
} from "@/lib/fixtures/v1-observability-fixtures";

type RequestLogDetailPageProps = {
  params: Promise<{
    requestId: string;
    tenantId: string;
  }>;
};

export default async function RequestLogDetailPage({ params }: RequestLogDetailPageProps) {
  const { requestId, tenantId } = await params;
  const overview = getDashboardOverview();
  const record = getInvocationRecord(requestId);

  if (tenantId !== overview.filters.tenantId || !record || record.tenantId !== tenantId) {
    notFound();
  }

  return (
    <ConsoleShell activeSection="request-logs" tenantId={tenantId}>
      <RequestLogDetail record={record} tenantId={tenantId} timezone={overview.range.timezone} />
    </ConsoleShell>
  );
}
