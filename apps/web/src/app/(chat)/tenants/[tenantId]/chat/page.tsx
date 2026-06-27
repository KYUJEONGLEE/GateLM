import { notFound } from "next/navigation";
import { CustomerDemoApp } from "@/features/customer-demo/components/customer-demo-app";
import { getCustomerDemoModel } from "@/lib/fixtures/v1-customer-demo-fixtures";

type CustomerDemoPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function CustomerDemoPage({ params }: CustomerDemoPageProps) {
  const { tenantId } = await params;
  const model = getCustomerDemoModel();

  if (tenantId !== model.tenantId) {
    notFound();
  }

  return <CustomerDemoApp model={model} />;
}
