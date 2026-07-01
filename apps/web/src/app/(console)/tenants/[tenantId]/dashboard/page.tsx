import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { DashboardOverviewView } from "@/features/dashboard/components/dashboard-overview";
import { RequestLogDetailAside } from "@/features/request-logs/components/request-log-detail";
import { getLiveDashboardOverview } from "@/lib/gateway/live-dashboard-overview";
import { getLiveGatewayRequestDetail } from "@/lib/gateway/live-request-detail";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type DashboardPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams?: Promise<{
    motion?: string;
    requestId?: string;
    tab?: string;
    view?: string;
  }>;
};

export default async function DashboardPage({ params, searchParams }: DashboardPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedTab = resolvedSearchParams?.tab ?? (resolvedSearchParams?.view === "cache" ? "cache" : undefined);
  const selectedRequestId = resolvedSearchParams?.requestId;
  const activeTab =
    requestedTab === "requests" ||
    requestedTab === "traffic"
      ? "requests"
      : requestedTab === "cache" ||
          requestedTab === "routing" ||
          requestedTab === "safety" ||
          requestedTab === "limits"
        ? requestedTab
        : "overview";
  const suppressContentMotion = activeTab === "overview" && resolvedSearchParams?.motion === "none";
  const [locale, overview, recentRecords, selectedDetail] = await Promise.all([
    getRequestLocale(),
    getLiveDashboardOverview(tenantId),
    getLiveGatewayRequestLogs(),
    selectedRequestId ? getLiveGatewayRequestDetail(selectedRequestId) : Promise.resolve(null)
  ]);
  const scopedSelectedDetail =
    selectedDetail ?? recentRecords?.find((record) => record.requestId === selectedRequestId);

  if (!overview) {
    return (
      <ConsoleShell activeSection="dashboard" locale={locale} tenantId={tenantId}>
        <main className="console-content">
          <section className="dashboard-hero">
            <div>
              <p className="console-kicker">Gateway connection</p>
              <h2>Dashboard unavailable</h2>
              <p>Live Gateway metrics are not available right now.</p>
            </div>
          </section>
        </main>
      </ConsoleShell>
    );
  }

  if (tenantId !== overview.filters.tenantId) {
    notFound();
  }

  return (
    <ConsoleShell activeSection="dashboard" locale={locale} tenantId={tenantId}>
      <DashboardOverviewView
        activeTab={activeTab}
        detailPanel={
          scopedSelectedDetail ? (
            <RequestLogDetailAside
              locale={locale}
              record={scopedSelectedDetail}
              tenantId={tenantId}
              timezone="UTC"
            />
          ) : undefined
        }
        locale={locale}
        overview={overview}
        recentRecords={recentRecords?.slice(0, 5) ?? []}
        suppressContentMotion={suppressContentMotion}
      />
    </ConsoleShell>
  );
}
