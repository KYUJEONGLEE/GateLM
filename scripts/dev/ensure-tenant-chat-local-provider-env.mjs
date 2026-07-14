import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY_NAME = 'GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY';
const VERSION_NAME = 'GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION';

export async function ensureTenantChatLocalProviderEnv(options = {}) {
  const envFile = resolve(options.envFile ?? '.env.tenant-chat.local');
  const randomBytesImpl = options.randomBytesImpl ?? randomBytes;
  const source = await readFile(envFile, 'utf8');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const changed = [];

  const existingKey = readEnvValue(lines, KEY_NAME);
  if (existingKey && !isValidEncryptionKey(existingKey)) {
    throw new Error(`${KEY_NAME} must encode exactly 32 bytes.`);
  }
  if (!existingKey) {
    upsertEnvValue(lines, KEY_NAME, randomBytesImpl(32).toString('hex'));
    changed.push(KEY_NAME);
  }

  const existingVersion = readEnvValue(lines, VERSION_NAME);
  if (!existingVersion) {
    upsertEnvValue(lines, VERSION_NAME, 'v1');
    changed.push(VERSION_NAME);
  }

  if (changed.length > 0) {
    await writeFile(envFile, lines.join(eol), { encoding: 'utf8', mode: 0o600 });
  }

  return { envFile, changed, status: changed.length > 0 ? 'updated' : 'unchanged' };
}

function readEnvValue(lines, name) {
  const prefix = `${name}=`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim() ?? '';
}

function upsertEnvValue(lines, name, value) {
  const prefix = `${name}=`;
  const index = lines.findIndex((candidate) => candidate.startsWith(prefix));
  if (index >= 0) {
    lines[index] = `${prefix}${value}`;
    return;
  }
  const insertAt = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  lines.splice(insertAt, 0, `${prefix}${value}`);
}

function isValidEncryptionKey(raw) {
  if (/^(?:hex:)?[0-9a-f]{64}$/i.test(raw)) return true;
  const base64Value = raw.replace(/^base64:/i, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Value)) return false;
  const decoded = Buffer.from(base64Value, 'base64');
  return decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === base64Value.replace(/=+$/, '');
}

async function main() {
  const envFileArgument = process.argv.find((value) => value.startsWith('--env-file='));
  const result = await ensureTenantChatLocalProviderEnv({
    envFile: envFileArgument?.slice('--env-file='.length),
  });
  process.stdout.write(`${JSON.stringify({ status: result.status, changed: result.changed })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Local Provider environment setup failed.'}\n`);
    process.exitCode = 1;
  });
}
