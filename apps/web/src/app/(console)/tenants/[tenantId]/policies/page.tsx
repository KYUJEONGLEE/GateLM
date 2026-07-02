import { ConsoleShell } from "@/components/layout/console-shell";
import { RuntimePolicyEditor } from "@/features/policies/components/runtime-policy-editor";
import { getRuntimePolicyModel } from "@/lib/control-plane/runtime-policy-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type PoliciesPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function PoliciesPage({ params }: PoliciesPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getRuntimePolicyModel(tenantId);

  return (
    <ConsoleShell
      activeManagementItem="policies"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <RuntimePolicyEditor locale={locale} model={model} />
    </ConsoleShell>
  );
}
