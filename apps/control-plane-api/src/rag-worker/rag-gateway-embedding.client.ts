import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID, sign } from 'node:crypto';

import { canonicalizeJson, type JsonValue } from './canonical-json';
import { RagWorkloadCredentials } from './rag-workload-credentials';
import { RagWorkerSettings } from './rag-worker-settings';
import {
  RAG_EMBEDDING_DIMENSIONS,
  RAG_EMBEDDING_PROFILE_VERSION,
  RAG_INGESTION_PURPOSE,
  RagWorkerError,
  type RagEmbeddingClient,
  type RagEmbeddingResult,
} from './rag-worker.types';

@Injectable()
export class GatewayRagEmbeddingClient implements RagEmbeddingClient {
  constructor(
    private readonly settings: RagWorkerSettings,
    private readonly credentials: RagWorkloadCredentials,
  ) {}

  async embed(input: Readonly<{
    tenantId: string;
    operationId: string;
    requestId: string;
    inputs: readonly string[];
    signal: AbortSignal;
  }>): Promise<RagEmbeddingResult> {
    if (input.inputs.length < 1 || input.inputs.length > this.settings.value.embeddingBatchSize) {
      throw new RagWorkerError('RAG_EMBEDDING_INVALID_REQUEST', 'RAG embedding input is invalid.', false);
    }
    const body = {
      purpose: RAG_INGESTION_PURPOSE,
      profileVersion: RAG_EMBEDDING_PROFILE_VERSION,
      inputs: [...input.inputs],
    } as const;
    const credentials = await this.credentials.load();
    const binding = {
      operationId: input.operationId,
      payloadDigest: sha256Canonical(body as unknown as JsonValue),
      profileVersion: RAG_EMBEDDING_PROFILE_VERSION,
      purpose: RAG_INGESTION_PURPOSE,
      requestId: input.requestId,
      tenantId: input.tenantId,
    } as const;
    const token = signJwt(credentials, {
      iss: 'gatelm-control-plane-worker',
      sub: 'service:control-plane-worker',
      aud: 'gatelm-gateway-rag-embedding',
      jti: randomUUID(),
      ...timeClaims(),
      requestId: input.requestId,
      operationId: input.operationId,
      tenantId: input.tenantId,
      purpose: RAG_INGESTION_PURPOSE,
      profileVersion: RAG_EMBEDDING_PROFILE_VERSION,
      bindingDigest: hmacCanonical(binding as unknown as JsonValue, credentials.bindingKey),
    });
    const url = new URL('/internal/v1/rag/embeddings', this.settings.value.gatewayBaseUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        signal: input.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (input.signal.aborted) throw new RagWorkerError('RAG_GATEWAY_TIMEOUT', 'RAG embedding service timed out.', true);
      throw new RagWorkerError('RAG_GATEWAY_UNAVAILABLE', 'RAG embedding service is unavailable.', true);
    }
    if (!response.ok) throw gatewayError(response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RagWorkerError('RAG_EMBEDDING_INVALID_RESPONSE', 'RAG embedding response is invalid.', false);
    }
    return validateEmbeddingResponse(payload, input.inputs.length, input.requestId);
  }
}

function validateEmbeddingResponse(value: unknown, inputCount: number, requestId: string): RagEmbeddingResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  const payload = value as Record<string, unknown>;
  if (
    payload.requestId !== requestId || payload.purpose !== RAG_INGESTION_PURPOSE ||
    payload.provider !== 'openai' || payload.model !== 'text-embedding-3-large' ||
    payload.dimensions !== RAG_EMBEDDING_DIMENSIONS || payload.profileVersion !== RAG_EMBEDDING_PROFILE_VERSION ||
    !Array.isArray(payload.embeddings) || payload.embeddings.length !== inputCount ||
    !payload.usage || typeof payload.usage !== 'object' || Array.isArray(payload.usage)
  ) throw invalidResponse();
  const vectors = payload.embeddings.map((vector) => {
    if (!Array.isArray(vector) || vector.length !== RAG_EMBEDDING_DIMENSIONS ||
      vector.some((number) => typeof number !== 'number' || !Number.isFinite(number))) {
      throw invalidResponse();
    }
    return Object.freeze([...vector] as number[]);
  });
  const usage = payload.usage as Record<string, unknown>;
  if (
    usage.inputCount !== inputCount || !isNonNegativeInteger(usage.promptTokens) ||
    !isNonNegativeInteger(usage.totalTokens) || usage.totalTokens < usage.promptTokens
  ) throw invalidResponse();
  return Object.freeze({
    embeddings: Object.freeze(vectors),
    usage: Object.freeze({ inputCount, promptTokens: usage.promptTokens, totalTokens: usage.totalTokens }),
  });
}

function gatewayError(status: number): RagWorkerError {
  if (status === 408 || status === 429 || status >= 500) {
    return new RagWorkerError('RAG_GATEWAY_UNAVAILABLE', 'RAG embedding service is temporarily unavailable.', true);
  }
  return new RagWorkerError('RAG_EMBEDDING_REJECTED', 'RAG embedding request was rejected.', false);
}

function invalidResponse(): RagWorkerError {
  return new RagWorkerError('RAG_EMBEDDING_INVALID_RESPONSE', 'RAG embedding response is invalid.', false);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function timeClaims() {
  const now = Math.floor(Date.now() / 1000);
  return { iat: now, nbf: now - 5, exp: now + 30 };
}

function signJwt(credentials: Awaited<ReturnType<RagWorkloadCredentials['load']>>, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'gatelm-rag-workload+jwt', kid: credentials.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input), credentials.privateKey).toString('base64url')}`;
}

function sha256Canonical(value: JsonValue): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('base64url')}`;
}

function hmacCanonical(value: JsonValue, key: Buffer): string {
  return `hmac-sha256:${createHmac('sha256', key).update(canonicalizeJson(value), 'utf8').digest('base64url')}`;
}
