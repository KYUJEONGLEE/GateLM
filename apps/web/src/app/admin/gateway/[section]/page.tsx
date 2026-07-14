import { notFound } from "next/navigation";
import { GatewayAdminConsole } from "@/features/gateway-admin/components/gateway-admin-console";
import {
  getCurrentConsoleAuth,
  isTenantAdminForTenant
} from "@/lib/auth/current-console-auth";
import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import {
  getGatewayAdminModel,
  normalizeGatewayAdminRange,
  normalizeGatewayAdminSection,
  normalizeGatewayAdminStatus
} from "@/lib/gateway-admin/gateway-admin-model";

type GatewayAdminSectionPageProps = {
  params: Promise<{
    section: string;
  }>;
  searchParams?: Promise<{
    model?: string;
    projectId?: string;
    provider?: string;
    range?: string;
    status?: string;
  }>;
};

export default async function GatewayAdminSectionPage({
  params,
  searchParams
}: GatewayAdminSectionPageProps) {
  const [{ section }, auth] = await Promise.all([
    params,
    getCurrentConsoleAuth()
  ]);
  const activeSection = normalizeGatewayAdminSection(section);
  const tenantId = getControlPlaneTenantId();

  if (!activeSection || !auth.isAuthenticated || !isTenantAdminForTenant(auth, tenantId)) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const model = await getGatewayAdminModel({
    model: normalizeOptionalText(resolvedSearchParams?.model),
    projectId: normalizeOptionalText(resolvedSearchParams?.projectId),
    provider: normalizeOptionalText(resolvedSearchParams?.provider),
    range: normalizeGatewayAdminRange(resolvedSearchParams?.range),
    status: normalizeGatewayAdminStatus(resolvedSearchParams?.status)
  });

  return <GatewayAdminConsole model={model} section={activeSection} />;
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}
