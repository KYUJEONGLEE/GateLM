import { ConfigService } from '@nestjs/config';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { AdmissionSeed, CompletionInput, UsageIntent } from './execution.types';
import { WorkloadCredentialsService } from './workload-credentials';
import { WorkloadSigner } from './workload-signer';

const seed: AdmissionSeed = {
  requestId: 'request_fixture_001',
  turnId: 'turn_fixture_001',
  idempotencyKey: 'turn_fixture_001_attempt_1',
  actorAuthzVersion: 4,
  tenantAuthzVersion: 7,
  sessionVersion: 2,
  executionScope: {
    kind: 'tenant_chat',
    tenantId: 'tenant_fixture_001',
    actor: {
      userId: 'user_fixture_001',
      actorKind: 'employee',
      employeeId: 'employee_fixture_001',
    },
    quotaScope: { type: 'user', id: 'user_fixture_001' },
    budgetScope: { type: 'tenant', id: 'tenant_fixture_001' },
  },
  snapshot: {
    version: 12,
    digest: 'sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M',
    policyVersion: 8,
    employeeNoticeVersion: 3,
    pricingVersion: 5,
  },
};

describe('WorkloadSigner', () => {
  let directory: string;
  let privateJwkFile: string;
  let bindingFile: string;
  let publicKey: ReturnType<typeof createPublicKey>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gatelm-workload-'));
    privateJwkFile = join(directory, 'signing.jwk.json');
    bindingFile = join(directory, 'binding.json');
    const pair = generateKeyPairSync('ed25519');
    publicKey = createPublicKey(pair.privateKey);
    const privateJwk = pair.privateKey.export({ format: 'jwk' });
    await writeFile(privateJwkFile, JSON.stringify({
      kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid: 'local-kid',
      x: privateJwk.x, d: privateJwk.d,
    }), { encoding: 'utf8' });
    await writeFile(bindingFile, JSON.stringify({
      keys: [{ kid: 'local-kid', key: Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString('base64url') }],
    }), { encoding: 'utf8' });
  });

  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it('matches all active binding vectors', async () => {
    const vectors = JSON.parse(await readFile(
      resolve(__dirname, '../../../../docs/tenant-chat/vectors/binding-digest-vectors.json'),
      'utf8',
    )) as { vectors: Array<{ bindingObject: { phase: string }; expectedBindingDigest: string }> };
    const signer = createSigner(privateJwkFile, bindingFile);
    const input: CompletionInput = {
      messages: [{ role: 'user', content: '<ephemeral>' }],
      stream: true,
    };
    const usageIntent: UsageIntent = {
      estimatedInputTokens: 640,
      maxOutputTokens: 1024,
      requestedTier: 'standard',
      cacheStrategy: 'exact',
    };
    for (const vector of vectors.vectors) {
      const phase = vector.bindingObject.phase as 'admission' | 'completion' | 'cancel';
      const result = await signer.authorize(
        seed,
        phase,
        phase === 'completion' ? input : undefined,
        phase === 'admission' ? undefined : 'admission_fixture_001',
        phase === 'completion' ? usageIntent : undefined,
      );
      expect(result.context.bindingDigest).toBe(vector.expectedBindingDigest);
    }
  });

  it('mints a fresh signed JTI while execution IDs remain stable', async () => {
    const signer = createSigner(privateJwkFile, bindingFile);
    const first = await signer.authorize(seed, 'admission');
    const second = await signer.authorize(seed, 'admission');
    const firstToken = parseToken(first.token);
    const secondToken = parseToken(second.token);

    expect(first.jti).not.toBe(second.jti);
    expect(firstToken.payload).toMatchObject({
      aud: 'gatelm-gateway-tenant-chat',
      phase: 'admission',
      requestId: seed.requestId,
      turnId: seed.turnId,
      idempotencyKey: seed.idempotencyKey,
    });
    expect(firstToken.payload.exp - firstToken.payload.iat).toBe(30);
    expect(firstToken.payload.nbf).toBe(firstToken.payload.iat - 5);
    expect(verify(null, Buffer.from(firstToken.signingInput), publicKey, firstToken.signature)).toBe(true);
  });

  it('fails closed for a missing active kid binding', async () => {
    const credentials = new WorkloadCredentialsService({
      get: (key: string) => key === 'TENANT_CHAT_WORKLOAD_ACTIVE_KID'
        ? 'wrong-kid'
        : key === 'TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE'
          ? privateJwkFile
          : bindingFile,
    } as ConfigService);
    await expect(credentials.load()).rejects.toMatchObject({ name: 'ExecutionConfigurationUnavailable' });
    await expect(credentials.isReady()).resolves.toBe(false);
  });
});

function createSigner(privateFile: string, hmacFile: string): WorkloadSigner {
  const config = {
    get: (key: string) => ({
      TENANT_CHAT_WORKLOAD_ACTIVE_KID: 'local-kid',
      TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE: privateFile,
      TENANT_CHAT_BINDING_HMAC_KEYS_FILE: hmacFile,
    })[key as 'TENANT_CHAT_WORKLOAD_ACTIVE_KID'],
  } as ConfigService;
  return new WorkloadSigner(new WorkloadCredentialsService(config));
}

function parseToken(token: string) {
  const [header, payload, signature] = token.split('.');
  return {
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, any>,
    signature: Buffer.from(signature, 'base64url'),
    signingInput: `${header}.${payload}`,
  };
}
