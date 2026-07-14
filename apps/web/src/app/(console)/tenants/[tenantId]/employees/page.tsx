import { EmployeeControlManagement } from "@/features/employees/components/employee-control-management";
import { buildEmployeeUsageReadModel } from "@/features/employees/employee-usage-read-model";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { getEmployeeControlModel } from "@/lib/control-plane/employees-client";
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
  const model = await getEmployeeControlModel(effectiveTenantId);
  const usage = buildEmployeeUsageReadModel(model);

  return (
    <EmployeeControlManagement
      initialEmployeeId={resolvedSearchParams?.employeeId?.trim() || undefined}
      locale={locale}
      model={model}
      usage={usage}
    />
  );
}
