import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ControlPlaneClient } from '@/auth/control-plane.client';
import { SessionService } from '@/auth/session.service';

import type {
  AdmissionIdentity,
  AdmissionHandle,
  AdmissionSeed,
  CompleteOptions,
  CompletionInput,
  CompletionResult,
  ExecutionScope,
  SanitizationInput,
  SanitizationResult,
  SnapshotReference,
  UsageIntent,
} from './execution.types';
import type { AuthorizedExecution } from '@/auth/auth.types';
import { PrivateGatewayClient } from './private-gateway.client';
import { WorkloadCredentialsService } from './workload-credentials';

@Injectable()
export class ExecutionBridgeService {
  private readonly issuedHandles = new WeakSet<object>();

  constructor(
    private readonly sessions: SessionService,
    private readonly controlPlane: ControlPlaneClient,
    private readonly gateway: PrivateGatewayClient,
    private readonly credentials: WorkloadCredentialsService,
  ) {}

  async authorizeAndAdmit(
    accessToken: string,
    identity: AdmissionIdentity = {
      requestId: randomUUID(),
      turnId: randomUUID(),
      idempotencyKey: randomUUID(),
    },
  ): Promise<AdmissionHandle> {
    await this.assertExecutionReady();
    const actor = await this.sessions.authorizeExecution(accessToken);
    return this.admitAuthorized(actor, identity);
  }

  async admitAuthorized(
    actor: AuthorizedExecution,
    identity: AdmissionIdentity,
  ): Promise<AdmissionHandle> {
    await this.assertExecutionReady();
    const runtime = await this.controlPlane.activeRuntimeSnapshot(actor.tenantId);
    const executionScope: ExecutionScope = deepFreeze({
      kind: 'tenant_chat',
      tenantId: actor.tenantId,
      actor: {
        userId: actor.userId,
        actorKind: actor.actorKind,
        ...(actor.employeeId ? { employeeId: actor.employeeId } : {}),
      },
      quotaScope: { type: 'user', id: actor.userId },
      budgetScope: { type: 'tenant', id: actor.tenantId },
    });
    const snapshot: SnapshotReference = deepFreeze({
      version: runtime.version,
      digest: runtime.digest,
      policyVersion: runtime.policyVersion,
      employeeNoticeVersion: runtime.employeeNoticeVersion,
      pricingVersion: runtime.pricingVersion,
    });
    const seed: AdmissionSeed = deepFreeze({
      requestId: identity.requestId,
      turnId: identity.turnId,
      idempotencyKey: identity.idempotencyKey,
      executionScope,
      snapshot,
      actorAuthzVersion: actor.actorAuthzVersion,
      tenantAuthzVersion: actor.tenantAuthzVersion,
      sessionVersion: actor.sessionVersion,
    });
    const handle = deepFreeze(await this.gateway.admit(seed));
    this.issuedHandles.add(handle);
    return handle;
  }

  async complete(
    handle: AdmissionHandle,
    input: CompletionInput,
    usageIntent: UsageIntent,
    options: CompleteOptions = {},
  ): Promise<CompletionResult> {
    this.assertIssued(handle);
    try {
      return await this.gateway.complete(handle, input, usageIntent, options);
    } catch (error) {
      if (options.signal?.aborted) {
        try {
          await this.gateway.cancel(handle);
        } catch {
          // Cancellation is best effort and must not replace the caller abort result.
        }
      }
      throw error;
    }
  }

  async sanitize(
    handle: AdmissionHandle,
    input: SanitizationInput,
  ): Promise<SanitizationResult> {
    this.assertIssued(handle);
    return this.gateway.sanitize(handle, input);
  }

  async cancel(handle: AdmissionHandle) {
    this.assertIssued(handle);
    return this.gateway.cancel(handle);
  }

  private async assertExecutionReady(): Promise<void> {
    if (!this.gateway.isConfigured() || !(await this.credentials.isReady())) {
      throw new HttpException(
        {
          code: 'CHAT_RUNTIME_UNAVAILABLE',
          message: 'Tenant Chat execution is unavailable.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private assertIssued(handle: AdmissionHandle): void {
    if (!handle || !Object.isFrozen(handle) || !this.issuedHandles.has(handle)) {
      throw new HttpException(
        { code: 'CHAT_INVALID_REQUEST', message: 'Tenant Chat admission handle is invalid.' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
