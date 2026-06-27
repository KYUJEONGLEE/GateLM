import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { DashboardOverviewView } from "@/features/dashboard/components/dashboard-overview";
import { getDashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";

type DashboardPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { tenantId } = await params;
  const overview = getDashboardOverview();

  if (tenantId !== overview.filters.tenantId) {
    notFound();
  }

  return (
    <ConsoleShell activeSection="dashboard" tenantId={tenantId}>
      <DashboardOverviewView overview={overview} />
    </ConsoleShell>
  );
}
