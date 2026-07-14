import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function generateTenantChatLocalSecrets(options = {}) {
  const target = resolve(options.target ?? '.secrets/tenant-chat');
  const kid = options.kid ?? 'tenant-chat-local-1';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(kid)) throw new Error('kid must be an opaque ID.');
  const staging = join(dirname(target), `.tenant-chat-${randomUUID()}.tmp`);
  if (await exists(target)) {
    throw new Error(`Refusing to overwrite existing Tenant Chat secrets at ${target}.`);
  }
  await mkdir(dirname(target), { recursive: true });
  await mkdir(staging, { recursive: false });
  try {
    const pair = generateKeyPairSync('ed25519');
    const privateJwk = pair.privateKey.export({ format: 'jwk' });
    const bindingKey = randomBytes(32).toString('base64url');
    const files = new Map([
      ['signing.jwk.json', JSON.stringify({
        kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid,
        x: privateJwk.x, d: privateJwk.d,
      }, null, 2) + '\n'],
      ['jwks.json', JSON.stringify({
        keys: [{ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid, x: privateJwk.x }],
      }, null, 2) + '\n'],
      ['binding-hmac-keys.json', JSON.stringify({ keys: [{ kid, key: bindingKey }] }, null, 2) + '\n'],
      ['cache-keysets.json', JSON.stringify({
        keySets: [{
          keySetId: 'tenant-chat-local-cache-1',
          fingerprintKey: randomBytes(32).toString('base64url'),
          encryptionKey: randomBytes(32).toString('base64url'),
        }],
      }, null, 2) + '\n'],
      ['usage-receipt-token', randomBytes(48).toString('base64url') + '\n'],
    ]);
    for (const [name, contents] of files) {
      await writeFile(join(staging, name), contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    await rename(staging, target);
    return { target, kid, files: [...files.keys()] };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'EEXIST' || (error.code === 'EPERM' && await exists(target)))
    ) {
      throw new Error(`Refusing to overwrite existing Tenant Chat secrets at ${target}.`);
    }
    throw error;
  }
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
  const targetArgument = process.argv.find((value) => value.startsWith('--target='));
  const kidArgument = process.argv.find((value) => value.startsWith('--kid='));
  const result = await generateTenantChatLocalSecrets({
    target: targetArgument?.slice('--target='.length),
    kid: kidArgument?.slice('--kid='.length),
  });
  process.stdout.write(`${JSON.stringify({
    status: 'created',
    directory: result.target,
    kid: result.kid,
    files: result.files,
  })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Secret generation failed.'}\n`);
    process.exitCode = 1;
  });
}
