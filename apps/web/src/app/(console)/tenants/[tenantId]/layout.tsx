import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import {
  getCurrentConsoleAuth,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
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

  return (
    <ConsoleShell
      currentUser={auth.currentUser}
      locale={locale}
      tenantId={effectiveTenantId}
    >
      {children}
    </ConsoleShell>
  );
}
