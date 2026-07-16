import { TenantChatAdminRuntimeController } from './tenant-chat-admin-runtime.controller';
import { TenantChatRuntimeService } from './tenant-chat-runtime.service';

describe('TenantChatAdminRuntimeController', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const providerConnectionId = '00000000-0000-4000-8000-000000000601';
  const publishedBy = '00000000-0000-4000-8000-000000000900';
  const setup = {
    readiness: 'needs_activation' as const,
    providers: [],
    activeSnapshot: null,
  };

  it('returns the safe setup envelope', async () => {
    const service = {
      getAdminRuntimeSetup: jest.fn().mockResolvedValue(setup),
    };
    const controller = new TenantChatAdminRuntimeController(
      service as unknown as TenantChatRuntimeService,
    );

    await expect(controller.getSetup(tenantId)).resolves.toEqual({ data: setup });
    expect(service.getAdminRuntimeSetup).toHaveBeenCalledWith(tenantId);
  });

  it('uses only the authenticated publisher and bounded activation input', async () => {
    const service = {
      activateAdminRuntime: jest.fn().mockResolvedValue(setup),
    };
    const controller = new TenantChatAdminRuntimeController(
      service as unknown as TenantChatRuntimeService,
    );

    await expect(
      controller.activate(
        tenantId,
        {
          providerConnectionId,
          modelKey: 'gpt-5.4-mini',
          cacheEnabled: true,
        },
        publishedBy,
      ),
    ).resolves.toEqual({ data: setup });
    expect(service.activateAdminRuntime).toHaveBeenCalledWith({
      tenantId,
      providerConnectionId,
      modelKey: 'gpt-5.4-mini',
      cacheEnabled: true,
      publishedBy,
    });
  });
});
