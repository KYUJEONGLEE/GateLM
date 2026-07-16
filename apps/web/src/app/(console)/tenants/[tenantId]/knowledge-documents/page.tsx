import { notFound, redirect } from "next/navigation";

import {
  getCurrentConsoleAuth,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth,
} from "@/lib/auth/current-console-auth";

type KnowledgeDocumentsPageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function KnowledgeDocumentsPage({
  params,
}: KnowledgeDocumentsPageProps) {
  const [{ tenantId }, auth] = await Promise.all([params, getCurrentConsoleAuth()]);
  if (!isTenantAdminForTenant(auth, tenantId)) notFound();

  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  redirect(
    `/tenants/${encodeURIComponent(effectiveTenantId)}/chat-app?section=knowledge`,
  );
}
