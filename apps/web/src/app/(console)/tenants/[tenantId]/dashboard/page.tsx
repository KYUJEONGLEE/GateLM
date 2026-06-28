import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { DashboardOverviewView } from "@/features/dashboard/components/dashboard-overview";
import { getLiveDashboardOverview } from "@/lib/gateway/live-dashboard-overview";

type DashboardPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { tenantId } = await params;
  const overview = await getLiveDashboardOverview(tenantId);

  if (!overview) {
    return (
      <ConsoleShell activeSection="dashboard" tenantId={tenantId}>
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
    <ConsoleShell activeSection="dashboard" tenantId={tenantId}>
      <DashboardOverviewView overview={overview} />
    </ConsoleShell>
  );
}
