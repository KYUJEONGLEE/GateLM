import { redirect } from "next/navigation";

type ProviderConnectionsRedirectPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
};

export default async function ProviderConnectionsRedirectPage({
  params
}: ProviderConnectionsRedirectPageProps) {
  const { tenantId } = await params;

  redirect(`/tenants/${tenantId}/provider-connections`);
}
