import "server-only";

import {
  getControlPlaneApplicationId,
  getControlPlaneProjectId
} from "@/lib/control-plane/control-plane-config";

type RawApplicationChatProfile = {
  apiKey?: unknown;
  applicationId?: unknown;
  id?: unknown;
  label?: unknown;
  projectId?: unknown;
};

type InternalApplicationChatProfile = {
  apiKey: string;
  applicationId: string;
  id: string;
  isDefault: boolean;
  label: string;
  projectId: string;
};

export type PublicApplicationChatProfile = {
  applicationId: string;
  configured: boolean;
  id: string;
  isDefault: boolean;
  label: string;
  projectId: string;
};

export type ResolvedApplicationChatProfile = InternalApplicationChatProfile;

export function getPublicApplicationChatProfiles(): PublicApplicationChatProfile[] {
  return getApplicationChatProfiles().map(toPublicProfile);
}

export function getSelectedPublicApplicationChatProfile(
  profileId: string | null | undefined
): PublicApplicationChatProfile {
  return toPublicProfile(selectApplicationChatProfile(profileId));
}

export function resolveApplicationChatProfile(
  profileId: string | null | undefined
): ResolvedApplicationChatProfile {
  const selected = selectApplicationChatProfile(profileId);

  if (!selected.apiKey) {
    throw new Error(`Application chat profile "${selected.label}" is missing a Gateway API key.`);
  }

  return selected;
}

function selectApplicationChatProfile(
  profileId: string | null | undefined
): InternalApplicationChatProfile {
  const profiles = getApplicationChatProfiles();
  const normalizedProfileId = normalizeProfileId(profileId);
  const selected =
    profiles.find((profile) => profile.id === normalizedProfileId)
    ?? profiles.find((profile) => profile.isDefault)
    ?? profiles[0];

  if (!selected) {
    throw new Error("No application chat profile is configured.");
  }

  return selected;
}

function getApplicationChatProfiles(): InternalApplicationChatProfile[] {
  const configuredProfiles = parseProfiles(process.env.GATELM_APPLICATION_CHAT_PROFILES);

  if (configuredProfiles.length > 0) {
    return configuredProfiles;
  }

  return [
    {
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
    }
  ];
}

function parseProfiles(value: string | undefined): InternalApplicationChatProfile[] {
  if (!value?.trim()) {
    return [];
  }

  const parsed = safeJsonParse(normalizeEnvJsonValue(value));

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
  const apiKey = normalizeText(raw.apiKey) ?? "";

  return {
    apiKey,
    applicationId: normalizeText(raw.applicationId) ?? getControlPlaneApplicationId(),
    id,
    isDefault: index === 0,
    label,
    projectId: normalizeText(raw.projectId) ?? getControlPlaneProjectId()
  };
}

function toPublicProfile(profile: InternalApplicationChatProfile): PublicApplicationChatProfile {
  return {
    applicationId: profile.applicationId,
    configured: profile.apiKey.length > 0,
    id: profile.id,
    isDefault: profile.isDefault,
    label: profile.label,
    projectId: profile.projectId
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(
      `GATELM_APPLICATION_CHAT_PROFILES must be a single-line JSON array. Current value contains invalid JSON: ${
        error instanceof Error ? error.message : "unknown parse error"
      }`
    );
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

function normalizeProfileId(value: unknown): string | undefined {
  const normalized = normalizeText(value)?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");

  return normalized?.replace(/^-+|-+$/g, "") || undefined;
}

function slugifyProfileId(label: string): string | undefined {
  return normalizeProfileId(label);
}
