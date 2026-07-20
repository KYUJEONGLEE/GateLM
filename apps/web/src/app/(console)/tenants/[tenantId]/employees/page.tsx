import { notFound } from "next/navigation";
import { EmployeeControlManagement } from "@/features/employees/components/employee-control-management";
import { buildEmployeeUsageReadModel } from "@/features/employees/employee-usage-read-model";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
import { resolveControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { getAllEmployeeUsage } from "@/lib/control-plane/employee-usage-client";
import { getEmployeeWeeklyTokenQuotas } from "@/lib/control-plane/employee-weekly-token-quota-client";
import { getEmployeeControlModel } from "@/lib/control-plane/employees-client";
import { getTenantChatAdminRuntimeSetup } from "@/lib/control-plane/tenant-chat-runtime-client";
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

  const controlPlaneTenantId = resolveControlPlaneTenantId(effectiveTenantId);
  const usageTo = new Date();
  const dailyUsageFrom = new Date(usageTo.getTime() - 24 * 60 * 60 * 1000);
  const weeklyUsageFrom = new Date(usageTo.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [
    model,
    monthlyCostReport,
    weeklyTokenQuotas,
    tenantChatUsage,
    weeklyTenantChatUsage,
    tenantChatRuntime
  ] = await Promise.all([
    getEmployeeControlModel(effectiveTenantId),
    getLiveMonthlyProjectCostReport(effectiveTenantId),
    getEmployeeWeeklyTokenQuotas(controlPlaneTenantId),
    getAllEmployeeUsage({
      from: dailyUsageFrom.toISOString(),
      metric: "cost",
      order: "desc",
      source: "tenant_chat",
      tenantId: controlPlaneTenantId,
      to: usageTo.toISOString()
    }),
    getAllEmployeeUsage({
      from: weeklyUsageFrom.toISOString(),
      metric: "cost",
      order: "desc",
      source: "tenant_chat",
      tenantId: controlPlaneTenantId,
      to: usageTo.toISOString()
    }),
    getTenantChatAdminRuntimeSetup(effectiveTenantId)
  ]);
  const usage = buildEmployeeUsageReadModel(model, {
    loadError: !weeklyTokenQuotas.ok
      ? weeklyTokenQuotas.error
      : !tenantChatUsage.ok
        ? tenantChatUsage.error
        : !weeklyTenantChatUsage.ok
          ? weeklyTenantChatUsage.error
          : null,
    tenantChatUsage: tenantChatUsage.ok ? tenantChatUsage.data : undefined,
    weeklyUsage: weeklyTenantChatUsage.ok ? weeklyTenantChatUsage.data : undefined,
    weeklyTokenQuotas: weeklyTokenQuotas.ok ? weeklyTokenQuotas.data : undefined
  });

  return (
    <EmployeeControlManagement
      initialEmployeeId={resolvedSearchParams?.employeeId?.trim() || undefined}
      locale={locale}
      model={model}
      monthlyCostReport={monthlyCostReport}
      tenantMonthlyTokenLimit={
        tenantChatRuntime.ok
          ? tenantChatRuntime.data.activeSnapshot?.quota.defaultMonthlyTokenLimit ?? null
          : null
      }
      usage={usage}
    />
  );
}
