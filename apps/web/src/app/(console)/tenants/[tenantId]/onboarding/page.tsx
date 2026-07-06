import { ConsoleShell } from "@/components/layout/console-shell";
import { AdminOnboardingFlow } from "@/features/onboarding/components/admin-onboarding-flow";
import { getTeamsModel } from "@/lib/control-plane/teams-client";
import { getAdminOnboardingModel } from "@/lib/fixtures/v1-admin-fixtures";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type OnboardingPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = getAdminOnboardingModel({ tenantId });
  const teamsModel = await getTeamsModel(tenantId);

  return (
    <ConsoleShell
      activeManagementItem="project"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <AdminOnboardingFlow
        activeStepId="project"
        locale={locale}
        model={model}
        teamsModel={teamsModel}
      />
    </ConsoleShell>
  );
}
