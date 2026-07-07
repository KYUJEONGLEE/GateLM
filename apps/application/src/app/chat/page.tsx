import { CustomerDemoApp } from "@/features/customer-demo/components/customer-demo-app";
import { getCustomerDemoModel } from "@/lib/fixtures/v1-customer-demo-fixtures";
import type { CustomerDemoIntegrationMode } from "@/lib/gateway/customer-demo-client";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type ApplicationChatPageProps = {
  searchParams?: Promise<{
    profile?: string | string[];
  }>;
};

export default async function ApplicationChatPage({ searchParams }: ApplicationChatPageProps) {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const profileId = firstQueryValue(params?.profile);
  const integrationMode = getCustomerDemoIntegrationMode();
  const model =
    integrationMode === "fixture"
      ? getCustomerDemoModel()
      : getCustomerDemoLiveModel({ profileId });
  const applicationModel = {
    ...model,
    surface: "application" as const
  };

  return (
    <CustomerDemoApp
      key={`${applicationModel.tenantId}:${applicationModel.projectId}:${applicationModel.applicationId}:${applicationModel.selectedChatProfileId ?? "fixture"}`}
      locale={locale}
      model={applicationModel}
    />
  );
}

function getCustomerDemoIntegrationMode(): CustomerDemoIntegrationMode {
  return process.env.GATELM_WEB_CUSTOMER_DEMO_MODE === "fixture" ? "fixture" : "gateway";
}

function firstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
