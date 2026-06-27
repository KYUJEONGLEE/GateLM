import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import { DashboardOverviewView } from "@/features/dashboard/components/dashboard-overview";
import { getDashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type DashboardPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const overview = getDashboardOverview();

  if (tenantId !== overview.filters.tenantId) {
    notFound();
  }

  return (
    <ConsoleShell activeSection="dashboard" locale={locale} tenantId={tenantId}>
      <DashboardOverviewView locale={locale} overview={overview} />
    </ConsoleShell>
  );
}
