import { ConsoleShell } from "@/components/layout/console-shell";
import { AdminOnboardingFlow } from "@/features/onboarding/components/admin-onboarding-flow";
import { getProviderConnectionsModel } from "@/lib/control-plane/provider-connections-client";
import { getTeamsModel } from "@/lib/control-plane/teams-client";
import { getAdminOnboardingModel } from "@/lib/fixtures/v1-admin-fixtures";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type OnboardingPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const gatewayConfig = getLiveGatewayConfig();
  const model = getAdminOnboardingModel({ tenantId });
  const [providerConnectionsModel, teamsModel] = await Promise.all([
    getProviderConnectionsModel(tenantId),
    getTeamsModel(tenantId)
  ]);

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <AdminOnboardingFlow
        activeStepId="project"
        gatewayBaseUrl={gatewayConfig.baseUrl}
        locale={locale}
        model={model}
        providerConnectionsModel={providerConnectionsModel}
        teamsModel={teamsModel}
      />
    </ConsoleShell>
  );
}
