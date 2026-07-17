import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID, sign } from 'node:crypto';

import { RAG_EMBEDDING_PROFILE } from '@gatelm/rag-config';

import { canonicalizeJson, type JsonValue } from '@/execution/jcs';

import { RagQueryCredentialsService } from './rag-query-credentials.service';

export type RagQueryEmbeddingRequest = Readonly<{
  purpose: 'RAG_QUERY';
  profileVersion: 1;
  inputs: readonly [string];
}>;

@Injectable()
export class RagQueryWorkloadSigner {
  constructor(private readonly credentials: RagQueryCredentialsService) {}

  async authorize(tenantId: string, request: RagQueryEmbeddingRequest): Promise<Readonly<{
    requestId: string; operationId: string; token: string;
  }>> {
    const loaded = await this.credentials.load();
    const requestId = opaqueUuid();
    const operationId = opaqueUuid();
    const payloadDigest = sha256Canonical(request as unknown as JsonValue);
    const bindingDigest = hmacDigest({
      operationId,
      payloadDigest,
      profileVersion: RAG_EMBEDDING_PROFILE.profileVersion,
      purpose: 'RAG_QUERY',
      requestId,
      tenantId,
    }, loaded.bindingKey);
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: 'gatelm-chat-api', aud: 'gatelm-gateway-rag-embedding', sub: 'service:chat-api',
      jti: opaqueUuid(), iat: now, nbf: now - 5, exp: now + 60,
      requestId, operationId, tenantId, purpose: 'RAG_QUERY',
      profileVersion: RAG_EMBEDDING_PROFILE.profileVersion, bindingDigest,
    };
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'gatelm-rag-workload+jwt', kid: loaded.kid }))
      .toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = sign(null, Buffer.from(signingInput), loaded.privateKey).toString('base64url');
    return Object.freeze({ requestId, operationId, token: `${signingInput}.${signature}` });
  }
}

function opaqueUuid(): string { return randomUUID(); }
function sha256Canonical(value: JsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('base64url')}`;
}
function hmacDigest(value: Record<string, string | number>, key: Buffer): string {
  return `hmac-sha256:${createHmac('sha256', key).update(canonicalizeJson(value as JsonValue), 'utf8').digest('base64url')}`;
}
