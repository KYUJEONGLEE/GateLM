import { RagEmbeddingClient } from './rag-embedding.client';

const tenantId = '00000000-0000-4000-8000-000000000001';

describe('RagEmbeddingClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => { global.fetch = originalFetch; });

  it('uses the dedicated private endpoint with a fixed query profile and no client-selected model fields', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ embeddings: [vector()] }));
    global.fetch = fetchMock as never;
    const signedToken = ['signed', 'token'].join('-');
    const signer = { authorize: jest.fn().mockResolvedValue({ requestId: 'request_1', operationId: 'operation_1', token: signedToken }) };
    const client = new RagEmbeddingClient(config() as never, signer as never);

    const result = await client.embedQuery(tenantId, 'policy');
    expect(result).toMatchObject({
      embedding: expect.any(Array),
      operationId: 'operation_1',
      requestId: 'request_1',
      usage: { inputCount: 1, promptTokens: 1, totalTokens: 1 },
    });
    expect(result.embedding).toHaveLength(1536);
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0].toString()).toBe('https://gateway.example.test/internal/v1/rag/embeddings');
    expect(init.headers.authorization).toBe(['Bearer', signedToken].join(' '));
    expect(JSON.parse(init.body)).toEqual({ purpose: 'RAG_QUERY', profileVersion: 1, inputs: ['policy'] });
  });

  it('fails closed for a response with the wrong vector dimension', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ embeddings: [[0.1]] })) as never;
    const client = new RagEmbeddingClient(config() as never, {
      authorize: jest.fn().mockResolvedValue({ requestId: 'request_1', operationId: 'operation_1', token: ['signed', 'token'].join('-') }),
    } as never);
    await expect(client.embedQuery(tenantId, 'policy')).rejects.toMatchObject({ code: 'RAG_EMBEDDING_RESPONSE_INVALID' });
  });

  it('rejects an oversized query before credentials or network access', async () => {
    const signer = { authorize: jest.fn() };
    const client = new RagEmbeddingClient(config({ RAG_RETRIEVAL_QUERY_MAX_UTF8_BYTES: 3 }) as never, signer as never);
    await expect(client.embedQuery(tenantId, 'policy')).rejects.toMatchObject({ code: 'RAG_QUERY_INVALID' });
    expect(signer.authorize).not.toHaveBeenCalled();
  });
});

function config(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    TENANT_CHAT_GATEWAY_BASE_URL: 'https://gateway.example.test', RAG_QUERY_EMBEDDING_TIMEOUT_MS: 10_000,
    RAG_RETRIEVAL_QUERY_MAX_UTF8_BYTES: 8192, ...overrides,
  };
  return { get: (name: string) => values[name], getOrThrow: (name: string) => values[name] };
}

function response(overrides: Record<string, unknown>) {
  return new Response(JSON.stringify({
    requestId: 'request_1', purpose: 'RAG_QUERY', provider: 'openai', model: 'text-embedding-3-large',
    dimensions: 1536, profileVersion: 1, embeddings: [vector()],
    usage: { inputCount: 1, promptTokens: 1, totalTokens: 1 }, ...overrides,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}
function vector() { return Array.from({ length: 1536 }, () => 0.01); }
