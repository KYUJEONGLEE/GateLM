import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
import { getControlPlaneTenantName } from "@/lib/control-plane/tenants-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ConsoleTenantLayoutProps = {
  children: ReactNode;
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ConsoleTenantLayout({
  children,
  params
}: ConsoleTenantLayoutProps) {
  const { tenantId } = await params;
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);

  if (!hasConsoleTenantAccess(auth, effectiveTenantId)) {
    notFound();
  }

  const tenantName =
    auth.currentUser?.tenantName ?? await getControlPlaneTenantName(effectiveTenantId);
  const currentUser = auth.currentUser && tenantName
    ? { ...auth.currentUser, tenantName }
    : auth.currentUser;

  return (
    <ConsoleShell
      currentUser={currentUser}
      locale={locale}
      tenantId={effectiveTenantId}
    >
      {children}
    </ConsoleShell>
  );
}
