import { Readable } from 'node:stream';

import { AiServiceRagExtractionClient } from './rag-ai-extraction.client';
import type { RagWorkerSettings } from './rag-worker-settings';

describe('AiServiceRagExtractionClient', () => {
  let fetchSpy: jest.SpyInstance;
  let client: AiServiceRagExtractionClient;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    client = new AiServiceRagExtractionClient({
      value: {
        aiServiceBaseUrl: new URL('http://ai-service.test'),
        aiServiceToken: 'test-service-token',
      },
    } as unknown as RagWorkerSettings);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('accepts normal extracted chunk text longer than metadata version fields', async () => {
    const text = 'A policy sentence with useful content. '.repeat(80);
    fetchSpy.mockResolvedValue(response({
      parserVersion: 'pypdf-1',
      chunkerVersion: 'chunker-1',
      chunks: [{
        ordinal: 0,
        text,
        tokenCount: 600,
        pageStart: null,
        pageEnd: null,
        lineStart: 1,
        lineEnd: 12,
        sourceMetadata: { sourceType: 'txt' },
        parserVersion: 'pypdf-1',
        chunkerVersion: 'chunker-1',
      }],
    }));

    await expect(client.extract(request())).resolves.toMatchObject({
      chunks: [{ text, tokenCount: 600 }],
    });
  });

  it('preserves a permanent code from the FastAPI nested error envelope', async () => {
    fetchSpy.mockResolvedValue(response({
      error: {
        code: 'RAG_EXTRACTION_PDF_PAGE_LIMIT_EXCEEDED',
        message: 'provider detail that must not escape',
        requestId: 'rag_extract_test',
        retryable: false,
        fields: [],
      },
    }, 413));

    await expect(client.extract(request('application/pdf'))).rejects.toMatchObject({
      code: 'RAG_EXTRACTION_PDF_PAGE_LIMIT_EXCEEDED',
      sanitizedMessage: 'The document cannot be processed for RAG.',
      retryable: false,
    });
  });

  it('preserves a retryable code from the FastAPI nested error envelope', async () => {
    fetchSpy.mockResolvedValue(response({
      error: {
        code: 'RAG_EXTRACTION_PDF_TIMEOUT',
        message: 'provider detail that must not escape',
        requestId: 'rag_extract_test',
        retryable: true,
        fields: [],
      },
    }, 408));

    await expect(client.extract(request('application/pdf'))).rejects.toMatchObject({
      code: 'RAG_EXTRACTION_PDF_TIMEOUT',
      sanitizedMessage: 'RAG extraction service is temporarily unavailable.',
      retryable: true,
    });
  });

  it('treats service authentication failure as infrastructure failure, not a bad document', async () => {
    fetchSpy.mockResolvedValue(response({
      error: {
        code: 'RAG_EXTRACTION_AUTH_REQUIRED',
        message: 'service token mismatch',
        requestId: 'rag_extract_test',
        retryable: false,
        fields: [],
      },
    }, 401));

    await expect(client.extract(request())).rejects.toMatchObject({
      code: 'RAG_EXTRACTION_AUTH_REQUIRED',
      sanitizedMessage: 'RAG extraction service is temporarily unavailable.',
      retryable: true,
    });
  });

  it('rejects an unbounded chunk body even when metadata claims a valid token count', async () => {
    fetchSpy.mockResolvedValue(response({
      parserVersion: 'utf8-nfc-text-v1',
      chunkerVersion: 'cl100k-base-chunker-v1',
      chunks: [{
        ordinal: 0,
        text: 'x'.repeat(1024 * 1024 + 1),
        tokenCount: 1,
        pageStart: null,
        pageEnd: null,
        lineStart: 1,
        lineEnd: 1,
        sourceMetadata: { sourceType: 'txt' },
        parserVersion: 'utf8-nfc-text-v1',
        chunkerVersion: 'cl100k-base-chunker-v1',
      }],
    }));

    await expect(client.extract(request())).rejects.toMatchObject({
      code: 'RAG_EXTRACTION_INVALID_RESPONSE',
      retryable: false,
    });
  });

  function request(mimeType: 'application/pdf' | 'text/plain' = 'text/plain') {
    return {
      body: Readable.from(['document source']),
      mimeType,
      signal: new AbortController().signal,
    } as const;
  }

  function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
