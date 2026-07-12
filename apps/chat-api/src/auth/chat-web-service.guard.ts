import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { safeEqual } from './auth.crypto';

@Injectable()
export class ChatWebServiceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = this.config.getOrThrow<string>('TENANT_CHAT_WEB_SERVICE_TOKEN');
    const provided = request.header('x-gatelm-chat-web-service-token') ?? '';
    if (!safeEqual(expected, provided)) {
      throw new UnauthorizedException({
        code: 'CHAT_AUTH_REQUIRED',
        message: 'Chat Web service authentication is required.',
      });
    }
    return true;
  }
}
