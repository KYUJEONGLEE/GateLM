import { notFound } from "next/navigation";
import { CustomerDemoApp } from "@/features/customer-demo/components/customer-demo-app";
import { getCustomerDemoModel } from "@/lib/fixtures/v1-customer-demo-fixtures";
import type { CustomerDemoIntegrationMode } from "@/lib/gateway/customer-demo-client";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";

type CustomerDemoPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function CustomerDemoPage({ params }: CustomerDemoPageProps) {
  const { tenantId } = await params;
  const integrationMode = getCustomerDemoIntegrationMode();
  const model =
    integrationMode === "fixture" ? getCustomerDemoModel() : getCustomerDemoLiveModel();

  if (tenantId !== model.tenantId) {
    notFound();
  }

  return <CustomerDemoApp key={tenantId} model={model} />;
}

function getCustomerDemoIntegrationMode(): CustomerDemoIntegrationMode {
  return process.env.GATELM_WEB_CUSTOMER_DEMO_MODE === "fixture" ? "fixture" : "gateway";
}
