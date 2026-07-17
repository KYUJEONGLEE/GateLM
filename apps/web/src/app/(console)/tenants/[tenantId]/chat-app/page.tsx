import {
  ChatAppRoutingSetup,
  type ChatAppPolicySection,
} from "@/features/tenant-chat-admin/components/chat-app-routing-setup";
import {
  getCurrentConsoleAuth,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth,
} from "@/lib/auth/current-console-auth";
import { getTenantRagDocuments } from "@/lib/control-plane/rag-documents-client";
import { getTenantRagKnowledgeBaseSettings } from "@/lib/control-plane/rag-knowledge-base-client";
import { getTenantChatAdminRuntimeSetup } from "@/lib/control-plane/tenant-chat-runtime-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ChatAppPageProps = {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{
    onboarding?: string | string[];
    providerConnectionId?: string | string[];
    section?: string | string[];
  }>;
};

export default async function ChatAppPage({ params, searchParams }: ChatAppPageProps) {
  const [{ tenantId }, query, locale, auth] = await Promise.all([
    params,
    searchParams,
    getRequestLocale(),
    getCurrentConsoleAuth(),
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const canManageKnowledgeBase = isTenantAdminForTenant(
    auth,
    effectiveTenantId,
  );
  const [result, knowledgeBaseResult, documentsResult] = await Promise.all([
    getTenantChatAdminRuntimeSetup(effectiveTenantId),
    canManageKnowledgeBase
      ? getTenantRagKnowledgeBaseSettings(effectiveTenantId)
      : Promise.resolve(null),
    canManageKnowledgeBase
      ? getTenantRagDocuments(effectiveTenantId)
      : Promise.resolve(null),
  ]);
  const requestedProviderConnectionId =
    typeof query.providerConnectionId === "string" && isUuid(query.providerConnectionId)
      ? query.providerConnectionId
      : undefined;

  return (
    <ChatAppRoutingSetup
      canManageKnowledgeBase={canManageKnowledgeBase}
      initialDocuments={
        documentsResult?.ok ? documentsResult.data.documents : []
      }
      initialDocumentsError={
        documentsResult && !documentsResult.ok ? documentsResult.error : null
      }
      initialKnowledgeBaseSettings={
        knowledgeBaseResult?.ok ? knowledgeBaseResult.data : null
      }
      initialKnowledgeBaseSettingsError={
        knowledgeBaseResult && !knowledgeBaseResult.ok
          ? knowledgeBaseResult.error
          : null
      }
      initialLoadError={result.ok ? null : result.error}
      initialPolicySection={readPolicySection(query.section)}
      initialSetup={result.ok ? result.data : null}
      locale={locale}
      onboardingReturn={query.onboarding === "provider-created"}
      requestedProviderConnectionId={requestedProviderConnectionId}
      tenantId={effectiveTenantId}
    />
  );
}

function readPolicySection(value: string | string[] | undefined): ChatAppPolicySection {
  return value === "routing" ||
    value === "cache" ||
    value === "security" ||
    value === "quota" ||
    value === "knowledge"
    ? value
    : "routing";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
