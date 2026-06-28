import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogDetail } from "@/features/request-logs/components/request-log-detail";
import { getLiveGatewayRequestDetail } from "@/lib/gateway/live-request-detail";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type RequestLogDetailPageProps = {
  params: Promise<{
    requestId: string;
    tenantId: string;
  }>;
};

export default async function RequestLogDetailPage({ params }: RequestLogDetailPageProps) {
  const { requestId, tenantId } = await params;
  const locale = await getRequestLocale();
  const record = await getLiveGatewayRequestDetail(requestId);

  if (!record) {
    notFound();
  }

  return (
    <ConsoleShell
      activeAnalyticsItem="invocation-history"
      activeSection="analytics"
      locale={locale}
      tenantId={tenantId}
    >
      <RequestLogDetail locale={locale} record={record} tenantId={tenantId} timezone="UTC" />
    </ConsoleShell>
  );
}
