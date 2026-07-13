import type { ApiKeyListItem } from "@/lib/control-plane/api-keys-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";

type ApiKeyProject = Pick<ProjectRecord, "id" | "name">;

export function compareApiKeyCreatedAtDescending(
  left: Pick<ApiKeyListItem, "createdAt">,
  right: Pick<ApiKeyListItem, "createdAt">
) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);

  if (Number.isNaN(leftTime)) {
    return Number.isNaN(rightTime) ? 0 : 1;
  }

  if (Number.isNaN(rightTime)) {
    return -1;
  }

  return rightTime - leftTime;
}

export function containsProject(
  projects: ApiKeyProject[],
  projectId: string
): boolean {
  return projects.some((project) => project.id === projectId);
}

export function attachProjectToApiKeys(
  project: ApiKeyProject,
  apiKeys: ApiKeyListItem[]
): ApiKeyListItem[] {
  return apiKeys.map((apiKey) => ({
    ...apiKey,
    projectId: project.id,
    projectName: project.name
  }));
}

export function containsApiKey(
  apiKeys: ApiKeyListItem[],
  apiKeyId: string
): boolean {
  return apiKeys.some((apiKey) => apiKey.credentialId === apiKeyId);
}
