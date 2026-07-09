import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";

const AUTO_PROFILES_KEY = "GATELM_APPLICATION_CHAT_AUTO_PROFILES";
const API_KEYS_KEY = "GATELM_APPLICATION_CHAT_API_KEYS";
const MANUAL_PROFILES_KEY = "GATELM_APPLICATION_CHAT_PROFILES";

type EnvSource = Record<string, string | undefined>;

type EnvFileOptions = {
  cwd?: string;
  env?: EnvSource;
  envFilePath?: string;
};

type RemoveProjectEnvInput = EnvFileOptions & {
  projectId: string;
};

export async function syncApplicationChatEnvForProjectsFile(
  projects: ProjectRecord[],
  options: EnvFileOptions = {}
): Promise<void> {
  const env = options.env ?? process.env;

  if (isEnvFileSyncDisabled(env)) {
    return;
  }

  const envFilePath = resolveApplicationChatEnvFilePath(options);
  const content = await readTextFileIfExists(envFilePath);
  const existingApiKeysByProjectId = parseApplicationChatApiKeys(content);
  const nextApiKeysByProjectId: Record<string, string> = {};

  for (const project of projects.filter(isApplicationChatProjectCandidate)) {
    nextApiKeysByProjectId[project.id] =
      existingApiKeysByProjectId[project.id]
      ?? `paste_gateway_api_key_for_${toEnvPlaceholderSuffix(project.name)}`;
  }

  const nextContent = commentOutEnvKey(
    upsertEnvValue(
      upsertEnvValue(content, AUTO_PROFILES_KEY, "true"),
      API_KEYS_KEY,
      quoteEnvJson(nextApiKeysByProjectId)
    ),
    MANUAL_PROFILES_KEY
  );

  updateRuntimeApplicationChatEnv(env, nextApiKeysByProjectId);
  await writeFile(envFilePath, ensureTrailingNewline(nextContent), "utf8");
}

export async function removeApplicationChatEnvProjectFromFile({
  projectId,
  ...options
}: RemoveProjectEnvInput): Promise<void> {
  const env = options.env ?? process.env;

  if (isEnvFileSyncDisabled(env)) {
    return;
  }

  const envFilePath = resolveApplicationChatEnvFilePath(options);
  const content = await readTextFileIfExists(envFilePath);
  const nextApiKeysByProjectId = parseApplicationChatApiKeys(content);

  if (!(projectId in nextApiKeysByProjectId)) {
    return;
  }

  delete nextApiKeysByProjectId[projectId];
  updateRuntimeApplicationChatEnv(env, nextApiKeysByProjectId);

  await writeFile(
    envFilePath,
    ensureTrailingNewline(
      upsertEnvValue(content, API_KEYS_KEY, quoteEnvJson(nextApiKeysByProjectId))
    ),
    "utf8"
  );
}

function isEnvFileSyncDisabled(env: EnvSource) {
  const value = env.GATELM_APPLICATION_CHAT_ENV_SYNC?.trim().toLowerCase();

  return value === "0" || value === "false" || value === "no" || value === "off";
}

function resolveApplicationChatEnvFilePath(options: EnvFileOptions) {
  const override = options.envFilePath ?? options.env?.GATELM_APPLICATION_CHAT_ENV_FILE?.trim();

  if (override) {
    return path.resolve(override);
  }

  let currentDir = options.cwd ?? process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(currentDir, "docs", "v2.0.0", "contracts.md"))) {
      return path.join(currentDir, ".env");
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return path.resolve(process.cwd(), "..", "..", ".env");
}

async function readTextFileIfExists(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return "";
    }

    throw error;
  }
}

function parseApplicationChatApiKeys(content: string): Record<string, string> {
  const value = getEnvValue(content, API_KEYS_KEY);

  if (!value) {
    return {};
  }

  const parsed = JSON.parse(stripEnvQuotes(value)) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${API_KEYS_KEY} must be a JSON object.`);
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([projectId, apiKey]) => [projectId, apiKey])
  );
}

function getEnvValue(content: string, key: string) {
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(key)}\\s*=\\s*(?:'(?<single>[\\s\\S]*?)'|"(?<double>[\\s\\S]*?)"|(?<bare>[^\\r\\n]*))`,
    "m"
  );
  const match = content.match(pattern);

  if (!match?.groups) {
    return "";
  }

  return (match.groups.single ?? match.groups.double ?? match.groups.bare ?? "").trim();
}

function upsertEnvValue(content: string, key: string, value: string) {
  const newline = getNewline(content);
  const assignment = `${key}=${value}`;
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(key)}\\s*=\\s*(?:'(?<single>[\\s\\S]*?)'|"(?<double>[\\s\\S]*?)"|(?<bare>[^\\r\\n]*))`,
    "m"
  );

  if (pattern.test(content)) {
    return content.replace(pattern, assignment);
  }

  const lines = content.length > 0 ? content.split(/\r?\n/) : [];

  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.splice(lines.length - 1, 0, assignment);
  } else {
    lines.push(assignment);
  }

  return lines.join(newline);
}

function commentOutEnvKey(content: string, key: string) {
  const newline = getNewline(content);
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);

  return content
    .split(/\r?\n/)
    .map((line) => {
      if (line.trimStart().startsWith("#") || !pattern.test(line)) {
        return line;
      }

      return `# ${line}`;
    })
    .join(newline);
}

function isApplicationChatProjectCandidate(project: ProjectRecord) {
  return project.status === "ACTIVE" && Boolean(project.runtimeApplicationId);
}

function quoteEnvJson(value: Record<string, string>) {
  return `'${JSON.stringify(value)}'`;
}

function stripEnvQuotes(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function toEnvPlaceholderSuffix(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "project";
}

function updateRuntimeApplicationChatEnv(
  env: EnvSource,
  apiKeysByProjectId: Record<string, string>
) {
  env[AUTO_PROFILES_KEY] = "true";
  env[API_KEYS_KEY] = JSON.stringify(apiKeysByProjectId);
}

function ensureTrailingNewline(value: string) {
  return value.endsWith("\n") || value.endsWith("\r\n") ? value : `${value}\n`;
}

function getNewline(value: string) {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNodeErrorCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
