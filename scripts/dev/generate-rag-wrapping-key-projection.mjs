import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_KEY_FILE_BYTES = 64 * 1024;

export async function generateRagWrappingKeyProjection(options = {}) {
  const input = resolve(
    options.input ?? '.secrets/tenant-chat/content-keys.json',
  );
  const target = resolve(
    options.target ?? '.secrets/rag/content-wrapping-keys.json',
  );
  if (await exists(target)) {
    throw new Error(`Refusing to overwrite existing RAG wrapping keys at ${target}.`);
  }

  const source = await readFile(input);
  try {
    if (source.length < 2 || source.length > MAX_KEY_FILE_BYTES) {
      throw new Error('Tenant Chat content key file is invalid.');
    }
    const combined = JSON.parse(source.toString('utf8'));
    const projection = projectWrappingKeys(combined);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = join(
      dirname(target),
      `.content-wrapping-keys-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, `${JSON.stringify(projection, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return { input, target };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Tenant Chat content key file is invalid.');
    }
    throw error;
  } finally {
    source.fill(0);
  }
}

function projectWrappingKeys(value) {
  if (
    !exactObject(value, ['activeVersion', 'keys', 'schemaVersion']) ||
    value.schemaVersion !== 1 ||
    !positiveInteger(value.activeVersion) ||
    !Array.isArray(value.keys) ||
    value.keys.length < 1 ||
    value.keys.length > 8
  ) {
    throw new Error('Tenant Chat content key file is invalid.');
  }
  const versions = new Set();
  const keys = value.keys.map((key) => {
    if (
      !exactObject(key, ['integrityKey', 'version', 'wrappingKey']) ||
      !positiveInteger(key.version) ||
      versions.has(key.version) ||
      !canonicalKey(key.wrappingKey) ||
      !canonicalKey(key.integrityKey)
    ) {
      throw new Error('Tenant Chat content key file is invalid.');
    }
    versions.add(key.version);
    return { version: key.version, wrappingKey: key.wrappingKey };
  });
  if (!versions.has(value.activeVersion)) {
    throw new Error('Tenant Chat content key file is invalid.');
  }
  return { schemaVersion: 1, activeVersion: value.activeVersion, keys };
}

function canonicalKey(value) {
  const decoded =
    typeof value === 'string' ? Buffer.from(value, 'base64url') : Buffer.alloc(0);
  try {
    return (
      typeof value === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(value) &&
      decoded.length === 32 &&
      decoded.toString('base64url') === value
    );
  } finally {
    decoded.fill(0);
  }
}

function exactObject(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1 && value <= 2_147_483_647;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const input = process.argv.find((value) => value.startsWith('--input='));
  const target = process.argv.find((value) => value.startsWith('--target='));
  const result = await generateRagWrappingKeyProjection({
    input: input?.slice('--input='.length),
    target: target?.slice('--target='.length),
  });
  process.stdout.write(
    `${JSON.stringify({ status: 'created', file: result.target })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'RAG wrapping key projection failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
