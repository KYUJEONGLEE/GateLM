import { randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertCacheKeySetId,
  cacheKeySetIds,
  cloneCacheKeySetAlias,
  parseTenantChatCacheKeySets,
  readEnvValue,
  upsertEnvValue,
} from '../../../scripts/dev/tenant-chat-cache-keyset.mjs';

const ENV_NAME = 'TENANT_CHAT_CACHE_KEY_SET_ID';
const BACKUP_ID = /^\d{8}T\d{6}Z-[a-f0-9]{8}$/;

export async function inspectTenantChatCacheKeySet(options) {
  const normalized = normalizeOptions(options);
  await assertProtectedFile(normalized.envFile);
  await assertProtectedFile(normalized.keySetsFile);
  const envContents = await readFile(normalized.envFile, 'utf8');
  const configuredId = readEnvValue(envContents, ENV_NAME, { required: false });
  if (configuredId !== undefined) assertCacheKeySetId(configuredId, ENV_NAME);
  const document = parseTenantChatCacheKeySets(await readFile(normalized.keySetsFile, 'utf8'));
  const ids = cacheKeySetIds(document);
  if (!ids.has(normalized.canonicalId) && !ids.has(normalized.sourceId)) {
    throw new Error(`Neither canonical nor source Tenant Chat cache key-set is available.`);
  }
  const plannedIds = new Set(ids);
  if (!plannedIds.has(normalized.canonicalId)) plannedIds.add(normalized.canonicalId);
  for (const activeId of normalized.activeKeySetIds) {
    if (!plannedIds.has(activeId)) {
      throw new Error(`Active RuntimeSnapshot references an unavailable cache key-set: ${activeId}`);
    }
  }
  const envAction = configuredId === normalized.canonicalId
    ? 'none'
    : configuredId === undefined
      ? 'add'
      : 'replace';
  const keySetAction = ids.has(normalized.canonicalId) ? 'none' : 'add_alias';
  return Object.freeze({
    activeKeySetIds: [...normalized.activeKeySetIds].sort(),
    canonicalKeySetId: normalized.canonicalId,
    changed: envAction !== 'none' || keySetAction !== 'none',
    envAction,
    keySetAction,
    sourceKeySetId: normalized.sourceId,
    status: envAction === 'none' && keySetAction === 'none' ? 'aligned' : 'changes_required',
  });
}

export async function applyTenantChatCacheKeySetReconciliation(options) {
  const normalized = normalizeOptions(options);
  const inspection = await inspectTenantChatCacheKeySet(normalized);
  if (!inspection.changed) {
    return Object.freeze({ ...inspection, backupId: null, mode: 'apply', status: 'aligned' });
  }

  const backupId = options.backupId ?? createBackupId();
  if (!BACKUP_ID.test(backupId)) throw new Error('Invalid Tenant Chat cache key-set backup ID.');
  const backupDirectory = join(normalized.backupRoot, backupId);
  await mkdir(normalized.backupRoot, { recursive: true, mode: 0o700 });
  await chmod(normalized.backupRoot, 0o700);
  await mkdir(backupDirectory, { recursive: false, mode: 0o700 });
  await copyProtected(normalized.envFile, join(backupDirectory, 'aws-triage.env'));
  await copyProtected(normalized.keySetsFile, join(backupDirectory, 'cache-keysets.json'));
  await writeFile(
    join(backupDirectory, 'manifest.json'),
    `${JSON.stringify({
      backupId,
      canonicalKeySetId: normalized.canonicalId,
      createdAt: new Date().toISOString(),
      sourceKeySetId: normalized.sourceId,
    }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );

  try {
    const currentDocument = parseTenantChatCacheKeySets(
      await readFile(normalized.keySetsFile, 'utf8'),
    );
    const alias = cloneCacheKeySetAlias(
      currentDocument,
      normalized.sourceId,
      normalized.canonicalId,
    );
    if (alias.changed) {
      await atomicWrite(
        normalized.keySetsFile,
        `${JSON.stringify(alias.document, null, 2)}\n`,
      );
    }
    const envContents = await readFile(normalized.envFile, 'utf8');
    await atomicWrite(
      normalized.envFile,
      upsertEnvValue(envContents, ENV_NAME, normalized.canonicalId),
    );
    const verified = await inspectTenantChatCacheKeySet(normalized);
    if (verified.changed || verified.status !== 'aligned') {
      throw new Error('Tenant Chat cache key-set reconciliation did not converge.');
    }
  } catch (error) {
    await restoreBackup(normalized, backupDirectory);
    throw error;
  }

  return Object.freeze({
    ...inspection,
    backupId,
    changed: true,
    mode: 'apply',
    status: 'aligned',
  });
}

export async function rollbackTenantChatCacheKeySetReconciliation(options) {
  const normalized = normalizeOptions(options);
  const backupId = options.backupId;
  if (typeof backupId !== 'string' || !BACKUP_ID.test(backupId)) {
    throw new Error('A valid Tenant Chat cache key-set backup ID is required for rollback.');
  }
  const backupDirectory = join(normalized.backupRoot, backupId);
  const manifest = JSON.parse(await readFile(join(backupDirectory, 'manifest.json'), 'utf8'));
  if (
    manifest?.backupId !== backupId ||
    manifest?.canonicalKeySetId !== normalized.canonicalId ||
    manifest?.sourceKeySetId !== normalized.sourceId
  ) {
    throw new Error('Tenant Chat cache key-set backup manifest does not match this rollback.');
  }
  const currentDocument = parseTenantChatCacheKeySets(
    await readFile(normalized.keySetsFile, 'utf8'),
  );
  if (!cacheKeySetIds(currentDocument).has(normalized.canonicalId)) {
    throw new Error('Compatibility rollback requires the canonical cache key-set alias to remain available.');
  }
  const backupEnv = await readFile(join(backupDirectory, 'aws-triage.env'), 'utf8');
  const previousId = readEnvValue(backupEnv, ENV_NAME, { required: false });
  if (previousId !== undefined) {
    assertCacheKeySetId(previousId, `backup ${ENV_NAME}`);
    if (!cacheKeySetIds(currentDocument).has(previousId)) {
      throw new Error('Backup environment references a cache key-set that is not currently available.');
    }
  }
  const currentEnv = await readFile(normalized.envFile, 'utf8');
  await atomicWrite(
    normalized.envFile,
    upsertEnvValue(currentEnv, ENV_NAME, previousId ?? normalized.canonicalId),
  );
  return Object.freeze({
    backupId,
    canonicalKeySetId: normalized.canonicalId,
    changed: true,
    mode: 'rollback',
    sourceKeySetId: normalized.sourceId,
    status: 'compatibility_preserved',
  });
}

async function restoreBackup(options, backupDirectory) {
  await atomicWrite(
    options.keySetsFile,
    await readFile(join(backupDirectory, 'cache-keysets.json'), 'utf8'),
  );
  await atomicWrite(
    options.envFile,
    await readFile(join(backupDirectory, 'aws-triage.env'), 'utf8'),
  );
}

async function copyProtected(source, target) {
  await copyFile(source, target);
  await chmod(target, 0o600);
}

async function atomicWrite(target, contents) {
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function assertProtectedFile(path) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Protected Tenant Chat file must be a regular non-symlink: ${path}`);
  }
  if (process.platform !== 'win32' && (details.mode & 0o077) !== 0) {
    throw new Error(`Protected Tenant Chat file permissions are too open: ${path}`);
  }
}

function normalizeOptions(options) {
  const canonicalId = assertCacheKeySetId(options.canonicalId, 'canonical cache key-set ID');
  const sourceId = assertCacheKeySetId(options.sourceId, 'source cache key-set ID');
  if (canonicalId === sourceId) throw new Error('Canonical and source cache key-set IDs must differ.');
  if (!options.envFile || !options.keySetsFile || !options.backupRoot) {
    throw new Error('envFile, keySetsFile, and backupRoot are required.');
  }
  const activeKeySetIds = new Set(
    Array.from(options.activeKeySetIds ?? []).filter(Boolean).map((value) =>
      assertCacheKeySetId(value, 'active RuntimeSnapshot cache key-set ID')),
  );
  return {
    activeKeySetIds,
    backupRoot: resolve(options.backupRoot),
    canonicalId,
    envFile: resolve(options.envFile),
    keySetsFile: resolve(options.keySetsFile),
    sourceId,
  };
}

function createBackupId() {
  const timestamp = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15) + 'Z';
  return `${timestamp}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
}

async function readActiveKeySetIds(path) {
  if (!path) return [];
  return (await readFile(path, 'utf8'))
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const options = {
    activeKeySetIds: await readActiveKeySetIds(arguments_.activeKeySetIdsFile),
    backupId: arguments_.backupId,
    backupRoot: arguments_.backupRoot,
    canonicalId: arguments_.canonicalId,
    envFile: arguments_.envFile,
    keySetsFile: arguments_.keySetsFile,
    sourceId: arguments_.sourceId,
  };
  const result = arguments_.mode === 'check'
    ? { ...(await inspectTenantChatCacheKeySet(options)), backupId: null, mode: 'check' }
    : arguments_.mode === 'apply'
      ? await applyTenantChatCacheKeySetReconciliation(options)
      : await rollbackTenantChatCacheKeySetReconciliation(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseArguments(arguments_) {
  const supported = new Set([
    'active-key-set-ids-file',
    'backup-id',
    'backup-root',
    'canonical-id',
    'env-file',
    'keysets-file',
    'mode',
    'source-id',
  ]);
  const values = new Map();
  for (const argument of arguments_) {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) throw new Error(`Invalid argument: ${argument}`);
    const key = argument.slice(2, separator);
    if (!supported.has(key) || values.has(key)) throw new Error(`Unsupported or duplicate argument: --${key}`);
    values.set(key, argument.slice(separator + 1));
  }
  const mode = values.get('mode');
  if (!['check', 'apply', 'rollback'].includes(mode)) throw new Error('mode must be check, apply, or rollback.');
  return {
    activeKeySetIdsFile: values.get('active-key-set-ids-file'),
    backupId: values.get('backup-id'),
    backupRoot: values.get('backup-root'),
    canonicalId: values.get('canonical-id'),
    envFile: values.get('env-file'),
    keySetsFile: values.get('keysets-file'),
    mode,
    sourceId: values.get('source-id'),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Cache key-set reconciliation failed.'}\n`);
    process.exitCode = 1;
  });
}
