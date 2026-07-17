import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RAG_EMBEDDING_PROFILE } from '@gatelm/rag-config';

import { RagRetrievalError } from './rag-retrieval.errors';
import { RagQueryWorkloadSigner, type RagQueryEmbeddingRequest } from './rag-query-workload-signer';

const RESPONSE_MAX_BYTES = 16 * 1024 * 1024;

export type RagQueryEmbeddingResult = Readonly<{
  embedding: number[];
  requestId: string;
  operationId: string;
  usage: Readonly<{ inputCount: 1; promptTokens: number; totalTokens: number }>;
}>;

@Injectable()
export class RagEmbeddingClient {
  private readonly baseUrl?: string;
  private readonly timeoutMs: number;
  private readonly maxQueryBytes: number;

  constructor(config: ConfigService, private readonly signer: RagQueryWorkloadSigner) {
    this.baseUrl = config.get<string>('TENANT_CHAT_GATEWAY_BASE_URL')?.trim() || undefined;
    this.timeoutMs = config.getOrThrow<number>('RAG_QUERY_EMBEDDING_TIMEOUT_MS');
    this.maxQueryBytes = config.getOrThrow<number>('RAG_RETRIEVAL_QUERY_MAX_UTF8_BYTES');
  }

  async embedQuery(tenantId: string, query: string): Promise<RagQueryEmbeddingResult> {
    if (typeof query !== 'string' || query.trim().length === 0 || Buffer.byteLength(query, 'utf8') > this.maxQueryBytes) {
      throw new RagRetrievalError('RAG_QUERY_INVALID', 400);
    }
    if (!this.baseUrl) throw new RagRetrievalError('RAG_EMBEDDING_UNAVAILABLE');
    const request: RagQueryEmbeddingRequest = Object.freeze({
      purpose: 'RAG_QUERY', profileVersion: 1, inputs: [query] as [string],
    });
    const authorization = await this.signer.authorize(tenantId, request);
    const body = JSON.stringify(request);
    let response: Response;
    try {
      const url = new URL('/internal/v1/rag/embeddings', `${this.baseUrl}/`);
      response = await fetch(url, {
        method: 'POST', redirect: 'error',
        headers: { accept: 'application/json', authorization: `Bearer ${authorization.token}`, 'content-type': 'application/json' },
        body, signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.redirected || new URL(response.url || url).origin !== url.origin) {
        throw new RagRetrievalError('RAG_EMBEDDING_REDIRECT_FORBIDDEN', 502);
      }
    } catch (error) {
      if (error instanceof RagRetrievalError) throw error;
      throw new RagRetrievalError('RAG_EMBEDDING_UNAVAILABLE');
    }
    if (!response.ok) throw new RagRetrievalError(errorCode(response.status), response.status);
    if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      throw new RagRetrievalError('RAG_EMBEDDING_RESPONSE_INVALID', 502);
    }
    const value = await readJson(response);
    return parseEmbeddingResponse(value, authorization.requestId, authorization.operationId);
  }
}

function errorCode(status: number): string {
  if (status === 400) return 'RAG_QUERY_INVALID';
  if (status === 401) return 'RAG_EMBEDDING_TOKEN_INVALID';
  if (status === 429) return 'RAG_EMBEDDING_RATE_LIMITED';
  if (status === 504) return 'RAG_EMBEDDING_PROVIDER_TIMEOUT';
  return 'RAG_EMBEDDING_UNAVAILABLE';
}

async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > RESPONSE_MAX_BYTES) throw new RagRetrievalError('RAG_EMBEDDING_RESPONSE_INVALID', 502);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > RESPONSE_MAX_BYTES) throw new RagRetrievalError('RAG_EMBEDDING_RESPONSE_INVALID', 502);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as unknown; }
  catch { throw new RagRetrievalError('RAG_EMBEDDING_RESPONSE_INVALID', 502); }
}

function parseEmbeddingResponse(
  value: unknown,
  requestId: string,
  operationId: string,
): RagQueryEmbeddingResult {
  if (!exactObject(value, ['dimensions', 'embeddings', 'model', 'profileVersion', 'provider', 'purpose', 'requestId', 'usage']) ||
    value.requestId !== requestId || value.purpose !== 'RAG_QUERY' ||
    value.provider !== RAG_EMBEDDING_PROFILE.provider || value.model !== RAG_EMBEDDING_PROFILE.model ||
    value.dimensions !== RAG_EMBEDDING_PROFILE.dimensions || value.profileVersion !== RAG_EMBEDDING_PROFILE.profileVersion ||
    !Array.isArray(value.embeddings) || value.embeddings.length !== 1 || !validUsage(value.usage)) {
    throw new RagRetrievalError('RAG_EMBEDDING_RESPONSE_INVALID', 502);
  }
  const vector = value.embeddings[0];
  if (!Array.isArray(vector) || vector.length !== RAG_EMBEDDING_PROFILE.dimensions ||
    vector.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new RagRetrievalError('RAG_EMBEDDING_RESPONSE_INVALID', 502);
  }
  const usage = value.usage as Record<string, number>;
  return Object.freeze({
    embedding: vector.slice(),
    requestId,
    operationId,
    usage: Object.freeze({
      inputCount: 1 as const,
      promptTokens: usage.promptTokens as number,
      totalTokens: usage.totalTokens as number,
    }),
  });
}

function validUsage(value: unknown): boolean {
  if (!exactObject(value, ['inputCount', 'promptTokens', 'totalTokens']) || value.inputCount !== 1 ||
    typeof value.promptTokens !== 'number' || typeof value.totalTokens !== 'number') return false;
  return Number.isInteger(value.promptTokens) && value.promptTokens > 0 &&
    Number.isInteger(value.totalTokens) && value.totalTokens >= value.promptTokens;
}
function exactObject(value: unknown, expected: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
