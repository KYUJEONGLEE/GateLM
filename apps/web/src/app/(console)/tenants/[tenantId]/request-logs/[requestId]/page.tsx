import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogDetail } from "@/features/request-logs/components/request-log-detail";
import {
  getDashboardOverview,
  getInvocationRecord
} from "@/lib/fixtures/v1-observability-fixtures";
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
  const overview = getDashboardOverview();
  const record = getInvocationRecord(requestId);

  if (tenantId !== overview.filters.tenantId || !record || record.tenantId !== tenantId) {
    notFound();
  }

  return (
    <ConsoleShell
      activeAnalyticsItem="invocation-history"
      activeSection="analytics"
      locale={locale}
      tenantId={tenantId}
    >
      <RequestLogDetail
        locale={locale}
        record={record}
        tenantId={tenantId}
        timezone={overview.range.timezone}
      />
    </ConsoleShell>
  );
}
