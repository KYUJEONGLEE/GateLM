import { redirect } from "next/navigation";

type TenantChatPageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function TenantChatPage({ params }: TenantChatPageProps) {
  const { tenantId } = await params;
  redirect(`/tenants/${encodeURIComponent(tenantId)}/dashboard?surface=tenant_chat`);
}
