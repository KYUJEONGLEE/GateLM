import { UnauthorizedException } from '@nestjs/common';

import { TenantChatServiceAuthGuard } from './tenant-chat-service-auth.guard';

describe('TenantChatServiceAuthGuard', () => {
  const config = {
    get: jest.fn().mockReturnValue('expected-service-token'),
  };

  it('rejects a missing or mismatched service token', () => {
    const guard = new TenantChatServiceAuthGuard(config as never);
    expect(() => guard.canActivate(context(undefined))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context('wrong-service-token'))).toThrow(UnauthorizedException);
  });

  it('accepts the exact service token', () => {
    const guard = new TenantChatServiceAuthGuard(config as never);
    expect(guard.canActivate(context('expected-service-token'))).toBe(true);
  });
});

function context(token: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name === 'x-gatelm-tenant-chat-service-token' ? token : undefined,
      }),
    }),
  } as never;
}
