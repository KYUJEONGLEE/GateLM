import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogDetail } from "@/features/request-logs/components/request-log-detail";
import { getLiveGatewayRequestDetail } from "@/lib/gateway/live-request-detail";

type RequestLogDetailPageProps = {
  params: Promise<{
    requestId: string;
    tenantId: string;
  }>;
};

export default async function RequestLogDetailPage({ params }: RequestLogDetailPageProps) {
  const { requestId, tenantId } = await params;
  const record = await getLiveGatewayRequestDetail(requestId);

  if (!record) {
    notFound();
  }

  return (
    <ConsoleShell activeSection="request-logs" tenantId={tenantId}>
      <RequestLogDetail record={record} tenantId={tenantId} timezone="UTC" />
    </ConsoleShell>
  );
}
