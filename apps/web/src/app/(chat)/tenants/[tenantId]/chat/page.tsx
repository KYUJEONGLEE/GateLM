import { notFound } from "next/navigation";
import { CustomerDemoApp } from "@/features/customer-demo/components/customer-demo-app";
import { getCustomerDemoModel } from "@/lib/fixtures/v1-customer-demo-fixtures";
import type { CustomerDemoIntegrationMode } from "@/lib/gateway/customer-demo-client";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type CustomerDemoPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function CustomerDemoPage({ params }: CustomerDemoPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const integrationMode = getCustomerDemoIntegrationMode();
  const model =
    integrationMode === "fixture" ? getCustomerDemoModel() : getCustomerDemoLiveModel();

  if (tenantId !== model.tenantId) {
    notFound();
  }

  return <CustomerDemoApp key={tenantId} locale={locale} model={model} />;
}

function getCustomerDemoIntegrationMode(): CustomerDemoIntegrationMode {
  return process.env.GATELM_WEB_CUSTOMER_DEMO_MODE === "fixture" ? "fixture" : "gateway";
}
