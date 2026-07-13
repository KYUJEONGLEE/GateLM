import { TenantChatRuntimeController } from './tenant-chat-runtime.controller';

const snapshot = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  version: 12,
  digest: 'sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M',
  policyVersion: 8,
  employeeNoticeVersion: 3,
  pricing: { version: 5 },
};

describe('TenantChatRuntimeController', () => {
  it('returns only immutable execution metadata from the active snapshot', async () => {
    const service = { getActiveSnapshot: jest.fn().mockResolvedValue(snapshot) };
    const controller = new TenantChatRuntimeController(service as never);

    await expect(controller.activeSnapshot(snapshot.tenantId)).resolves.toEqual({
      data: {
        tenantId: snapshot.tenantId,
        version: 12,
        digest: snapshot.digest,
        policyVersion: 8,
        employeeNoticeVersion: 3,
        pricingVersion: 5,
      },
    });
  });

  it.each([
    ['missing', new Error('missing')],
    ['invalid', { ...snapshot, tenantId: '00000000-0000-4000-8000-000000000099' }],
  ])('fails closed when the active snapshot is %s', async (_, result) => {
    const getActiveSnapshot = result instanceof Error
      ? jest.fn().mockRejectedValue(result)
      : jest.fn().mockResolvedValue(result);
    const controller = new TenantChatRuntimeController({ getActiveSnapshot } as never);

    await expect(controller.activeSnapshot(snapshot.tenantId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CHAT_RUNTIME_UNAVAILABLE' }),
      status: 503,
    });
  });
});
