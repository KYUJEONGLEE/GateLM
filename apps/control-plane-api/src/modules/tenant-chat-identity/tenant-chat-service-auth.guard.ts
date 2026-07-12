import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const TENANT_CHAT_SERVICE_TOKEN_HEADER = 'x-gatelm-tenant-chat-service-token';

@Injectable()
export class TenantChatServiceAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = this.config.get<string>('TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN')?.trim();
    const provided = request.header(TENANT_CHAT_SERVICE_TOKEN_HEADER)?.trim();

    if (!expected || !provided || !safeEqual(expected, provided)) {
      throw new UnauthorizedException({
        code: 'CHAT_AUTH_REQUIRED',
        message: 'Tenant Chat service authentication is required.',
      });
    }

    return true;
  }
}

function safeEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
