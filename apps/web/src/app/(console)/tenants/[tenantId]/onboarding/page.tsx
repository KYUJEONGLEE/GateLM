import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import {
  AdminOnboardingFlow,
  normalizeOnboardingStepId
} from "@/features/onboarding/components/admin-onboarding-flow";
import { getAdminOnboardingModel } from "@/lib/fixtures/v1-admin-fixtures";

type OnboardingPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams: Promise<{
    step?: string | string[];
  }>;
};

export default async function OnboardingPage({ params, searchParams }: OnboardingPageProps) {
  const { tenantId } = await params;
  const { step } = await searchParams;
  const model = getAdminOnboardingModel();

  if (tenantId !== model.tenantId) {
    notFound();
  }

  return (
    <ConsoleShell activeSection="onboarding" tenantId={tenantId}>
      <AdminOnboardingFlow activeStepId={normalizeOnboardingStepId(step)} model={model} />
    </ConsoleShell>
  );
}
