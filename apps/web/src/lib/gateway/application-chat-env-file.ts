import "server-only";

import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import {
  removeApplicationChatEnvProjectFromFile,
  syncApplicationChatEnvForProjectsFile
} from "@/lib/gateway/application-chat-env-file-core";

export async function syncApplicationChatEnvForProjects(
  projects: ProjectRecord[]
): Promise<void> {
  await syncApplicationChatEnvForProjectsFile(projects);
}

export async function removeApplicationChatEnvProject(projectId: string): Promise<void> {
  await removeApplicationChatEnvProjectFromFile({ projectId });
}
