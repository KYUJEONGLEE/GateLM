import {
  InvalidCompletionStream,
  StrictCompletionStreamParser,
  TerminalReplayContentUnavailable,
} from './sse-parser';

const requestId = 'request_001';
const turnId = 'turn_001';

describe('StrictCompletionStreamParser', () => {
  it('assembles deltas and accepts exactly one continuous final', async () => {
    const deltas: string[] = [];
    const parser = new StrictCompletionStreamParser(requestId, turnId, 64 * 1024, 1024 * 1024, (delta) => {
      deltas.push(delta);
    });
    await parser.consume(stream([frame(delta(1, '안녕')), frame(final(2))]), false);
    expect(parser.finish()).toMatchObject({ assistantContent: '안녕', final: { sequence: 2 } });
    expect(deltas).toEqual(['안녕']);
  });

  it.each([
    ['sequence gap', [frame(delta(2, 'gap'))]],
    ['wrong event name', [frame(delta(1, 'x')).replace('event: tenant_chat.delta', 'event: wrong')]],
    ['duplicate field', [`id: ${requestId}:1\nevent: tenant_chat.delta\ndata: {}\ndata: {}\n\n`]],
    ['missing final', [frame(delta(1, 'x'))]],
    ['duplicate final', [frame(final(1)), frame(final(2))]],
  ])('rejects %s', async (_, chunks) => {
    const parser = new StrictCompletionStreamParser(requestId, turnId, 64 * 1024, 1024 * 1024);
    await expect(parser.consume(stream(chunks), false)).rejects.toBeInstanceOf(Error);
  });

  it('fails DOC-013 terminal replay without reconstructable content', async () => {
    const parser = new StrictCompletionStreamParser(requestId, turnId, 64 * 1024, 1024 * 1024);
    await expect(parser.consume(stream([frame({ ...final(5), replayed: true })]), true))
      .rejects.toBeInstanceOf(TerminalReplayContentUnavailable);
  });

  it('rejects an oversized frame before JSON parsing', async () => {
    const parser = new StrictCompletionStreamParser(requestId, turnId, 128, 1024 * 1024);
    await expect(parser.consume(stream([frame(delta(1, 'x'.repeat(200)))]), false))
      .rejects.toBeInstanceOf(InvalidCompletionStream);
  });
});

function delta(sequence: number, value: string) {
  return { type: 'tenant_chat.delta', schemaVersion: 1, requestId, turnId, sequence, delta: value };
}

function final(sequence: number) {
  return {
    type: 'tenant_chat.final', schemaVersion: 1, requestId, turnId, sequence,
    terminalOutcome: 'succeeded', effectiveModelKey: 'model_standard_001',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, usageQuality: 'confirmed' },
    quotaState: 'normal', budgetState: 'normal', cacheOutcome: 'miss', replayed: false,
  };
}

function frame(event: Record<string, unknown>): string {
  return `id: ${requestId}:${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
}
