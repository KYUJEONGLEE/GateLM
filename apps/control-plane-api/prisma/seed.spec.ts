import { PrismaClient, RuntimeConfigPublishState } from '@prisma/client';

import {
  buildDemoRuntimeConfigDocument,
  canonicalJsonForDemo,
  credentialHash,
  DEMO_APPLICATION_ID,
  DEMO_RUNTIME_CONFIG_VERSION,
  seedDemoData,
} from './seed';

describe('Control Plane demo seed baseline', () => {
  it('builds a stable active Runtime Config for Gateway demo readiness', () => {
    const first = buildDemoRuntimeConfigDocument('provider-demo-id');
    const second = buildDemoRuntimeConfigDocument('provider-demo-id');

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe('gatelm.active-runtime-config.v1');
    expect(first.configVersion).toBe(DEMO_RUNTIME_CONFIG_VERSION);
    expect(first.publishState).toBe('active');
    expect(first.applicationId).toBe(DEMO_APPLICATION_ID);
    expect(first.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.safetyPolicy.securityPolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.routingPolicy.routingPolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.providers[0]?.models).toEqual([
      'mock-fast',
      'mock-balanced',
    ]);
    expect(first.rateLimit).toEqual({
      enabled: true,
      scope: 'application',
      algorithm: 'fixed_window',
      windowSeconds: 60,
      limit: 60,
    });
  });

  it('does not put raw credentials or hashes into the runtime config document', () => {
    const runtimeConfig = buildDemoRuntimeConfigDocument('provider-demo-id');
    const serialized = JSON.stringify(runtimeConfig);

    expect(serialized).not.toContain('secretHash');
    expect(serialized).not.toContain('plaintext');
    expect(serialized).not.toContain('authorizationHeader');
    expect(serialized).not.toContain('rawCredential');
    expect(serialized).not.toContain('demo_only');
  });

  it('hashes demo credentials after trimming surrounding whitespace', () => {
    expect(credentialHash('  synthetic_demo_secret  ')).toBe(
      credentialHash('synthetic_demo_secret'),
    );
  });

  it('canonicalizes undefined like JSON for arrays while omitting object fields', () => {
    expect(canonicalJsonForDemo({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJsonForDemo(['a', undefined, 'c'])).toBe(
      '["a",null,"c"]',
    );
  });

  it('supersedes older active runtime configs and upserts the demo active config', async () => {
    const tx = createMockTransaction();
    const client = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    await seedDemoData(client as unknown as PrismaClient);

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.runtimeConfig.updateMany).toHaveBeenCalledWith({
      where: {
        applicationId: DEMO_APPLICATION_ID,
        publishState: RuntimeConfigPublishState.ACTIVE,
        configVersion: { not: DEMO_RUNTIME_CONFIG_VERSION },
      },
      data: {
        publishState: RuntimeConfigPublishState.SUPERSEDED,
      },
    });
    expect(tx.runtimeConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationId_configVersion: {
            applicationId: DEMO_APPLICATION_ID,
            configVersion: DEMO_RUNTIME_CONFIG_VERSION,
          },
        },
        update: expect.objectContaining({
          publishState: RuntimeConfigPublishState.ACTIVE,
          document: expect.objectContaining({
            publishState: 'active',
            configVersion: DEMO_RUNTIME_CONFIG_VERSION,
          }),
        }),
        create: expect.objectContaining({
          applicationId: DEMO_APPLICATION_ID,
          publishState: RuntimeConfigPublishState.ACTIVE,
          document: expect.objectContaining({
            publishState: 'active',
            configVersion: DEMO_RUNTIME_CONFIG_VERSION,
          }),
        }),
      }),
    );
  });
});

function createMockTransaction() {
  return {
    tenant: { upsert: jest.fn() },
    project: { upsert: jest.fn() },
    application: { upsert: jest.fn() },
    providerConnection: {
      upsert: jest.fn().mockResolvedValue({ id: 'provider-demo-id' }),
    },
    gatewayApiKey: { upsert: jest.fn() },
    appToken: { upsert: jest.fn() },
    runtimeConfig: {
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
}
