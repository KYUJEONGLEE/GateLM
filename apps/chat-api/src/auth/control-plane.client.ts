import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IdentityResult, TenantEntitlement } from './auth.types';
import {
  parseUsageRankingResponse,
  type UsageRankingMetric,
  type UsageRankingRange,
  type UsageRankingResponse,
} from '../usage/usage-ranking.contract';

const MAX_RESPONSE_BYTES = 64 * 1024;

export type ActiveRuntimeSnapshotMetadata = {
  tenantId: string;
  version: number;
  digest: string;
  policyVersion: number;
  employeeNoticeVersion: number;
  pricingVersion: number;
};

@Injectable()
export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('TENANT_CHAT_CONTROL_PLANE_BASE_URL');
    this.serviceToken = config.getOrThrow<string>('TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN');
    this.timeoutMs = config.getOrThrow<number>('TENANT_CHAT_CONTROL_PLANE_TIMEOUT_MS');
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

  async usageRanking(input: Readonly<{
    metric: UsageRankingMetric;
    range: UsageRankingRange;
    tenantId: string;
    viewerEmployeeId?: string;
  }>): Promise<UsageRankingResponse> {
    const query = new URLSearchParams({
      metric: input.metric,
      range: input.range,
      ...(input.viewerEmployeeId
        ? { viewerEmployeeId: input.viewerEmployeeId }
        : {}),
    });
    const value = await this.request<unknown>(
      `/internal/v1/tenant-chat/usage/rankings/${encodeURIComponent(input.tenantId)}?${query}`,
    );
    return parseUsageRankingResponse(value);
  }

  async activeRuntimeSnapshot(tenantId: string): Promise<ActiveRuntimeSnapshotMetadata> {
    try {
      const value = await this.request<Record<string, unknown>>(
        `/internal/v1/tenant-chat/runtime/snapshots/${encodeURIComponent(tenantId)}/active`,
      );
      const keys = Object.keys(value).sort();
      if (
        keys.join(',') !== 'digest,employeeNoticeVersion,policyVersion,pricingVersion,tenantId,version' ||
        value.tenantId !== tenantId ||
        typeof value.digest !== 'string' ||
        !/^sha256:[A-Za-z0-9_-]{43}$/.test(value.digest) ||
        !positiveInteger(value.version) ||
        !positiveInteger(value.policyVersion) ||
        !positiveInteger(value.employeeNoticeVersion) ||
        !positiveInteger(value.pricingVersion)
      ) {
        throw new Error('invalid_runtime_metadata');
      }
      return value as ActiveRuntimeSnapshotMetadata;
    } catch {
      throw new HttpException(
        {
          code: 'CHAT_RUNTIME_UNAVAILABLE',
          message: 'Tenant Chat runtime metadata is unavailable.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
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
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (contentLength > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!response.ok) {
        const { code, message } = controlPlaneError(payload);
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

function controlPlaneError(payload: Record<string, unknown>): {
  code: string;
  message: string;
} {
  const nested = isRecord(payload.error) ? payload.error : undefined;
  const source = nested ?? payload;
  return {
    code:
      typeof source.code === 'string'
        ? source.code
        : 'CHAT_ENTITLEMENT_UNAVAILABLE',
    message:
      typeof source.message === 'string'
        ? source.message
        : 'Tenant Chat identity request failed.',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
