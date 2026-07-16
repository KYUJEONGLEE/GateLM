import { redirect } from "next/navigation";

export default async function LegacyTenantChatLayout({
  params
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  redirect(`/tenants/${encodeURIComponent(tenantId)}/chat-app`);
}
