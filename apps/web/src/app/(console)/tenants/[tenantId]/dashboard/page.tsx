import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { DashboardOverviewView } from "@/features/dashboard/components/dashboard-overview";
import { getLiveDashboardOverview } from "@/lib/gateway/live-dashboard-overview";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type DashboardPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const overview = await getLiveDashboardOverview(tenantId);

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
      <DashboardOverviewView locale={locale} overview={overview} />
    </ConsoleShell>
  );
}
