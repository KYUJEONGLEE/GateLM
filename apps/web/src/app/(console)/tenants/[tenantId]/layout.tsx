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

  let currentUser = auth.currentUser;

  if (currentUser && !currentUser.tenantName) {
    const tenantName = await getControlPlaneTenantName(effectiveTenantId);

    if (tenantName) {
      currentUser = { ...currentUser, tenantName };
    }
  }

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
