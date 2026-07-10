import { EmployeeControlManagement } from "@/features/employees/components/employee-control-management";
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
};

export default async function EmployeesPage({ params }: EmployeesPageProps) {
  const { tenantId } = await params;
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const model = await getEmployeeControlModel(effectiveTenantId);

  return <EmployeeControlManagement locale={locale} model={model} />;
}
