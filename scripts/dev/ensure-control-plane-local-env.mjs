import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONTROL_PLANE_AUTH_STATE_SECRET =
  'CONTROL_PLANE_AUTH_STATE_SECRET';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, '..', '..');
const knownPlaceholders = new Set([
  'change-me',
  'changeme',
  'placeholder',
  'replace-me',
  'replace-me-with-random-value',
]);
const productionDeploymentNames = new Set([
  'aws',
  'aws-triage',
  'prod',
  'production',
  'release',
  'selfhost',
  'stage',
  'staging',
]);
const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

export function ensureControlPlaneLocalEnv(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const rootEnvPath =
    options.rootEnvPath ?? path.join(repoRoot, '.env');
  const appEnvPath =
    options.appEnvPath ?? path.join(repoRoot, 'apps', 'control-plane-api', '.env');
  const exampleEnvPath =
    options.exampleEnvPath ?? path.join(repoRoot, '.env.example');
  const processEnv = options.processEnv ?? process.env;
  const generateSecret =
    options.generateSecret ?? (() => randomBytes(32).toString('base64url'));
  const logger = options.logger ?? ((message) => console.log(message));
  const rootContent = readOptionalFile(rootEnvPath);
  const appContent = readOptionalFile(appEnvPath);
  const effectiveEnvironment = {
    ...parseEnvFile(rootContent),
    ...parseEnvFile(appContent),
    ...processEnv,
  };

  if (isProductionLikeEnvironment(effectiveEnvironment)) {
    throw new Error(
      'Local Control Plane environment bootstrap is disabled in production-like environments.',
    );
  }

  const processHasSecret = Object.prototype.hasOwnProperty.call(
    processEnv,
    CONTROL_PLANE_AUTH_STATE_SECRET,
  );
  if (processHasSecret) {
    const processSecret = normalizeEnvValue(
      processEnv[CONTROL_PLANE_AUTH_STATE_SECRET],
    );
    if (!isUsableSecret(processSecret)) {
      throw new Error(
        `${CONTROL_PLANE_AUTH_STATE_SECRET} in the process environment is missing, weak, or a placeholder. Unset it or replace it with a persistent random value of at least 32 characters.`,
      );
    }

    logger('[env] Control Plane auth state secret supplied by process environment.');
    return { changed: false, source: 'process' };
  }

  const appAssignments = findActiveAssignments(
    appContent,
    CONTROL_PLANE_AUTH_STATE_SECRET,
  );
  assertNoDuplicateAssignments(appAssignments, 'apps/control-plane-api/.env');
  if (appAssignments.length === 1) {
    const appSecret = parseEnvFileValue(appAssignments[0].value);
    if (!isUsableSecret(appSecret)) {
      throw new Error(
        `${CONTROL_PLANE_AUTH_STATE_SECRET} in apps/control-plane-api/.env is missing, weak, or a placeholder. Replace it with a persistent random value of at least 32 characters, or remove it to use the repository .env bootstrap.`,
      );
    }

    logger(
      '[env] Control Plane auth state secret supplied by apps/control-plane-api/.env.',
    );
    return { changed: false, source: 'app-env' };
  }

  mkdirSync(path.dirname(rootEnvPath), { recursive: true });
  const releaseLock = acquireFileLock(`${rootEnvPath}.control-plane-bootstrap.lock`);

  try {
    let currentContent = readOptionalFile(rootEnvPath);
    if (currentContent === undefined) {
      if (!existsSync(exampleEnvPath)) {
        throw new Error(
          `Repository .env and .env.example were not found. Create the local environment file before starting the Control Plane.`,
        );
      }
      currentContent = readFileSync(exampleEnvPath, 'utf8');
    }

    const rootAssignments = findActiveAssignments(
      currentContent,
      CONTROL_PLANE_AUTH_STATE_SECRET,
    );
    assertNoDuplicateAssignments(rootAssignments, '.env');

    if (rootAssignments.length === 1) {
      const existingSecret = parseEnvFileValue(rootAssignments[0].value);
      if (isUsableSecret(existingSecret)) {
        logger('[env] Control Plane auth state secret already exists in repository .env.');
        return { changed: false, source: 'root-env' };
      }
      if (existingSecret && !isKnownPlaceholder(existingSecret)) {
        throw new Error(
          `${CONTROL_PLANE_AUTH_STATE_SECRET} in the repository .env is too weak. Replace it once with a persistent random value of at least 32 characters.`,
        );
      }
    }

    const secret = generateSecret();
    if (!isGeneratedSecretValid(secret)) {
      throw new Error(
        'Generated Control Plane auth state secret did not meet the local security requirements.',
      );
    }

    const nextContent = upsertEnvAssignment(
      currentContent,
      CONTROL_PLANE_AUTH_STATE_SECRET,
      secret,
    );
    writeFileAtomically(rootEnvPath, nextContent);
    logger('[env] Generated a persistent local Control Plane auth state secret.');
    return { changed: true, source: 'root-env' };
  } finally {
    releaseLock();
  }
}

export function isProductionLikeEnvironment(environment) {
  if (environment.NODE_ENV === 'production') {
    return true;
  }
  if (
    environment.AWS_EXECUTION_ENV ||
    environment.ECS_CONTAINER_METADATA_URI ||
    environment.ECS_CONTAINER_METADATA_URI_V4
  ) {
    return true;
  }

  const deploymentName = normalizeEnvValue(
    environment.GATELM_DEPLOYMENT_ENV ??
      environment.CONTROL_PLANE_DEPLOYMENT_ENV ??
      environment.DEPLOYMENT_ENV ??
      environment.APP_ENV,
  )?.toLowerCase();
  return Boolean(
    deploymentName && productionDeploymentNames.has(deploymentName),
  );
}

function readOptionalFile(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined;
}

function parseEnvFile(content) {
  if (content === undefined) {
    return {};
  }

  const parsed = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^[^\S\r\n]*(?:export[\t ]+)?([A-Za-z_][A-Za-z0-9_]*)[^\S\r\n]*=[^\S\r\n]*(.*)[^\S\r\n]*$/.exec(
      line,
    );
    if (match) {
      parsed[match[1]] = parseEnvFileValue(match[2]) ?? '';
    }
  }
  return parsed;
}

function findActiveAssignments(content, key) {
  if (content === undefined) {
    return [];
  }

  const escapedKey = escapeRegularExpression(key);
  const expression = new RegExp(
    `^[^\\S\\r\\n]*(?:export[\\t ]+)?${escapedKey}[^\\S\\r\\n]*=[^\\S\\r\\n]*([^\\r\\n]*)$`,
    'gm',
  );
  return Array.from(content.matchAll(expression), (match) => ({
    fullMatch: match[0],
    index: match.index,
    value: match[1],
  }));
}

function assertNoDuplicateAssignments(assignments, sourceName) {
  if (assignments.length > 1) {
    throw new Error(
      `${CONTROL_PLANE_AUTH_STATE_SECRET} is assigned more than once in ${sourceName}. Remove the duplicate assignments before starting the Control Plane.`,
    );
  }
}

function normalizeEnvValue(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('`') && normalized.endsWith('`')))
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

function isUsableSecret(value) {
  return Boolean(
    value &&
      value.length >= 32 &&
      !isKnownPlaceholder(value),
  );
}

function isKnownPlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    knownPlaceholders.has(normalized) ||
    normalized.startsWith('replace-me-')
  );
}

function parseEnvFileValue(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const original = value.trim();
  const openingQuote = original[0];
  if (openingQuote === '"' || openingQuote === "'" || openingQuote === '`') {
    for (let index = 1; index < original.length; index += 1) {
      if (original[index] === openingQuote && original[index - 1] !== '\\') {
        return original.slice(1, index);
      }
    }
  }

  const commentIndex = original.indexOf('#');
  return (commentIndex >= 0
    ? original.slice(0, commentIndex)
    : original
  ).trim();
}

function isGeneratedSecretValid(value) {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    isUsableSecret(value)
  );
}

function upsertEnvAssignment(content, key, value) {
  const assignments = findActiveAssignments(content, key);
  if (assignments.length === 1) {
    return `${content.slice(0, assignments[0].index)}${key}=${value}${content.slice(
      assignments[0].index + assignments[0].fullMatch.length,
    )}`;
  }

  if (content.length === 0) {
    return `${key}=${value}\n`;
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingNewline = content.endsWith('\n');
  return hasTrailingNewline
    ? `${content}${key}=${value}${newline}`
    : `${content}${newline}${key}=${value}`;
}

function writeFileAtomically(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, filePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function acquireFileLock(lockPath) {
  let descriptor;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      if (removeStaleLock(lockPath)) {
        continue;
      }
      Atomics.wait(lockWaitBuffer, 0, 0, 50);
    }
  }

  if (descriptor === undefined) {
    throw new Error(
      'Timed out waiting for another local environment bootstrap process.',
    );
  }

  try {
    writeFileSync(
      descriptor,
      JSON.stringify({ createdAt: new Date().toISOString(), pid: process.pid }),
      'utf8',
    );
  } catch (error) {
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
    throw error;
  }

  return () => {
    closeSync(descriptor);
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  };
}

function removeStaleLock(lockPath) {
  try {
    const metadata = JSON.parse(readFileSync(lockPath, 'utf8'));
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    const processIsAlive = Number.isInteger(metadata?.pid)
      ? isProcessAlive(metadata.pid)
      : true;
    if (!processIsAlive || ageMs > 120_000) {
      unlinkSync(lockPath);
      return true;
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return true;
    }
    try {
      const ageMs = Date.now() - statSync(lockPath).mtimeMs;
      if (ageMs > 120_000) {
        unlinkSync(lockPath);
        return true;
      }
    } catch (nestedError) {
      return nestedError?.code === 'ENOENT';
    }
  }

  return false;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--repo-root' && value) {
      options.repoRoot = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return options;
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (entryPoint === import.meta.url) {
  try {
    ensureControlPlaneLocalEnv(parseCliArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(
      `[env] Control Plane local environment bootstrap failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    process.exitCode = 1;
  }
}
