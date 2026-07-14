import { redirect } from "next/navigation";

type ProjectRedirectPageProps = {
  params: Promise<{
    projectId: string;
    tenantId: string;
  }>;
};

export default async function ProjectRedirectPage({ params }: ProjectRedirectPageProps) {
  const { projectId, tenantId } = await params;

  redirect(
    `/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}/policies`
  );
}
