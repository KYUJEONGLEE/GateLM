import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

const authenticatedAdminUserId = Symbol('authenticatedAdminUserId');

type AuthenticatedAdminRequest = Request & {
  [authenticatedAdminUserId]?: string;
};

export function setAuthenticatedAdminUserId(
  request: Request,
  userId: string,
): void {
  Object.defineProperty(request, authenticatedAdminUserId, {
    configurable: false,
    enumerable: false,
    value: userId,
    writable: false,
  });
}

export function getAuthenticatedAdminUserId(request: Request): string | null {
  return (request as AuthenticatedAdminRequest)[authenticatedAdminUserId] ?? null;
}

export const CurrentAdminUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedAdminRequest>();
    const userId = getAuthenticatedAdminUserId(request);
    if (!userId) {
      throw new UnauthorizedException('Authenticated admin context is required.');
    }
    return userId;
  },
);
