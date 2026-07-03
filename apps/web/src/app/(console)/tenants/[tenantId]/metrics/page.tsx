import { redirect } from "next/navigation";

type MetricsRedirectPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function MetricsRedirectPage({ params }: MetricsRedirectPageProps) {
  const { tenantId } = await params;

  redirect(`/tenants/${tenantId}/request-logs`);
}
