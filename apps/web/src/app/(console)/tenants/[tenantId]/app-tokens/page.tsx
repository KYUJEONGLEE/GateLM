import { AppTokenManagement } from "@/features/app-tokens/components/app-token-management";
import { getAppTokensModel } from "@/lib/control-plane/app-tokens-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type AppTokensPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function AppTokensPage({ params }: AppTokensPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getAppTokensModel(tenantId);

  return (
    <AppTokenManagement
      key={`${tenantId}:${model.controlPlaneApplicationId}`}
      locale={locale}
      model={model}
    />
  );
}
