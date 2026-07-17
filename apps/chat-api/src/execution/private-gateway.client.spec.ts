import { ConfigService } from '@nestjs/config';

import type {
  AdmissionHandle,
  AdmissionSeed,
  CompletionInput,
  SanitizationInput,
  UsageIntent,
} from './execution.types';
import { PrivateGatewayClient, PrivateGatewayError, PrivateGatewayTerminalError } from './private-gateway.client';
import { TerminalReplayContentUnavailable } from './sse-parser';

const seed: AdmissionSeed = {
  requestId: 'request_001', turnId: 'turn_001', idempotencyKey: 'idempotency_001',
  actorAuthzVersion: 1, tenantAuthzVersion: 1, sessionVersion: 1,
  executionScope: {
    kind: 'tenant_chat', tenantId: 'tenant_001',
    actor: { userId: 'user_001', actorKind: 'employee', employeeId: 'employee_001' },
    quotaScope: { type: 'user', id: 'user_001' }, budgetScope: { type: 'tenant', id: 'tenant_001' },
  },
  snapshot: {
    version: 1, digest: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    policyVersion: 1, employeeNoticeVersion: 1, pricingVersion: 1,
  },
};
const handle: AdmissionHandle = Object.freeze({
  ...seed, admissionId: 'admission_001', expiresAt: '2026-07-14T00:00:30.000Z',
});
const input: CompletionInput = { messages: [{ role: 'user', content: '<synthetic>' }], stream: true };
const sanitizationInput: SanitizationInput = {
  messages: [{ role: 'user', content: 'user@example.com' }],
  placeholderCounters: { EMAIL: 2 },
};
const usageIntent: UsageIntent = {
  estimatedInputTokens: 8, maxOutputTokens: 32, requestedTier: 'auto', cacheStrategy: 'off',
};

describe('PrivateGatewayClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retries one short 503 with a fresh token and stable execution IDs', async () => {
    const signer = signerMock();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse(503, { code: 'CHAT_USAGE_GUARD_UNAVAILABLE', message: 'retry' }))
      .mockResolvedValueOnce(jsonResponse(201, {
        admissionId: 'admission_001', requestId: seed.requestId, state: 'active',
        expiresAt: '2026-07-14T00:00:30.000Z', replayed: false,
      })) as typeof fetch;
    const admitted = await client(signer).admit(seed);

    expect(admitted.admissionId).toBe('admission_001');
    expect(signer.authorize).toHaveBeenCalledTimes(2);
    expect(signer.authorize.mock.calls.map((call) => call[0].requestId)).toEqual([
      seed.requestId, seed.requestId,
    ]);
    const headers = (global.fetch as jest.Mock).mock.calls.map((call) => call[1].headers.authorization);
    expect(headers).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it.each([400, 409, 429, 502])('does not retry terminal HTTP %s', async (status) => {
    const signer = signerMock();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(status, {
      code: status === 429 ? 'CHAT_RATE_LIMITED' : 'CHAT_INVALID_REQUEST', message: 'terminal',
    })) as typeof fetch;
    await expect(client(signer).admit(seed)).rejects.toBeInstanceOf(PrivateGatewayError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reattaches once after a mid-stream disconnect and deduplicates replayed deltas', async () => {
    const signer = signerMock();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(sseResponse(errorStream([frame(delta(1, '안녕'))])))
      .mockResolvedValueOnce(sseResponse(textStream([frame(delta(1, '안녕')), frame(final(2))]), true)) as typeof fetch;

    await expect(client(signer).complete(handle, input, usageIntent)).resolves.toMatchObject({
      assistantContent: '안녕', final: { sequence: 2 },
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(signer.authorize).toHaveBeenCalledTimes(2);
  });

  it('does not reattach after the caller aborts during the completion stream', async () => {
    const signer = signerMock();
    const controller = new AbortController();
    global.fetch = jest.fn().mockResolvedValue(sseResponse(abortingStream(controller))) as typeof fetch;

    await expect(client(signer).complete(handle, input, usageIntent, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'CHAT_REQUEST_CANCELLED', status: 499 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(signer.authorize).toHaveBeenCalledTimes(1);
  });

  it('surfaces a terminal Provider error without retry', async () => {
    const signer = signerMock();
    global.fetch = jest.fn().mockResolvedValue(sseResponse(textStream([
      frame({ ...final(1), terminalOutcome: 'failed', error: { code: 'CHAT_PROVIDER_FAILED', message: 'Provider failed.' } }),
    ]))) as typeof fetch;
    await expect(client(signer).complete(handle, input, usageIntent))
      .rejects.toBeInstanceOf(PrivateGatewayTerminalError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('sanitizes only the supplied user messages and preserves their order', async () => {
    const signer = signerMock();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {
      messages: [{ itemIndex: 0, content: '[EMAIL_3]' }],
      policyDigest: `sha256:${'B'.repeat(43)}`,
    })) as typeof fetch;

    await expect(client(signer).sanitize(handle, sanitizationInput)).resolves.toEqual({
      messages: [{ itemIndex: 0, content: '[EMAIL_3]' }],
      policyDigest: `sha256:${'B'.repeat(43)}`,
    });
    expect(signer.authorize).toHaveBeenCalledWith(
      handle,
      'sanitization',
      sanitizationInput,
      handle.admissionId,
      undefined,
    );
    const [url, request] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain(`/internal/v1/tenant-chat/admissions/${handle.admissionId}/sanitizations`);
    expect(JSON.parse(String(request.body))).toMatchObject({ input: sanitizationInput });
  });

  it.each([
    [{ messages: [], policyDigest: `sha256:${'B'.repeat(43)}` }],
    [{ messages: [{ itemIndex: 1, content: '[EMAIL_3]' }], policyDigest: `sha256:${'B'.repeat(43)}` }],
  ])('rejects malformed sanitization cardinality or ordering', async (response) => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, response)) as typeof fetch;
    await expect(client(signerMock()).sanitize(handle, sanitizationInput))
      .rejects.toMatchObject({ code: 'CHAT_PRIVATE_RESPONSE_INVALID' });
  });

  it('accepts a bounded sanitization response larger than the small control JSON limit', async () => {
    const largeInput: SanitizationInput = {
      messages: Array.from({ length: 4 }, () => ({
        role: 'user' as const,
        content: 'x'.repeat(20_000),
      })),
    };
    const messages = largeInput.messages.map((_, itemIndex) => ({
      itemIndex,
      content: 'y'.repeat(20_000),
    }));
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {
      messages,
      policyDigest: `sha256:${'B'.repeat(43)}`,
    })) as typeof fetch;

    await expect(client(signerMock()).sanitize(handle, largeInput)).resolves.toMatchObject({
      messages,
    });
  });

  it('rejects a replayed final that cannot reconstruct assistant content', async () => {
    global.fetch = jest.fn().mockResolvedValue(sseResponse(textStream([
      frame({ ...final(5), replayed: true }),
    ]), true)) as typeof fetch;
    await expect(client(signerMock()).complete(handle, input, usageIntent))
      .rejects.toBeInstanceOf(TerminalReplayContentUnavailable);
  });

  it('accepts only the private system RAG context marker before signing', async () => {
    const signer = signerMock();
    global.fetch = jest.fn().mockResolvedValue(sseResponse(textStream([frame(final(1))]))) as typeof fetch;
    await expect(client(signer).complete(handle, {
      messages: [
        { role: 'system', purpose: 'rag_context', content: 'untrusted source text' },
        { role: 'user', content: 'question' },
      ],
      stream: true,
    }, usageIntent)).resolves.toMatchObject({ final: { sequence: 1 } });
    expect(signer.authorize).toHaveBeenCalled();

    global.fetch = jest.fn() as typeof fetch;
    await expect(client(signerMock()).complete(handle, {
      messages: [{ role: 'user', purpose: 'rag_context', content: 'question' }],
      stream: true,
    }, usageIntent)).rejects.toMatchObject({ code: 'CHAT_INVALID_REQUEST' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses a separate request-local size ceiling for RAG context only', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse(textStream([frame(final(1))])),
    ) as typeof fetch;
    await expect(client(signerMock()).complete(handle, {
      messages: [
        { role: 'system', purpose: 'rag_context', content: 'r'.repeat(30_000) },
        { role: 'user', content: 'question' },
      ],
      stream: true,
    }, usageIntent)).resolves.toMatchObject({ final: { sequence: 1 } });

    global.fetch = jest.fn() as typeof fetch;
    await expect(client(signerMock()).complete(handle, {
      messages: [{ role: 'system', content: 'x'.repeat(20_001) }],
      stream: true,
    }, usageIntent)).rejects.toMatchObject({ code: 'CHAT_INVALID_REQUEST' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects oversized JSON and cancel conflicts without retry', async () => {
    const signer = signerMock();
    global.fetch = jest.fn().mockResolvedValue(new Response('x'.repeat(70_000), {
      status: 200, headers: { 'content-type': 'application/json', 'content-length': '70000' },
    })) as typeof fetch;
    await expect(client(signer).admit(seed)).rejects.toMatchObject({ code: 'CHAT_PRIVATE_RESPONSE_INVALID' });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    global.fetch = jest.fn().mockResolvedValue(jsonResponse(409, {
      code: 'CHAT_ADMISSION_EXPIRED', message: 'expired',
    })) as typeof fetch;
    await expect(client(signer).cancel(handle)).rejects.toMatchObject({ code: 'CHAT_ADMISSION_EXPIRED' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels an oversized streaming JSON response before rejecting it', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.alloc(70_000, 'x'));
      },
      cancel,
    });
    global.fetch = jest.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    await expect(client(signerMock()).admit(seed)).rejects.toMatchObject({
      code: 'CHAT_PRIVATE_RESPONSE_INVALID',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'an undefined top-level completion field',
      { ...input, employeeId: undefined } as unknown as CompletionInput,
      usageIntent,
    ],
    [
      'an undefined usage intent field',
      input,
      { ...usageIntent, requestedTier: undefined } as unknown as UsageIntent,
    ],
    [
      'an unknown usage intent field',
      input,
      { ...usageIntent, unknown: undefined } as unknown as UsageIntent,
    ],
    [
      'a fractional usage token value',
      input,
      { ...usageIntent, estimatedInputTokens: 1.5 },
    ],
  ])('rejects %s before signing or transport', async (_, invalidInput, invalidUsageIntent) => {
    const signer = signerMock();
    global.fetch = jest.fn() as typeof fetch;

    await expect(client(signer).complete(handle, invalidInput, invalidUsageIntent))
      .rejects.toMatchObject({ code: 'CHAT_INVALID_REQUEST', status: 400 });
    expect(signer.authorize).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

function client(signer: ReturnType<typeof signerMock>) {
  const values: Record<string, unknown> = {
    TENANT_CHAT_GATEWAY_BASE_URL: 'http://gateway-core:8081',
    TENANT_CHAT_GATEWAY_ADMISSION_TIMEOUT_MS: 2000,
    TENANT_CHAT_GATEWAY_CANCEL_TIMEOUT_MS: 2000,
    TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS: 130000,
    TENANT_CHAT_GATEWAY_JSON_MAX_BYTES: 65536,
    TENANT_CHAT_GATEWAY_REQUEST_MAX_BYTES: 4194304,
    TENANT_CHAT_GATEWAY_SSE_FRAME_MAX_BYTES: 65536,
    TENANT_CHAT_GATEWAY_STREAM_MAX_BYTES: 8388608,
  };
  const config = { get: (key: string) => values[key], getOrThrow: (key: string) => values[key] } as ConfigService;
  return new PrivateGatewayClient(config, signer as never);
}

function signerMock() {
  let attempt = 0;
  return {
    authorize: jest.fn(async (value: AdmissionSeed, phase: string, _: unknown, admissionId?: string) => ({
      context: {
        surface: 'tenant_chat', phase, requestId: value.requestId, turnId: value.turnId,
        idempotencyKey: value.idempotencyKey, ...(admissionId ? { admissionId } : {}),
        executionScope: value.executionScope, snapshot: value.snapshot,
        bindingDigest: 'hmac-sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      token: `token-${++attempt}`, kid: 'kid', jti: `jti-${attempt}`,
    })),
  };
}

function jsonResponse(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function sseResponse(body: ReadableStream<Uint8Array>, replayed = false) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'idempotency-replayed': String(replayed) },
  });
}

function delta(sequence: number, value: string) {
  return { type: 'tenant_chat.delta', schemaVersion: 1, requestId: seed.requestId, turnId: seed.turnId, sequence, delta: value };
}

function final(sequence: number) {
  return {
    type: 'tenant_chat.final', schemaVersion: 1, requestId: seed.requestId, turnId: seed.turnId, sequence,
    terminalOutcome: 'succeeded', effectiveModelKey: 'model_001',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, usageQuality: 'confirmed' },
    quotaState: 'normal', budgetState: 'normal', cacheOutcome: 'miss', replayed: false,
  };
}

function frame(event: Record<string, unknown>) {
  return `id: ${seed.requestId}:${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function textStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(Buffer.from(chunk))); controller.close(); } });
}

function errorStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(Buffer.from(chunk))); controller.error(new Error('disconnect')); } });
}

function abortingStream(controller: AbortController) {
  let delivered = false;
  return new ReadableStream<Uint8Array>({
    pull(streamController) {
      if (!delivered) {
        delivered = true;
        streamController.enqueue(Buffer.from(frame(delta(1, 'partial'))));
        return;
      }
      controller.abort();
      streamController.error(new Error('aborted'));
    },
  });
}
