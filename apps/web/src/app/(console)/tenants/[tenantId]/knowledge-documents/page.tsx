import { notFound } from "next/navigation";

import { KnowledgeDocuments } from "@/features/rag-documents/knowledge-documents";
import {
  getCurrentConsoleAuth,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth,
} from "@/lib/auth/current-console-auth";
import { getTenantRagDocuments } from "@/lib/control-plane/rag-documents-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type KnowledgeDocumentsPageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function KnowledgeDocumentsPage({
  params,
}: KnowledgeDocumentsPageProps) {
  const [{ tenantId }, auth, locale] = await Promise.all([
    params,
    getCurrentConsoleAuth(),
    getRequestLocale(),
  ]);
  if (!isTenantAdminForTenant(auth, tenantId)) notFound();

  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const result = await getTenantRagDocuments(effectiveTenantId);
  return (
    <KnowledgeDocuments
      initialDocuments={result.ok ? result.data.documents : []}
      initialLoadError={result.ok ? null : result.error}
      locale={locale}
      tenantId={effectiveTenantId}
    />
  );
}
