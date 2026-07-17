import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertCacheKeySetId,
  cacheKeySetIds,
  parseTenantChatCacheKeySets,
  readEnvValue,
} from './tenant-chat-cache-keyset.mjs';

export async function validateTenantChatCacheKeySet({ envFile, expectedId, keySetsFile }) {
  if (!keySetsFile) throw new Error('A Tenant Chat cache key-set file is required.');
  if (Boolean(envFile) === Boolean(expectedId)) {
    throw new Error('Provide exactly one of envFile or expectedId.');
  }
  const resolvedId = expectedId
    ? assertCacheKeySetId(expectedId, 'expected cache key-set ID')
    : assertCacheKeySetId(
        readEnvValue(await readFile(envFile, 'utf8'), 'TENANT_CHAT_CACHE_KEY_SET_ID'),
        'TENANT_CHAT_CACHE_KEY_SET_ID',
      );
  const document = parseTenantChatCacheKeySets(await readFile(keySetsFile, 'utf8'));
  if (!cacheKeySetIds(document).has(resolvedId)) {
    throw new Error(`Configured Tenant Chat cache key-set is unavailable: ${resolvedId}`);
  }
  return Object.freeze({
    expectedKeySetId: resolvedId,
    keySetCount: document.keySets.length,
    status: 'aligned',
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await validateTenantChatCacheKeySet(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseArguments(arguments_) {
  const values = new Map();
  for (const argument of arguments_) {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) throw new Error(`Invalid argument: ${argument}`);
    const key = argument.slice(2, separator);
    if (!['env-file', 'expected-id', 'keysets-file'].includes(key) || values.has(key)) {
      throw new Error(`Unsupported or duplicate argument: --${key}`);
    }
    values.set(key, argument.slice(separator + 1));
  }
  return {
    envFile: values.get('env-file'),
    expectedId: values.get('expected-id'),
    keySetsFile: values.get('keysets-file'),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Cache key-set validation failed.'}\n`);
    process.exitCode = 1;
  });
}
