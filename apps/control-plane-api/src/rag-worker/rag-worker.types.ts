import type { Readable } from 'node:stream';

export const RAG_INGESTION_PURPOSE = 'RAG_INGESTION' as const;
export const RAG_EMBEDDING_DIMENSIONS = 1536;
export const RAG_EMBEDDING_PROFILE_VERSION = 1;

export type ClaimedRagJob = Readonly<{
  id: string;
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
  type: 'INGEST' | 'DELETE';
  deletionObjectKeySnapshot: string | null;
  attemptCount: number;
  maxAttempts: number;
}>;

export type ExtractedRagChunk = Readonly<{
  ordinal: number;
  text: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  sourceMetadata: Record<string, unknown>;
  parserVersion: string;
  chunkerVersion: string;
}>;

export type RagExtractionResult = Readonly<{
  chunks: readonly ExtractedRagChunk[];
  parserVersion: string;
  chunkerVersion: string;
}>;

export interface RagExtractionClient {
  extract(input: Readonly<{
    body: Readable;
    mimeType: 'application/pdf' | 'text/plain';
    signal: AbortSignal;
  }>): Promise<RagExtractionResult>;
}

export type RagEmbeddingUsage = Readonly<{
  inputCount: number;
  promptTokens: number;
  totalTokens: number;
}>;

export type RagEmbeddingResult = Readonly<{
  embeddings: readonly (readonly number[])[];
  usage: RagEmbeddingUsage;
}>;

export interface RagEmbeddingClient {
  embed(input: Readonly<{
    tenantId: string;
    operationId: string;
    requestId: string;
    inputs: readonly string[];
    signal: AbortSignal;
  }>): Promise<RagEmbeddingResult>;
}

export class RagWorkerError extends Error {
  override readonly name = 'RagWorkerError';

  constructor(
    readonly code: string,
    readonly sanitizedMessage: string,
    readonly retryable: boolean,
  ) {
    super(sanitizedMessage);
  }
}

export function isRagWorkerError(error: unknown): error is RagWorkerError {
  return error instanceof RagWorkerError;
}
