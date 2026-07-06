import { notFound } from "next/navigation";
import { GatewayAdminConsole } from "@/features/gateway-admin/components/gateway-admin-console";
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
  const { section } = await params;
  const activeSection = normalizeGatewayAdminSection(section);

  if (!activeSection) {
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
