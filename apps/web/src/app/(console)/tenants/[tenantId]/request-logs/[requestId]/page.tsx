import { redirect } from "next/navigation";

type RequestLogDetailPageProps = {
  params: Promise<{
    requestId: string;
    tenantId: string;
  }>;
};

export default async function RequestLogDetailPage({ params }: RequestLogDetailPageProps) {
  const { requestId, tenantId } = await params;

  redirect(`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(requestId)}`);
}
