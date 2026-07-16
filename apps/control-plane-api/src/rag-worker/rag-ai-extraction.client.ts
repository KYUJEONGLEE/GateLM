import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';

import { RagWorkerSettings } from './rag-worker-settings';
import {
  RagWorkerError,
  type ExtractedRagChunk,
  type RagExtractionClient,
  type RagExtractionResult,
} from './rag-worker.types';

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_CHUNK_TEXT_BYTES = 1024 * 1024;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PERMANENT_EXTRACTION_ERROR_CODES = new Set([
  'RAG_EXTRACTION_EMPTY_TEXT',
  'RAG_EXTRACTION_INPUT_TOO_LARGE',
  'RAG_EXTRACTION_INVALID_ENCODING',
  'RAG_EXTRACTION_INVALID_PDF',
  'RAG_EXTRACTION_ENCRYPTED_PDF',
  'RAG_EXTRACTION_PDF_PAGE_LIMIT_EXCEEDED',
  'RAG_EXTRACTION_TEXT_LIMIT_EXCEEDED',
  'RAG_EXTRACTION_SCANNED_PDF_NOT_SUPPORTED',
  'RAG_EXTRACTION_CHUNK_LIMIT_EXCEEDED',
  'RAG_EXTRACTION_UNSUPPORTED_MEDIA_TYPE',
]);
const RETRYABLE_EXTRACTION_ERROR_CODES = new Set([
  'RAG_EXTRACTION_AUTH_REQUIRED',
  'RAG_EXTRACTION_PDF_TIMEOUT',
  'RAG_EXTRACTION_UNAVAILABLE',
]);

@Injectable()
export class AiServiceRagExtractionClient implements RagExtractionClient {
  constructor(private readonly settings: RagWorkerSettings) {}

  async extract(input: Readonly<{
    body: Readable;
    mimeType: 'application/pdf' | 'text/plain';
    signal: AbortSignal;
  }>): Promise<RagExtractionResult> {
    const url = new URL('/internal/v1/rag/extract', this.settings.value.aiServiceBaseUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        signal: input.signal,
        headers: {
          'Content-Type': input.mimeType,
          'X-GateLM-AI-Service-Token': this.settings.value.aiServiceToken,
        },
        body: Readable.toWeb(input.body) as unknown as BodyInit,
        // Node's streaming request extension; browser callers never use this client.
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
    } catch {
      throw new RagWorkerError(
        input.signal.aborted ? 'RAG_AI_SERVICE_TIMEOUT' : 'RAG_AI_SERVICE_UNAVAILABLE',
        'RAG extraction service is temporarily unavailable.',
        true,
      );
    }
    if (!response.ok) throw extractionError(response.status, await safeErrorCode(response));
    const raw = await readBounded(response.body);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new RagWorkerError('RAG_EXTRACTION_INVALID_RESPONSE', 'RAG extraction response is invalid.', false);
    }
    return validateExtractionResponse(parsed);
  }
}

async function safeErrorCode(response: Response): Promise<string | undefined> {
  try {
    const raw = await readBounded(response.body, 8 * 1024);
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const payload = parsed as Record<string, unknown>;
      const nestedError = payload.error;
      const nestedCode =
        nestedError && typeof nestedError === 'object' && !Array.isArray(nestedError)
          ? (nestedError as Record<string, unknown>).code
          : undefined;
      const code = nestedCode ?? payload.code;
      return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : undefined;
    }
  } catch {
    // Do not expose an internal response body.
  }
  return undefined;
}

function extractionError(status: number, code?: string): RagWorkerError {
  if (code && PERMANENT_EXTRACTION_ERROR_CODES.has(code)) {
    return new RagWorkerError(code, 'The document cannot be processed for RAG.', false);
  }
  if (code && RETRYABLE_EXTRACTION_ERROR_CODES.has(code)) {
    return new RagWorkerError(code, 'RAG extraction service is temporarily unavailable.', true);
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new RagWorkerError('RAG_AI_SERVICE_UNAVAILABLE', 'RAG extraction service is temporarily unavailable.', true);
  }
  return new RagWorkerError('RAG_EXTRACTION_FAILED', 'The document cannot be processed for RAG.', false);
}

async function readBounded(body: ReadableStream<Uint8Array> | null, limit = MAX_RESPONSE_BYTES): Promise<string> {
  if (!body) throw new Error('response body missing');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error('response too large');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function validateExtractionResponse(value: unknown): RagExtractionResult {
  const payload = record(value);
  const parserVersion = stringValue(payload.parserVersion);
  const chunkerVersion = stringValue(payload.chunkerVersion);
  if (!Array.isArray(payload.chunks) || payload.chunks.length < 1 || payload.chunks.length > 10_000) {
    throw invalidResponse();
  }
  const chunks = payload.chunks.map((chunk, ordinal) => validateChunk(chunk, ordinal, parserVersion, chunkerVersion));
  return Object.freeze({ chunks: Object.freeze(chunks), parserVersion, chunkerVersion });
}

function validateChunk(
  value: unknown,
  expectedOrdinal: number,
  parserVersion: string,
  chunkerVersion: string,
): ExtractedRagChunk {
  const chunk = record(value);
  const text = chunkTextValue(chunk.text);
  const tokenCount = integer(chunk.tokenCount, 1, 900);
  if (chunk.ordinal !== expectedOrdinal || text.trim().length < 1 || stringValue(chunk.parserVersion) !== parserVersion || stringValue(chunk.chunkerVersion) !== chunkerVersion) {
    throw invalidResponse();
  }
  const [pageStart, pageEnd] = nullableRange(chunk.pageStart, chunk.pageEnd);
  const [lineStart, lineEnd] = nullableRange(chunk.lineStart, chunk.lineEnd);
  const sourceMetadata = record(chunk.sourceMetadata);
  validateSourceMetadata(sourceMetadata);
  return Object.freeze({
    ordinal: expectedOrdinal, text, tokenCount, pageStart, pageEnd, lineStart, lineEnd,
    sourceMetadata, parserVersion, chunkerVersion,
  });
}

function validateSourceMetadata(value: Record<string, unknown>): void {
  const keys = Object.keys(value).sort();
  if (!keys.includes('sourceType') || keys.some((key) => key !== 'sourceType' && key !== 'pageNumber')) {
    throw invalidResponse();
  }
  if (value.sourceType !== 'txt' && value.sourceType !== 'pdf') throw invalidResponse();
  if (value.sourceType === 'txt' && keys.length !== 1) throw invalidResponse();
  if (
    value.sourceType === 'pdf' &&
    (typeof value.pageNumber !== 'number' ||
      !Number.isInteger(value.pageNumber) ||
      value.pageNumber < 1)
  ) {
    throw invalidResponse();
  }
}

function nullableRange(start: unknown, end: unknown): readonly [number | null, number | null] {
  if (start === null && end === null) return [null, null];
  const startValue = integer(start, 1, Number.MAX_SAFE_INTEGER);
  const endValue = integer(end, startValue, Number.MAX_SAFE_INTEGER);
  return [startValue, endValue];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw invalidResponse();
  return value;
}

function chunkTextValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    Buffer.byteLength(value, 'utf8') > MAX_CHUNK_TEXT_BYTES
  ) {
    throw invalidResponse();
  }
  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalidResponse();
  return value;
}

function invalidResponse(): RagWorkerError {
  return new RagWorkerError('RAG_EXTRACTION_INVALID_RESPONSE', 'RAG extraction response is invalid.', false);
}
