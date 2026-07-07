import "server-only";

import {
  getControlPlaneApplicationId,
  getControlPlaneProjectId,
  getControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import { listControlPlaneProjects } from "@/lib/control-plane/projects-client";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";

type RawApplicationChatProfile = {
  apiKey?: unknown;
  applicationId?: unknown;
  id?: unknown;
  label?: unknown;
  projectId?: unknown;
};

type ApplicationChatProfilesSource = "control-plane" | "fallback" | "manual";

type InternalApplicationChatProfile = {
  apiKey: string;
  applicationId: string;
  disabledReason?: string;
  id: string;
  isDefault: boolean;
  label: string;
  projectId: string;
};

type ApplicationChatProfileLoadResult = {
  loadError: string | null;
  profiles: InternalApplicationChatProfile[];
  source: ApplicationChatProfilesSource;
};

export type PublicApplicationChatProfile = {
  applicationId: string;
  configured: boolean;
  disabledReason?: string;
  id: string;
  isDefault: boolean;
  label: string;
  projectId: string;
};

export type ApplicationChatProfileSelection = {
  loadError: string | null;
  profiles: PublicApplicationChatProfile[];
  selectedProfile: PublicApplicationChatProfile;
  source: ApplicationChatProfilesSource;
};

export type ResolvedApplicationChatProfile = InternalApplicationChatProfile;

const GATEWAY_API_KEY_MISSING = "Gateway API key missing";

export async function getPublicApplicationChatProfiles(): Promise<PublicApplicationChatProfile[]> {
  const result = await getApplicationChatProfiles();

  return result.profiles.map(toPublicProfile);
}

export async function getSelectedPublicApplicationChatProfile(
  profileId: string | null | undefined
): Promise<PublicApplicationChatProfile> {
  return toPublicProfile(await selectApplicationChatProfile(profileId));
}

export async function getApplicationChatProfileSelection(
  profileId: string | null | undefined
): Promise<ApplicationChatProfileSelection> {
  const result = await getApplicationChatProfiles();
  const selectedProfile = selectProfileFromList(result.profiles, profileId, result.loadError);

  return {
    loadError: result.loadError,
    profiles: result.profiles.map(toPublicProfile),
    selectedProfile: toPublicProfile(selectedProfile),
    source: result.source
  };
}

export async function resolveApplicationChatProfile(
  profileId: string | null | undefined
): Promise<ResolvedApplicationChatProfile> {
  const selected = await selectApplicationChatProfile(profileId);

  if (selected.disabledReason || !selected.apiKey) {
    throw new Error(selected.disabledReason ?? GATEWAY_API_KEY_MISSING);
  }

  return selected;
}

async function selectApplicationChatProfile(
  profileId: string | null | undefined
): Promise<InternalApplicationChatProfile> {
  const result = await getApplicationChatProfiles();

  return selectProfileFromList(result.profiles, profileId, result.loadError);
}

async function getApplicationChatProfiles(): Promise<ApplicationChatProfileLoadResult> {
  try {
    const configuredProfiles = parseProfiles(process.env.GATELM_APPLICATION_CHAT_PROFILES);

    if (configuredProfiles.length > 0) {
      return {
        loadError: null,
        profiles: configuredProfiles,
        source: "manual"
      };
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "GATELM_APPLICATION_CHAT_PROFILES could not be parsed.";

    return {
      loadError: message,
      profiles: [getDefaultApplicationChatProfile()],
      source: "manual"
    };
  }

  if (isAutoProfileDiscoveryEnabled()) {
    return getControlPlaneApplicationChatProfiles();
  }

  return {
    loadError: null,
    profiles: [getDefaultApplicationChatProfile()],
    source: "fallback"
  };
}

async function getControlPlaneApplicationChatProfiles(): Promise<ApplicationChatProfileLoadResult> {
  let apiKeysByProjectId: Map<string, string>;

  try {
    apiKeysByProjectId = parseApplicationChatApiKeyMap();
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "GATELM_APPLICATION_CHAT_API_KEYS could not be parsed.";

    return buildUnavailableControlPlaneProfileResult(message);
  }

  const result = await listControlPlaneProjects(getControlPlaneTenantId());

  if (!result.ok) {
    return buildUnavailableControlPlaneProfileResult(result.error);
  }

  const projects = result.data.filter(isApplicationChatProjectCandidate);

  if (projects.length === 0) {
    return buildUnavailableControlPlaneProfileResult("No active runtime-ready projects found.");
  }

  const singleProjectApiKey = getSingleApplicationChatApiKey();
  const profiles = projects.map((project, index) => {
    const apiKey =
      apiKeysByProjectId.get(project.id)
      ?? (projects.length === 1 ? singleProjectApiKey : "");

    return toControlPlaneProfile(
      project,
      index,
      apiKey,
      getControlPlaneProfileDisabledReason(apiKey, projects.length, singleProjectApiKey)
    );
  });

  return {
    loadError: null,
    profiles,
    source: "control-plane"
  };
}

function buildUnavailableControlPlaneProfileResult(
  reason: string
): ApplicationChatProfileLoadResult {
  return {
    loadError: reason,
    profiles: [
      {
        apiKey: "",
        applicationId: getControlPlaneApplicationId(),
        disabledReason: reason,
        id: "control-plane-projects-unavailable",
        isDefault: true,
        label: "Control Plane projects unavailable",
        projectId: getControlPlaneProjectId()
      }
    ],
    source: "control-plane"
  };
}

function selectProfileFromList(
  profiles: InternalApplicationChatProfile[],
  profileId: string | null | undefined,
  loadError: string | null
): InternalApplicationChatProfile {
  const normalizedProfileId = normalizeProfileId(profileId);
  const selected =
    profiles.find((profile) => profile.id === normalizedProfileId)
    ?? profiles.find((profile) => profile.isDefault)
    ?? profiles[0];

  if (!selected) {
    throw new Error(loadError ?? "No application chat profile is configured.");
  }

  return selected;
}

function getDefaultApplicationChatProfile(): InternalApplicationChatProfile {
  return {
    apiKey: firstEnv("GATELM_GATEWAY_API_KEY", "GATEWAY_API_KEY", "GATELM_DEMO_API_KEY")
      ?? "glm_api_test_redacted",
    applicationId: getControlPlaneApplicationId(),
    id: normalizeProfileId(
      firstEnv("GATELM_APPLICATION_CHAT_PROFILE_ID", "GATELM_GATEWAY_PROJECT_ID", "GATEWAY_PROJECT_ID")
    ) ?? "default",
    isDefault: true,
    label: firstEnv("GATELM_APPLICATION_CHAT_PROFILE_LABEL") ?? "Default Project",
    projectId: firstEnv("GATELM_CONTROL_PLANE_PROJECT_ID", "GATELM_DEMO_PROJECT_ID")
      ?? getControlPlaneProjectId()
  };
}

function parseProfiles(value: string | undefined): InternalApplicationChatProfile[] {
  if (!value?.trim()) {
    return [];
  }

  const parsed = safeJsonParse(
    normalizeEnvJsonValue(value),
    "GATELM_APPLICATION_CHAT_PROFILES must be a single-line JSON array."
  );

  if (!Array.isArray(parsed)) {
    throw new Error("GATELM_APPLICATION_CHAT_PROFILES must be a JSON array.");
  }

  return parsed
    .map((item, index) => toProfile(item, index))
    .filter((profile): profile is InternalApplicationChatProfile => profile !== null);
}

function toProfile(item: unknown, index: number): InternalApplicationChatProfile | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const raw = item as RawApplicationChatProfile;
  const label = normalizeText(raw.label) ?? `Project ${index + 1}`;
  const id = normalizeProfileId(raw.id) ?? slugifyProfileId(label) ?? `project-${index + 1}`;
  const apiKey = normalizeApiKey(raw.apiKey) ?? "";

  return {
    apiKey,
    applicationId: normalizeText(raw.applicationId) ?? getControlPlaneApplicationId(),
    disabledReason: apiKey ? undefined : GATEWAY_API_KEY_MISSING,
    id,
    isDefault: index === 0,
    label,
    projectId: normalizeText(raw.projectId) ?? getControlPlaneProjectId()
  };
}

function toControlPlaneProfile(
  project: ApplicationChatProjectCandidate,
  index: number,
  apiKey: string,
  disabledReason: string | undefined
): InternalApplicationChatProfile {
  return {
    apiKey,
    applicationId: project.runtimeApplicationId,
    disabledReason,
    id: normalizeProfileId(project.id) ?? `project-${index + 1}`,
    isDefault: index === 0,
    label: project.name,
    projectId: project.id
  };
}

function toPublicProfile(profile: InternalApplicationChatProfile): PublicApplicationChatProfile {
  const configured = !profile.disabledReason && profile.apiKey.length > 0;

  return {
    applicationId: profile.applicationId,
    configured,
    disabledReason: configured ? undefined : profile.disabledReason ?? GATEWAY_API_KEY_MISSING,
    id: profile.id,
    isDefault: profile.isDefault,
    label: profile.label,
    projectId: profile.projectId
  };
}

type ApplicationChatProjectCandidate = ProjectRecord & {
  runtimeApplicationId: string;
};

function isApplicationChatProjectCandidate(
  project: ProjectRecord
): project is ApplicationChatProjectCandidate {
  return project.status === "ACTIVE" && Boolean(project.runtimeApplicationId);
}

function parseApplicationChatApiKeyMap(): Map<string, string> {
  const value = process.env.GATELM_APPLICATION_CHAT_API_KEYS;

  if (!value?.trim()) {
    return new Map();
  }

  const parsed = safeJsonParse(
    normalizeEnvJsonValue(value),
    "GATELM_APPLICATION_CHAT_API_KEYS must be a JSON object keyed by projectId."
  );

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GATELM_APPLICATION_CHAT_API_KEYS must be a JSON object keyed by projectId.");
  }

  const apiKeysByProjectId = new Map<string, string>();

  for (const [projectId, apiKey] of Object.entries(parsed)) {
    if (typeof apiKey !== "string") {
      throw new Error("GATELM_APPLICATION_CHAT_API_KEYS must map projectId strings to API key strings.");
    }

    const normalizedProjectId = normalizeText(projectId);
    const normalizedApiKey = normalizeApiKey(apiKey);

    if (normalizedProjectId && normalizedApiKey) {
      apiKeysByProjectId.set(normalizedProjectId, normalizedApiKey);
    }
  }

  return apiKeysByProjectId;
}

function getSingleApplicationChatApiKey() {
  return normalizeApiKey(
    firstEnv("GATELM_APPLICATION_CHAT_API_KEY", "GATELM_GATEWAY_API_KEY", "GATEWAY_API_KEY")
  ) ?? "";
}

function getControlPlaneProfileDisabledReason(
  apiKey: string,
  projectCount: number,
  singleProjectApiKey: string
) {
  if (apiKey) {
    return undefined;
  }

  if (projectCount > 1 && singleProjectApiKey) {
    return "Multiple runtime-ready projects found. Set GATELM_APPLICATION_CHAT_API_KEYS by project id.";
  }

  return GATEWAY_API_KEY_MISSING;
}

function safeJsonParse(value: string, message: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(message);
  }
}

function normalizeEnvJsonValue(value: string) {
  const normalized = value.trim();

  if (
    (normalized.startsWith("'") && normalized.endsWith("'")) ||
    (normalized.startsWith("\"") && normalized.endsWith("\""))
  ) {
    return normalized.slice(1, -1).trim();
  }

  return normalized;
}

function isAutoProfileDiscoveryEnabled() {
  const value = process.env.GATELM_APPLICATION_CHAT_AUTO_PROFILES?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeApiKey(value: unknown): string | undefined {
  const normalized = normalizeText(value);

  if (!normalized || isPlaceholderApiKey(normalized)) {
    return undefined;
  }

  return normalized;
}

function isPlaceholderApiKey(value: string) {
  const normalized = value.trim().toLowerCase();

  return (
    normalized.startsWith("paste_gateway_api_key_for_") ||
    normalized === "gsk_live_replace_me" ||
    normalized === "replace_me" ||
    normalized === "your_gateway_api_key"
  );
}

function normalizeProfileId(value: unknown): string | undefined {
  const normalized = normalizeText(value)?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");

  return normalized?.replace(/^-+|-+$/g, "") || undefined;
}

function slugifyProfileId(label: string): string | undefined {
  return normalizeProfileId(label);
}
