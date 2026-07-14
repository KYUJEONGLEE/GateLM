import { notFound } from "next/navigation";
import { EmployeeControlManagement } from "@/features/employees/components/employee-control-management";
import {
  buildEmployeeUsagePeriods,
  buildEmployeeUsageReadModel
} from "@/features/employees/employee-usage-read-model";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
import { resolveControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { getAllEmployeeUsage } from "@/lib/control-plane/employee-usage-client";
import { getEmployeeControlModel } from "@/lib/control-plane/employees-client";
import { getLiveMonthlyProjectCostReport } from "@/lib/gateway/live-cost-report";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type EmployeesPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams?: Promise<{
    employeeId?: string;
  }>;
};

export default async function EmployeesPage({ params, searchParams }: EmployeesPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);

  if (!hasConsoleTenantAccess(auth, effectiveTenantId)) {
    notFound();
  }

  const periods = buildEmployeeUsagePeriods();
  const controlPlaneTenantId = resolveControlPlaneTenantId(effectiveTenantId);
  const [model, monthlyCostReport, todayUsage, trailingSevenDaysUsage, monthToDateUsage] =
    await Promise.all([
      getEmployeeControlModel(effectiveTenantId),
      getLiveMonthlyProjectCostReport(effectiveTenantId),
      getAllEmployeeUsage({
        ...periods.today,
        metric: "tokens",
        order: "desc",
        tenantId: controlPlaneTenantId
      }),
      getAllEmployeeUsage({
        ...periods.trailingSevenDays,
        metric: "tokens",
        order: "desc",
        tenantId: controlPlaneTenantId
      }),
      getAllEmployeeUsage({
        ...periods.monthToDate,
        metric: "cost",
        order: "desc",
        tenantId: controlPlaneTenantId
      })
    ]);
  const usage = buildEmployeeUsageReadModel(model, {
    monthToDate: monthToDateUsage.ok ? monthToDateUsage.data : undefined,
    today: todayUsage.ok ? todayUsage.data : undefined,
    trailingSevenDays: trailingSevenDaysUsage.ok
      ? trailingSevenDaysUsage.data
      : undefined
  });

  return (
    <EmployeeControlManagement
      initialEmployeeId={resolvedSearchParams?.employeeId?.trim() || undefined}
      locale={locale}
      model={model}
      monthlyCostReport={monthlyCostReport}
      usage={usage}
    />
  );
}
