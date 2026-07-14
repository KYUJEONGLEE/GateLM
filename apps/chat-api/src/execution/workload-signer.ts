import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID, sign } from 'node:crypto';

import { canonicalizeJson, type JsonValue } from './jcs';
import type {
  AdmissionSeed,
  CompletionInput,
  ExecutionContext,
  ExecutionPhase,
  UsageIntent,
} from './execution.types';
import {
  WorkloadCredentialsService,
  type WorkloadCredentials,
} from './workload-credentials';

export const EMPTY_PAYLOAD_DIGEST =
  'sha256:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU';

@Injectable()
export class WorkloadSigner {
  constructor(private readonly credentials: WorkloadCredentialsService) {}

  async authorize(
    seed: AdmissionSeed,
    phase: ExecutionPhase,
    input?: CompletionInput,
    admissionId?: string,
    usageIntent?: UsageIntent,
  ): Promise<{ context: ExecutionContext; token: string; kid: string; jti: string }> {
    const loaded = await this.credentials.load();
    const payloadDigest = input
      ? sha256Canonical(input as unknown as JsonValue)
      : EMPTY_PAYLOAD_DIGEST;
    const binding = {
      admissionId: admissionId ?? null,
      executionScope: seed.executionScope,
      idempotencyKey: seed.idempotencyKey,
      payloadDigest,
      phase,
      requestId: seed.requestId,
      snapshotDigest: seed.snapshot.digest,
      snapshotVersion: seed.snapshot.version,
      turnId: seed.turnId,
      ...(usageIntent ? { usageIntent } : {}),
    } as unknown as JsonValue;
    const bindingDigest = hmacDigest(binding, loaded.bindingKey);
    const context = Object.freeze({
      surface: 'tenant_chat' as const,
      phase,
      requestId: seed.requestId,
      turnId: seed.turnId,
      idempotencyKey: seed.idempotencyKey,
      ...(admissionId ? { admissionId } : {}),
      executionScope: seed.executionScope,
      snapshot: seed.snapshot,
      bindingDigest,
      ...(usageIntent ? { usageIntent } : {}),
    });
    const jti = randomUUID();
    return {
      context,
      kid: loaded.kid,
      jti,
      token: signJwt(loaded, {
        iss: 'gatelm-chat-api',
        aud: 'gatelm-gateway-tenant-chat',
        sub: 'service:chat-api',
        jti,
        ...timeClaims(),
        phase,
        requestId: seed.requestId,
        turnId: seed.turnId,
        idempotencyKey: seed.idempotencyKey,
        tenantId: seed.executionScope.tenantId,
        userId: seed.executionScope.actor.userId,
        actorKind: seed.executionScope.actor.actorKind,
        ...(seed.executionScope.actor.employeeId
          ? { employeeId: seed.executionScope.actor.employeeId }
          : {}),
        actorAuthzVersion: seed.actorAuthzVersion,
        tenantAuthzVersion: seed.tenantAuthzVersion,
        sessionVersion: seed.sessionVersion,
        snapshotVersion: seed.snapshot.version,
        snapshotDigest: seed.snapshot.digest,
        bindingDigest,
        ...(admissionId ? { admissionId } : {}),
      }),
    };
  }
}

function timeClaims() {
  const now = Math.floor(Date.now() / 1000);
  return { iat: now, nbf: now - 5, exp: now + 30 };
}

function sha256Canonical(value: JsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('base64url')}`;
}

function hmacDigest(value: JsonValue, key: Buffer): string {
  return `hmac-sha256:${createHmac('sha256', key)
    .update(canonicalizeJson(value), 'utf8')
    .digest('base64url')}`;
}

function signJwt(credentials: WorkloadCredentials, claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'EdDSA', typ: 'gatelm-workload+jwt', kid: credentials.kid }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(signingInput), credentials.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}
