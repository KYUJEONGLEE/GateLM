const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

export const LOCAL_TENANT_CHAT_CACHE_KEY_SET_ID = 'tenant-chat-local-cache-1';
export const PRODUCTION_TENANT_CHAT_CACHE_KEY_SET_ID = 'tenant_chat_cache_keys_v1';

export function assertCacheKeySetId(value, label = 'cache key-set ID') {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    throw new Error(`${label} must be a bounded opaque identifier.`);
  }
  return value;
}

export function parseTenantChatCacheKeySets(contents) {
  let document;
  try {
    document = JSON.parse(contents);
  } catch {
    throw new Error('Tenant Chat cache key-set file must contain valid JSON.');
  }
  if (!isRecord(document) || !hasExactKeys(document, ['keySets']) || !Array.isArray(document.keySets) || document.keySets.length === 0) {
    throw new Error('Tenant Chat cache key-set file must contain a non-empty keySets array.');
  }

  const ids = new Set();
  for (const entry of document.keySets) {
    if (!isRecord(entry) || !hasExactKeys(entry, ['encryptionKey', 'fingerprintKey', 'keySetId'])) {
      throw new Error('Tenant Chat cache key-set entries must use the exact supported shape.');
    }
    const id = assertCacheKeySetId(entry.keySetId);
    if (ids.has(id)) throw new Error(`Tenant Chat cache key-set ID is duplicated: ${id}`);
    ids.add(id);
    assertBase64UrlKey(entry.fingerprintKey, 'fingerprintKey');
    assertBase64UrlKey(entry.encryptionKey, 'encryptionKey');
  }
  return document;
}

export function readEnvValue(contents, name, { required = true } = {}) {
  const assignments = [];
  for (const line of String(contents).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] !== name) continue;
    assignments.push(unquote(match[2]));
  }
  if (assignments.length > 1) throw new Error(`${name} must be assigned exactly once.`);
  if (assignments.length === 0) {
    if (required) throw new Error(`${name} is required.`);
    return undefined;
  }
  return assignments[0];
}

export function upsertEnvValue(contents, name, value) {
  assertCacheKeySetId(value, name);
  const newline = String(contents).includes('\r\n') ? '\r\n' : '\n';
  const lines = String(contents).split(/\r?\n/);
  let matched = false;
  const updated = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || match[1] !== name) return line;
    if (matched) throw new Error(`${name} must be assigned at most once before reconciliation.`);
    matched = true;
    return `${name}=${value}`;
  });
  if (!matched) {
    while (updated.length > 0 && updated.at(-1) === '') updated.pop();
    updated.push(`${name}=${value}`, '');
  }
  return updated.join(newline);
}

export function cacheKeySetIds(document) {
  return new Set(document.keySets.map((entry) => entry.keySetId));
}

export function cloneCacheKeySetAlias(document, sourceId, targetId) {
  assertCacheKeySetId(sourceId, 'source cache key-set ID');
  assertCacheKeySetId(targetId, 'target cache key-set ID');
  const ids = cacheKeySetIds(document);
  if (ids.has(targetId)) return { changed: false, document };
  const source = document.keySets.find((entry) => entry.keySetId === sourceId);
  if (!source) throw new Error(`Source Tenant Chat cache key-set is unavailable: ${sourceId}`);
  return {
    changed: true,
    document: {
      keySets: [...document.keySets, { ...source, keySetId: targetId }],
    },
  };
}

function assertBase64UrlKey(value, label) {
  if (typeof value !== 'string' || !BASE64URL_32_BYTES.test(value)) {
    throw new Error(`Tenant Chat ${label} must be an unpadded 32-byte base64url value.`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== value) {
    throw new Error(`Tenant Chat ${label} must be an unpadded 32-byte base64url value.`);
  }
}

function unquote(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}
