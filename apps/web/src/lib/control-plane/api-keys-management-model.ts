import type { ApiKeyListItem } from "@/lib/control-plane/api-keys-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";

type ApiKeyProject = Pick<ProjectRecord, "id" | "name">;

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
