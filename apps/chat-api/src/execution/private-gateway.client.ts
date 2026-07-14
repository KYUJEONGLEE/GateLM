import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  AdmissionHandle,
  AdmissionSeed,
  CompleteOptions,
  CompletionInput,
  CompletionResult,
  UsageIntent,
} from './execution.types';
import {
  CompletionStreamDisconnected,
  StrictCompletionStreamParser,
} from './sse-parser';
import { WorkloadSigner } from './workload-signer';

const MAX_TRANSPORT_ATTEMPTS = 2;

export class PrivateGatewayError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message = 'Tenant Chat private execution failed.',
  ) {
    super(message);
    this.name = 'PrivateGatewayError';
  }
}

export class PrivateGatewayTerminalError extends PrivateGatewayError {
  constructor(code: string, message: string) {
    super(code, 200, message);
    this.name = 'PrivateGatewayTerminalError';
  }
}

@Injectable()
export class PrivateGatewayClient {
  private readonly baseUrl?: string;
  private readonly admissionTimeoutMs: number;
  private readonly cancelTimeoutMs: number;
  private readonly completionTimeoutMs: number;
  private readonly jsonMaxBytes: number;
  private readonly requestMaxBytes: number;
  private readonly frameMaxBytes: number;
  private readonly streamMaxBytes: number;

  constructor(
    config: ConfigService,
    private readonly signer: WorkloadSigner,
  ) {
    this.baseUrl = config.get<string>('TENANT_CHAT_GATEWAY_BASE_URL')?.trim() || undefined;
    this.admissionTimeoutMs = config.getOrThrow<number>('TENANT_CHAT_GATEWAY_ADMISSION_TIMEOUT_MS');
    this.cancelTimeoutMs = config.getOrThrow<number>('TENANT_CHAT_GATEWAY_CANCEL_TIMEOUT_MS');
    this.completionTimeoutMs = config.getOrThrow<number>('TENANT_CHAT_GATEWAY_COMPLETION_TIMEOUT_MS');
    this.jsonMaxBytes = config.getOrThrow<number>('TENANT_CHAT_GATEWAY_JSON_MAX_BYTES');
    this.requestMaxBytes = config.getOrThrow<number>('TENANT_CHAT_GATEWAY_REQUEST_MAX_BYTES');
    this.frameMaxBytes = config.getOrThrow<number>('TENANT_CHAT_GATEWAY_SSE_FRAME_MAX_BYTES');
    this.streamMaxBytes = config.getOrThrow<number>('TENANT_CHAT_GATEWAY_STREAM_MAX_BYTES');
  }

  isConfigured(): boolean {
    return this.baseUrl !== undefined;
  }

  async admit(seed: AdmissionSeed): Promise<AdmissionHandle> {
    const value = await this.requestJson(
      '/internal/v1/tenant-chat/admissions',
      seed,
      'admission',
      this.admissionTimeoutMs,
      undefined,
      undefined,
    );
    assertExactKeys(value, ['admissionId', 'expiresAt', 'replayed', 'requestId', 'state']);
    if (
      !opaqueId(value.admissionId) ||
      value.requestId !== seed.requestId ||
      value.state !== 'active' ||
      typeof value.replayed !== 'boolean' ||
      typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.expiresAt))
    ) {
      throw invalidResponse();
    }
    return Object.freeze({
      ...seed,
      admissionId: value.admissionId,
      expiresAt: value.expiresAt,
    });
  }

  async cancel(handle: AdmissionHandle): Promise<Readonly<{
    admissionId: string;
    requestId: string;
    state: 'cancelled';
    slotReleased: boolean;
    replayed: boolean;
  }>> {
    const value = await this.requestJson(
      `/internal/v1/tenant-chat/admissions/${encodeURIComponent(handle.admissionId)}/cancel`,
      handle,
      'cancel',
      this.cancelTimeoutMs,
      handle.admissionId,
      undefined,
    );
    assertExactKeys(value, ['admissionId', 'replayed', 'requestId', 'slotReleased', 'state']);
    if (
      value.admissionId !== handle.admissionId ||
      value.requestId !== handle.requestId ||
      value.state !== 'cancelled' ||
      typeof value.slotReleased !== 'boolean' ||
      typeof value.replayed !== 'boolean'
    ) {
      throw invalidResponse();
    }
    return Object.freeze(value as {
      admissionId: string;
      requestId: string;
      state: 'cancelled';
      slotReleased: boolean;
      replayed: boolean;
    });
  }

  async complete(
    handle: AdmissionHandle,
    input: CompletionInput,
    usageIntent: UsageIntent,
    options: CompleteOptions = {},
  ): Promise<CompletionResult> {
    validateCompletionInput(input);
    validateUsageIntent(usageIntent);
    const parser = new StrictCompletionStreamParser(
      handle.requestId,
      handle.turnId,
      this.frameMaxBytes,
      this.streamMaxBytes,
      options.onDelta,
    );
    for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
      const authorization = await this.signer.authorize(
        handle,
        'completion',
        input,
        handle.admissionId,
        usageIntent,
      );
      const body = encodeBody({ context: authorization.context, input }, this.requestMaxBytes);
      let response: Response;
      try {
        response = await this.post(
          '/internal/v1/tenant-chat/completions',
          authorization.token,
          body,
          this.completionTimeoutMs,
          options.signal,
        );
      } catch (error) {
        if (options.signal?.aborted) {
          throw new PrivateGatewayError('CHAT_REQUEST_CANCELLED', 499);
        }
        if (error instanceof PrivateGatewayError || attempt + 1 >= MAX_TRANSPORT_ATTEMPTS) {
          throw transportError(error);
        }
        continue;
      }
      if (isShort503(response) && attempt + 1 < MAX_TRANSPORT_ATTEMPTS) {
        await discardLimited(response, this.jsonMaxBytes);
        continue;
      }
      if (!response.ok) throw await responseError(response, this.jsonMaxBytes);
      if (!isContentType(response, 'text/event-stream')) throw invalidResponse();
      try {
        await parser.consume(
          response.body,
          response.headers.get('idempotency-replayed')?.toLowerCase() === 'true',
        );
      } catch (error) {
        if (options.signal?.aborted) {
          throw new PrivateGatewayError('CHAT_REQUEST_CANCELLED', 499);
        }
        if (
          error instanceof CompletionStreamDisconnected &&
          !parser.hasFinal() &&
          attempt + 1 < MAX_TRANSPORT_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
      break;
    }
    const result = parser.finish();
    if (!['succeeded', 'cache_hit'].includes(result.final.terminalOutcome)) {
      throw new PrivateGatewayTerminalError(
        result.final.error?.code ?? terminalCode(result.final.terminalOutcome),
        result.final.error?.message ?? 'Tenant Chat execution ended without a successful result.',
      );
    }
    return Object.freeze(result);
  }

  private async requestJson(
    path: string,
    seed: AdmissionSeed,
    phase: 'admission' | 'cancel',
    timeoutMs: number,
    admissionId: string | undefined,
    usageIntent: UsageIntent | undefined,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
      const authorization = await this.signer.authorize(
        seed,
        phase,
        undefined,
        admissionId,
        usageIntent,
      );
      const body = encodeBody({ context: authorization.context }, this.requestMaxBytes);
      let response: Response;
      try {
        response = await this.post(path, authorization.token, body, timeoutMs);
      } catch (error) {
        if (error instanceof PrivateGatewayError || attempt + 1 >= MAX_TRANSPORT_ATTEMPTS) {
          throw transportError(error);
        }
        continue;
      }
      if (isShort503(response) && attempt + 1 < MAX_TRANSPORT_ATTEMPTS) {
        await discardLimited(response, this.jsonMaxBytes);
        continue;
      }
      if (!response.ok) throw await responseError(response, this.jsonMaxBytes);
      if (!isContentType(response, 'application/json')) throw invalidResponse();
      return parseJsonObject(await readLimited(response, this.jsonMaxBytes));
    }
    throw new PrivateGatewayError('CHAT_USAGE_GUARD_UNAVAILABLE', 503);
  }

  private async post(
    path: string,
    token: string,
    body: string,
    timeoutMs: number,
    callerSignal?: AbortSignal,
  ): Promise<Response> {
    if (!this.baseUrl) throw new PrivateGatewayError('CHAT_RUNTIME_UNAVAILABLE', 503);
    const url = new URL(path, `${this.baseUrl}/`);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        accept: path.endsWith('/completions') ? 'text/event-stream' : 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body,
      signal,
    });
    if (response.redirected || new URL(response.url || url).origin !== url.origin) {
      throw new PrivateGatewayError('CHAT_PRIVATE_REDIRECT_FORBIDDEN', 502);
    }
    return response;
  }
}

function encodeBody(value: unknown, maximum: number): string {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > maximum) {
    throw new PrivateGatewayError('CHAT_INVALID_REQUEST', 400, 'Tenant Chat request is too large.');
  }
  return body;
}

function validateCompletionInput(input: unknown): void {
  if (
    !hasExactKeys(input, ['messages', 'stream']) ||
    input.stream !== true ||
    !Array.isArray(input.messages) ||
    input.messages.length < 1 ||
    input.messages.length > 64
  ) {
    throw new PrivateGatewayError('CHAT_INVALID_REQUEST', 400);
  }
  for (const message of input.messages) {
    if (
      !hasExactKeys(message, ['content', 'role']) ||
      typeof message.role !== 'string' ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      message.content.length < 1 ||
      message.content.length > 20_000
    ) {
      throw new PrivateGatewayError('CHAT_INVALID_REQUEST', 400);
    }
  }
}

function validateUsageIntent(value: unknown): void {
  if (
    !hasExactKeys(value, [
      'cacheStrategy',
      'estimatedInputTokens',
      'maxOutputTokens',
      'requestedTier',
    ]) ||
    !Number.isInteger(value.estimatedInputTokens) ||
    Number(value.estimatedInputTokens) < 0 ||
    !Number.isInteger(value.maxOutputTokens) ||
    Number(value.maxOutputTokens) < 1 ||
    typeof value.requestedTier !== 'string' ||
    !['auto', 'high_quality', 'standard', 'economy'].includes(value.requestedTier) ||
    typeof value.cacheStrategy !== 'string' ||
    !['off', 'exact'].includes(value.cacheStrategy)
  ) {
    throw new PrivateGatewayError('CHAT_INVALID_REQUEST', 400);
  }
}

async function responseError(response: Response, maximum: number): Promise<PrivateGatewayError> {
  let code = response.status === 429 ? 'CHAT_RATE_LIMITED' : 'CHAT_USAGE_GUARD_UNAVAILABLE';
  let message = 'Tenant Chat private execution failed.';
  try {
    if (isContentType(response, 'application/json')) {
      const value = parseJsonObject(await readLimited(response, maximum));
      if (typeof value.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.code)) code = value.code;
      if (typeof value.message === 'string' && value.message.length <= 256) message = value.message;
    }
  } catch {
    // The caller receives only a bounded safe error, never the raw upstream body.
  }
  return new PrivateGatewayError(code, response.status, message);
}

async function discardLimited(response: Response, maximum: number): Promise<void> {
  try {
    await readLimited(response, maximum);
  } catch {
    // Retry classification depends only on the short 503 status.
  }
}

async function readLimited(response: Response, maximum: number): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > maximum) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidResponse();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel().catch(() => undefined);
        throw invalidResponse();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse();
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, expected: string[]): void {
  if (!hasExactKeys(value, expected)) {
    throw invalidResponse();
  }
}

function hasExactKeys(value: unknown, expected: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isContentType(response: Response, expected: string): boolean {
  return response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === expected;
}

function isShort503(response: Response): boolean {
  if (response.status !== 503) return false;
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return true;
  return /^\d+$/.test(retryAfter) && Number(retryAfter) <= 1;
}

function opaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function invalidResponse(): PrivateGatewayError {
  return new PrivateGatewayError('CHAT_PRIVATE_RESPONSE_INVALID', 502);
}

function transportError(error: unknown): PrivateGatewayError {
  return error instanceof PrivateGatewayError
    ? error
    : new PrivateGatewayError('CHAT_USAGE_GUARD_UNAVAILABLE', 503);
}

function terminalCode(outcome: string): string {
  if (outcome === 'quota_blocked') return 'CHAT_QUOTA_HARD_LIMIT';
  if (outcome === 'budget_blocked') return 'CHAT_BUDGET_HARD_LIMIT';
  if (outcome === 'cancelled') return 'CHAT_REQUEST_CANCELLED';
  return 'CHAT_PROVIDER_FAILED';
}
