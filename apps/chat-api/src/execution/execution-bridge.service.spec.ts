import { ExecutionBridgeService } from './execution-bridge.service';

describe('ExecutionBridgeService', () => {
  const actor = {
    actorAuthzVersion: 4,
    actorKind: 'employee' as const,
    employeeId: 'employee_001',
    sessionId: 'session_001',
    sessionVersion: 2,
    tenantAuthzVersion: 7,
    tenantId: 'tenant_001',
    userId: 'user_001',
  };
  const runtime = {
    tenantId: actor.tenantId,
    version: 12,
    digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    policyVersion: 8,
    employeeNoticeVersion: 3,
    pricingVersion: 5,
  };

  it('pins authoritative authorization and snapshot without retaining the access JWT', async () => {
    const sessions = { authorizeExecution: jest.fn().mockResolvedValue(actor) };
    const controlPlane = { activeRuntimeSnapshot: jest.fn().mockResolvedValue(runtime) };
    const gateway = {
      isConfigured: jest.fn().mockReturnValue(true),
      admit: jest.fn(async (seed) => ({ ...seed, admissionId: 'admission_001', expiresAt: '2026-07-14T00:00:30Z' })),
    };
    const credentials = { isReady: jest.fn().mockResolvedValue(true) };
    const bridge = new ExecutionBridgeService(sessions as never, controlPlane as never, gateway as never, credentials as never);

    const handle = await bridge.authorizeAndAdmit('sensitive-access-jwt');
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(handle.executionScope.actor)).toBe(true);
    expect(JSON.stringify(handle)).not.toContain('sensitive-access-jwt');
    expect(handle).toMatchObject({
      actorAuthzVersion: 4,
      tenantAuthzVersion: 7,
      sessionVersion: 2,
      snapshot: {
        version: runtime.version,
        digest: runtime.digest,
        policyVersion: runtime.policyVersion,
        employeeNoticeVersion: runtime.employeeNoticeVersion,
        pricingVersion: runtime.pricingVersion,
      },
    });
    expect(handle.requestId).not.toBe(handle.turnId);
    expect(handle.idempotencyKey).not.toBe(handle.requestId);
  });

  it('preserves store-reserved logical identities at the Gateway boundary', async () => {
    const gateway = {
      isConfigured: () => true,
      admit: jest.fn(async (seed) => ({ ...seed, admissionId: 'admission_001', expiresAt: '2026-07-14T00:00:30Z' })),
    };
    const bridge = new ExecutionBridgeService(
      {} as never,
      { activeRuntimeSnapshot: async () => runtime } as never,
      gateway as never,
      { isReady: async () => true } as never,
    );
    const identity = { requestId: 'request-stable', turnId: 'turn-stable', idempotencyKey: 'idem-stable' };
    const handle = await bridge.admitAuthorized(actor, identity);
    expect(handle).toMatchObject(identity);
    expect(gateway.admit).toHaveBeenCalledWith(expect.objectContaining(identity));
  });

  it('closes authorization before entitlement work when signing configuration is unavailable', async () => {
    const sessions = { authorizeExecution: jest.fn() };
    const bridge = new ExecutionBridgeService(
      sessions as never,
      {} as never,
      { isConfigured: () => true } as never,
      { isReady: async () => false } as never,
    );
    await expect(bridge.authorizeAndAdmit('token')).rejects.toMatchObject({ status: 503 });
    expect(sessions.authorizeExecution).not.toHaveBeenCalled();
  });

  it('best-effort cancels an admitted turn when completion is aborted', async () => {
    const gateway = {
      isConfigured: () => true,
      admit: jest.fn(async (seed) => ({ ...seed, admissionId: 'admission_001', expiresAt: '2026-07-14T00:00:30Z' })),
      complete: jest.fn().mockRejectedValue(new Error('aborted')),
      cancel: jest.fn().mockResolvedValue({ state: 'cancelled' }),
    };
    const bridge = new ExecutionBridgeService(
      { authorizeExecution: async () => actor } as never,
      { activeRuntimeSnapshot: async () => runtime } as never,
      gateway as never,
      { isReady: async () => true } as never,
    );
    const handle = await bridge.authorizeAndAdmit('token');
    const controller = new AbortController();
    controller.abort();
    await expect(bridge.complete(
      handle,
      { messages: [{ role: 'user', content: '<synthetic>' }], stream: true },
      { estimatedInputTokens: 1, maxOutputTokens: 2, requestedTier: 'auto', cacheStrategy: 'off' },
      { signal: controller.signal },
    )).rejects.toThrow('aborted');
    expect(gateway.cancel).toHaveBeenCalledWith(handle);
  });
});
