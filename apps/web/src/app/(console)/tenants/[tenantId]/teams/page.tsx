import { ConsoleShell } from "@/components/layout/console-shell";
import { TeamManagement } from "@/features/teams/components/team-management";
import { getTeamsModel } from "@/lib/control-plane/teams-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type TeamsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function TeamsPage({ params }: TeamsPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const teamsModel = await getTeamsModel(tenantId);

  return (
    <ConsoleShell
      activeManagementItem="teams"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <TeamManagement locale={locale} model={teamsModel} />
    </ConsoleShell>
  );
}
