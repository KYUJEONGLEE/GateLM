import { notFound } from "next/navigation";
import { CustomerDemoApp } from "@/features/customer-demo/components/customer-demo-app";
import { getCustomerDemoModel } from "@/lib/fixtures/v1-customer-demo-fixtures";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type CustomerDemoPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function CustomerDemoPage({ params }: CustomerDemoPageProps) {
  const { tenantId } = await params;
  const locale = await getRequestLocale();
  const model = getCustomerDemoModel();

  if (tenantId !== model.tenantId) {
    notFound();
  }

  return <CustomerDemoApp key={tenantId} locale={locale} model={model} />;
}
