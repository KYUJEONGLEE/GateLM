import { ConsoleShell } from "@/components/layout/console-shell";
import { ModelCatalogView } from "@/features/model-catalog/components/model-catalog-view";
import { getModelCatalogModel } from "@/lib/gateway/model-catalog-client";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ModelCatalogPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ModelCatalogPage({ params }: ModelCatalogPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = await getModelCatalogModel(tenantId);

  return (
    <ConsoleShell
      activeManagementItem="model-catalog"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <ModelCatalogView locale={locale} model={model} />
    </ConsoleShell>
  );
}
