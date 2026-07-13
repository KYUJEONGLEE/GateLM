import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IdentityResult, TenantEntitlement } from './auth.types';

const MAX_RESPONSE_BYTES = 64 * 1024;

@Injectable()
export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('TENANT_CHAT_CONTROL_PLANE_BASE_URL');
    this.serviceToken = config.getOrThrow<string>('TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN');
  }

  password(email: string, password: string): Promise<IdentityResult> {
    return this.request('/internal/v1/tenant-chat/identity/password', {
      body: { email, password },
      method: 'POST',
    });
  }

  resolveInvitation(token: string): Promise<Record<string, unknown>> {
    return this.request('/internal/v1/tenant-chat/identity/invitations/resolve', {
      body: { token },
      method: 'POST',
    });
  }

  acceptPassword(input: { name: string; password: string; token: string }): Promise<IdentityResult> {
    return this.request('/internal/v1/tenant-chat/identity/invitations/accept-password', {
      body: input,
      method: 'POST',
    });
  }

  bindExisting(input: { token: string; userId: string }): Promise<IdentityResult> {
    return this.request('/internal/v1/tenant-chat/identity/invitations/bind-existing', {
      body: input,
      method: 'POST',
    });
  }

  googleStart(state: string): Promise<{ authorizationUrl: string }> {
    return this.request('/internal/v1/tenant-chat/identity/google/start', {
      body: { state },
      method: 'POST',
    });
  }

  googleComplete(input: { code: string; invitationToken?: string }): Promise<IdentityResult> {
    return this.request('/internal/v1/tenant-chat/identity/google/complete', {
      body: input,
      method: 'POST',
    });
  }

  entitlements(userId: string): Promise<IdentityResult> {
    return this.request(`/internal/v1/tenant-chat/identity/entitlements/${encodeURIComponent(userId)}`);
  }

  entitlement(userId: string, tenantId: string): Promise<TenantEntitlement> {
    return this.request(
      `/internal/v1/tenant-chat/identity/entitlements/${encodeURIComponent(userId)}/${encodeURIComponent(tenantId)}`,
    );
  }

  private async request<T>(
    path: string,
    options: { body?: unknown; method?: 'GET' | 'POST' } = {},
  ): Promise<T> {
    try {
      const response = await fetch(new URL(path, `${this.baseUrl}/`), {
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          'x-gatelm-tenant-chat-service-token': this.serviceToken,
        },
        method: options.method ?? 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(1500),
      });
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (contentLength > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!response.ok) {
        const code = typeof payload.code === 'string' ? payload.code : 'CHAT_ENTITLEMENT_UNAVAILABLE';
        const message = typeof payload.message === 'string' ? payload.message : 'Tenant Chat identity request failed.';
        throw new HttpException({ code, message }, response.status);
      }
      return (payload.data ?? payload) as T;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { code: 'CHAT_ENTITLEMENT_UNAVAILABLE', message: 'Tenant access could not be verified.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
