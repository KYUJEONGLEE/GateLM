import Ajv2020 from 'ajv/dist/2020';
import { createHash } from 'node:crypto';

import { COMPLETION_EVENT_SCHEMA } from './completion-event-schema';
import type { CompletionFinalEvent } from './execution.types';
import { canonicalizeJson, type JsonValue } from './jcs';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateEvent = ajv.compile(COMPLETION_EVENT_SCHEMA);

type DeltaEvent = {
  type: 'tenant_chat.delta';
  schemaVersion: 1;
  requestId: string;
  turnId: string;
  sequence: number;
  delta: string;
};

type CompletionEvent = DeltaEvent | CompletionFinalEvent;

export class InvalidCompletionStream extends Error {
  constructor() {
    super('Tenant Chat completion stream is invalid.');
    this.name = 'InvalidCompletionStream';
  }
}

export class CompletionStreamDisconnected extends Error {
  constructor() {
    super('Tenant Chat completion stream disconnected.');
    this.name = 'CompletionStreamDisconnected';
  }
}

export class TerminalReplayContentUnavailable extends Error {
  constructor() {
    super('Terminal replay content is unavailable.');
    this.name = 'TerminalReplayContentUnavailable';
  }
}

export class StrictCompletionStreamParser {
  private readonly fingerprints = new Map<number, string>();
  private assistantContent = '';
  private finalEvent?: CompletionFinalEvent;
  private lastSequence = 0;
  private totalBytes = 0;
  private replayObserved = false;
  private consumeCount = 0;

  constructor(
    private readonly requestId: string,
    private readonly turnId: string,
    private readonly frameMaxBytes: number,
    private readonly streamMaxBytes: number,
    private readonly onDelta?: (delta: string, sequence: number) => void | Promise<void>,
  ) {}

  hasFinal(): boolean {
    return this.finalEvent !== undefined;
  }

  async consume(body: ReadableStream<Uint8Array> | null, replayed: boolean): Promise<void> {
    if (!body) throw new CompletionStreamDisconnected();
    this.consumeCount += 1;
    this.replayObserved ||= replayed;
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let pendingFrame = '';
    const drainLines = async () => {
      buffer = buffer.replace(/\r\n/g, '\n');
      let lineEnd = buffer.indexOf('\n');
      while (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        if (line.length === 0) {
          if (pendingFrame.length > 0) {
            await this.consumeFrame(pendingFrame);
            pendingFrame = '';
          }
        } else {
          pendingFrame += pendingFrame.length > 0 ? `\n${line}` : line;
          if (Buffer.byteLength(pendingFrame) > this.frameMaxBytes) {
            throw new InvalidCompletionStream();
          }
        }
        lineEnd = buffer.indexOf('\n');
      }
      const pendingBytes = Buffer.byteLength(pendingFrame) + Buffer.byteLength(buffer) +
        (pendingFrame.length > 0 && buffer.length > 0 ? 1 : 0);
      if (pendingBytes > this.frameMaxBytes) throw new InvalidCompletionStream();
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        this.totalBytes += value.byteLength;
        if (this.totalBytes > this.streamMaxBytes) throw new InvalidCompletionStream();
        buffer += decoder.decode(value, { stream: true });
        await drainLines();
      }
      buffer += decoder.decode();
      await drainLines();
    } catch (error) {
      if (
        error instanceof InvalidCompletionStream ||
        error instanceof TerminalReplayContentUnavailable
      ) {
        throw error;
      }
      throw new CompletionStreamDisconnected();
    } finally {
      reader.releaseLock();
    }
    if (buffer.length > 0 || pendingFrame.length > 0) throw new CompletionStreamDisconnected();
    if (!this.finalEvent) throw new CompletionStreamDisconnected();
  }

  finish(): { assistantContent: string; final: CompletionFinalEvent } {
    if (!this.finalEvent) throw new CompletionStreamDisconnected();
    if (
      this.replayObserved &&
      ['succeeded', 'cache_hit'].includes(this.finalEvent.terminalOutcome) &&
      this.assistantContent.length === 0
    ) {
      throw new TerminalReplayContentUnavailable();
    }
    return Object.freeze({ assistantContent: this.assistantContent, final: this.finalEvent });
  }

  private async consumeFrame(frame: string): Promise<void> {
    if (!frame || frame.includes('\r') || Buffer.byteLength(frame) > this.frameMaxBytes) {
      throw new InvalidCompletionStream();
    }
    const lines = frame.split('\n');
    if (lines.length !== 3) throw new InvalidCompletionStream();
    const values = new Map<string, string>();
    for (const [lineIndex, line] of lines.entries()) {
      const separator = line.indexOf(':');
      if (separator <= 0) throw new InvalidCompletionStream();
      const field = line.slice(0, separator);
      const value = line.slice(separator + 1).replace(/^ /, '');
      if (!['id', 'event', 'data'].includes(field) || values.has(field) || !value) {
        throw new InvalidCompletionStream();
      }
      if (field !== ['id', 'event', 'data'][lineIndex]) throw new InvalidCompletionStream();
      values.set(field, value);
    }
    let event: CompletionEvent;
    try {
      event = JSON.parse(values.get('data') ?? '') as CompletionEvent;
    } catch {
      throw new InvalidCompletionStream();
    }
    if (!validateEvent(event)) throw new InvalidCompletionStream();
    if (
      event.requestId !== this.requestId ||
      event.turnId !== this.turnId ||
      values.get('event') !== event.type ||
      values.get('id') !== `${event.requestId}:${event.sequence}`
    ) {
      throw new InvalidCompletionStream();
    }
    const fingerprint = createHash('sha256')
      .update(canonicalizeJson(event as unknown as JsonValue), 'utf8')
      .digest('base64url');
    if (this.finalEvent) throw new InvalidCompletionStream();
    if (event.sequence <= this.lastSequence) {
      if (this.consumeCount < 2) throw new InvalidCompletionStream();
      if (this.fingerprints.get(event.sequence) !== fingerprint) {
        throw new InvalidCompletionStream();
      }
      return;
    }
    if (event.sequence !== this.lastSequence + 1) {
      if (this.replayObserved && this.lastSequence === 0) {
        throw new TerminalReplayContentUnavailable();
      }
      throw new InvalidCompletionStream();
    }
    this.lastSequence = event.sequence;
    this.fingerprints.set(event.sequence, fingerprint);
    if (event.type === 'tenant_chat.delta') {
      this.assistantContent += event.delta;
      await this.onDelta?.(event.delta, event.sequence);
      return;
    }
    this.finalEvent = Object.freeze(event);
  }
}
