import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { Logger } from '@nestjs/common';
import type { Request } from 'express';

import type {
  DeleteRagSourceObjectInput,
  PutRagSourceObjectInput,
  RagObjectStore,
} from './object-store.port';
import { createRagSourceObjectKey } from './rag-object-key';
import { RagUploadException } from './rag-upload.errors';
import { RagUploadStreamService } from './rag-upload-stream.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const OBJECT_KEY = createRagSourceObjectKey(TENANT_ID, DOCUMENT_ID);

interface MultipartPart {
  body: Buffer;
  contentType?: string;
  filename?: string;
  name: string;
}

class FakeRagObjectStore implements RagObjectStore {
  readonly deletes: DeleteRagSourceObjectInput[] = [];
  readonly puts: Array<
    Omit<PutRagSourceObjectInput, 'body'> & { body: Buffer }
  > = [];
  putFailure?: Error;
  rejectAfterPut?: Error;

  async putObject(input: PutRagSourceObjectInput): Promise<void> {
    if (this.putFailure) {
      throw this.putFailure;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of input.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    this.puts.push({
      abortSignal: input.abortSignal,
      body: Buffer.concat(chunks),
      contentType: input.contentType,
      objectKey: input.objectKey,
    });
    if (this.rejectAfterPut) {
      throw this.rejectAfterPut;
    }
  }

  async deleteObject(input: DeleteRagSourceObjectInput): Promise<void> {
    this.deletes.push(input);
  }
}

describe('RagUploadStreamService', () => {
  it('streams one UTF-8 TXT file, preserves ordering, and returns its digest', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);
    const content = Buffer.from('GateLM 사내 지식\n', 'utf8');
    const request = createMultipartRequest([
      {
        body: content,
        contentType: 'text/plain',
        filename: 'handbook.txt',
        name: 'file',
      },
      { body: Buffer.from('  직원 핸드북  ', 'utf8'), name: 'displayName' },
    ]);

    const result = await service.parseAndUpload(request, {
      maxBytes: 20 * 1024 * 1024,
      objectKey: OBJECT_KEY,
    });

    expect(result).toEqual({
      displayName: '직원 핸드북',
      fileExtension: 'txt',
      mimeType: 'text/plain',
      originalFilename: 'handbook.txt',
      sha256Digest: createHash('sha256').update(content).digest('hex'),
      sizeBytes: content.byteLength,
    });
    expect(store.puts).toHaveLength(1);
    expect(store.puts[0]).toMatchObject({
      body: content,
      contentType: 'text/plain',
      objectKey: OBJECT_KEY,
    });
  });

  it('accepts a 255-character non-ASCII display name within the 1024-byte contract', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);
    const displayName = '가'.repeat(255);

    const result = await service.parseAndUpload(
      createMultipartRequest([
        {
          body: Buffer.from('valid text', 'utf8'),
          contentType: 'text/plain',
          filename: 'policy.txt',
          name: 'file',
        },
        { body: Buffer.from(displayName, 'utf8'), name: 'displayName' },
      ]),
      { maxBytes: 1_024, objectKey: OBJECT_KEY },
    );

    expect(result.displayName).toBe(displayName);
  });

  it('canonicalizes surrounding filename whitespace before storage metadata is built', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);

    const result = await service.parseAndUpload(
      createMultipartRequest([
        {
          body: Buffer.from('valid text', 'utf8'),
          contentType: 'text/plain',
          filename: ' policy.txt ',
          name: 'file',
        },
      ]),
      { maxBytes: 1_024, objectKey: OBJECT_KEY },
    );

    expect(result.originalFilename).toBe('policy.txt');
  });

  it('accepts a PDF only when MIME, extension, and signature agree', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);
    const content = Buffer.from('%PDF-1.7\nminimal fixture', 'ascii');

    const result = await service.parseAndUpload(
      createMultipartRequest([
        {
          body: content,
          contentType: 'application/pdf',
          filename: 'POLICY.PDF',
          name: 'file',
        },
      ]),
      { maxBytes: 1_024, objectKey: OBJECT_KEY },
    );

    expect(result.fileExtension).toBe('pdf');
    expect(result.originalFilename).toBe('POLICY.PDF');
    expect(store.puts[0]?.body).toEqual(content);
  });

  it.each([
    {
      content: Buffer.alloc(0),
      expectedCode: 'RAG_UPLOAD_EMPTY_FILE',
      filename: 'empty.txt',
      mimeType: 'text/plain',
    },
    {
      content: Buffer.from('%PDF-1.7\nspoof', 'ascii'),
      expectedCode: 'RAG_UPLOAD_SIGNATURE_INVALID',
      filename: 'spoof.txt',
      mimeType: 'text/plain',
    },
    {
      content: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('%PDF-1.7\nspoof', 'ascii'),
      ]),
      expectedCode: 'RAG_UPLOAD_SIGNATURE_INVALID',
      filename: 'bom-spoof.txt',
      mimeType: 'text/plain',
    },
    {
      content: Buffer.from('not a pdf', 'utf8'),
      expectedCode: 'RAG_UPLOAD_SIGNATURE_INVALID',
      filename: 'spoof.pdf',
      mimeType: 'application/pdf',
    },
    {
      content: Buffer.from([0x61, 0x00, 0x62]),
      expectedCode: 'RAG_UPLOAD_TEXT_ENCODING_INVALID',
      filename: 'nul.txt',
      mimeType: 'text/plain',
    },
    {
      content: Buffer.from([0xc3, 0x28]),
      expectedCode: 'RAG_UPLOAD_TEXT_ENCODING_INVALID',
      filename: 'invalid-utf8.txt',
      mimeType: 'text/plain',
    },
  ])(
    'rejects invalid content with $expectedCode',
    async ({ content, expectedCode, filename, mimeType }) => {
      const store = new FakeRagObjectStore();
      const service = new RagUploadStreamService(store);

      await expect(
        service.parseAndUpload(
          createMultipartRequest([
            { body: content, contentType: mimeType, filename, name: 'file' },
          ]),
          { maxBytes: 1_024, objectKey: OBJECT_KEY },
        ),
      ).rejects.toMatchObject({ code: expectedCode });
    },
  );

  it('rejects path traversal before starting object storage', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);
    let caught: unknown;

    try {
      await service.parseAndUpload(
        createMultipartRequest([
          {
            body: Buffer.from('private', 'utf8'),
            contentType: 'text/plain',
            filename: '../private.txt',
            name: 'file',
          },
        ]),
        { maxBytes: 1_024, objectKey: OBJECT_KEY },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RagUploadException);
    expect(caught).toMatchObject({ code: 'RAG_UPLOAD_FILENAME_INVALID' });
    expect((caught as Error).message).not.toContain('private.txt');
    expect(store.puts).toHaveLength(0);
  });

  it('rejects MIME/extension mismatch before uploading', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);

    await expect(
      service.parseAndUpload(
        createMultipartRequest([
          {
            body: Buffer.from('plain text', 'utf8'),
            contentType: 'application/pdf',
            filename: 'notes.txt',
            name: 'file',
          },
        ]),
        { maxBytes: 1_024, objectKey: OBJECT_KEY },
      ),
    ).rejects.toMatchObject({ code: 'RAG_UPLOAD_MIME_MISMATCH' });
    expect(store.puts).toHaveLength(0);
  });

  it('rejects an unsupported extension before starting object storage', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);

    await expect(
      service.parseAndUpload(
        createMultipartRequest([
          {
            body: Buffer.from('plain text', 'utf8'),
            contentType: 'text/plain',
            filename: 'notes.md',
            name: 'file',
          },
        ]),
        { maxBytes: 1_024, objectKey: OBJECT_KEY },
      ),
    ).rejects.toMatchObject({ code: 'RAG_UPLOAD_UNSUPPORTED_FILE_TYPE' });
    expect(store.puts).toHaveLength(0);
    expect(store.deletes).toHaveLength(0);
  });

  it('enforces the configured streaming size limit', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);

    await expect(
      service.parseAndUpload(
        createMultipartRequest([
          {
            body: Buffer.from('12345', 'ascii'),
            contentType: 'text/plain',
            filename: 'large.txt',
            name: 'file',
          },
        ]),
        { maxBytes: 4, objectKey: OBJECT_KEY },
      ),
    ).rejects.toMatchObject({ code: 'RAG_UPLOAD_FILE_TOO_LARGE' });
  });

  it('rejects an oversized declared multipart request before object storage', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);
    const request = createRequestStream('gatelm-rag-size-boundary');
    request.headers['content-length'] = String(1_024 + 64 * 1_024 + 1);

    await expect(
      service.parseAndUpload(request as unknown as Request, {
        maxBytes: 1_024,
        objectKey: OBJECT_KEY,
      }),
    ).rejects.toMatchObject({ code: 'RAG_UPLOAD_FILE_TOO_LARGE' });

    expect(store.puts).toHaveLength(0);
  });

  it('accepts a file whose byte length exactly equals the configured limit', async () => {
    const store = new FakeRagObjectStore();
    const service = new RagUploadStreamService(store);
    const content = Buffer.from('12345', 'ascii');

    const result = await service.parseAndUpload(
      createMultipartRequest([
        {
          body: content,
          contentType: 'text/plain',
          filename: 'exact.txt',
          name: 'file',
        },
      ]),
      { maxBytes: content.byteLength, objectKey: OBJECT_KEY },
    );

    expect(result.sizeBytes).toBe(content.byteLength);
    expect(store.puts[0]?.body).toEqual(content);
  });

  it('logs only a stable event when parser-level compensation fails', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const store: RagObjectStore = {
      deleteObject: jest
        .fn()
        .mockRejectedValue(
          new Error(`raw delete error ${OBJECT_KEY} private-filename.txt`),
        ),
      putObject: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RagUploadStreamService(store);

    await expect(
      service.parseAndUpload(
        createMultipartRequest([
          {
            body: Buffer.from('valid text', 'utf8'),
            contentType: 'text/plain',
            filename: 'notes.txt',
            name: 'file',
          },
          { body: Buffer.from('unsupported', 'utf8'), name: 'other' },
        ]),
        { maxBytes: 1_024, objectKey: OBJECT_KEY },
      ),
    ).rejects.toMatchObject({ code: 'RAG_UPLOAD_UNEXPECTED_FIELD' });

    expect(store.deleteObject).toHaveBeenCalledTimes(1);
    const logOutput = JSON.stringify(logger.mock.calls);
    expect(logOutput).toContain('rag_upload_compensation_failed');
    expect(logOutput).toContain('RAG_OBJECT_DELETE_FAILED');
    expect(logOutput).not.toContain(OBJECT_KEY);
    expect(logOutput).not.toContain('private-filename.txt');
    logger.mockRestore();
  });

  it('normalizes provider failures without retaining the provider message', async () => {
    const store = new FakeRagObjectStore();
    store.putFailure = new Error('provider-secret-bucket raw failure');
    const service = new RagUploadStreamService(store);
    let caught: unknown;

    try {
      await service.parseAndUpload(
        createMultipartRequest([
          {
            body: Buffer.from('valid text', 'utf8'),
            contentType: 'text/plain',
            filename: 'notes.txt',
            name: 'file',
          },
        ]),
        { maxBytes: 1_024, objectKey: OBJECT_KEY },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'RAG_UPLOAD_STORAGE_UNAVAILABLE' });
    expect((caught as Error).message).not.toContain('provider-secret-bucket');
  });

  it('best-effort deletes when storage creates the object and then rejects', async () => {
    const store = new FakeRagObjectStore();
    store.rejectAfterPut = new Error('provider success response was lost');
    const service = new RagUploadStreamService(store);

    await expect(
      service.parseAndUpload(
        createMultipartRequest([
          {
            body: Buffer.from('valid text', 'utf8'),
            contentType: 'text/plain',
            filename: 'notes.txt',
            name: 'file',
          },
        ]),
        { maxBytes: 1_024, objectKey: OBJECT_KEY },
      ),
    ).rejects.toMatchObject({ code: 'RAG_UPLOAD_STORAGE_UNAVAILABLE' });

    expect(store.puts).toHaveLength(1);
    expect(store.deletes).toEqual([{ objectKey: OBJECT_KEY }]);
  });

  it('propagates a client abort to the object-store upload signal', async () => {
    let observedSignal: AbortSignal | undefined;
    const store: RagObjectStore = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
      putObject: jest.fn().mockImplementation(
        async ({ abortSignal }: PutRagSourceObjectInput): Promise<void> => {
          observedSignal = abortSignal;
          await waitForAbort(abortSignal);
          throw new Error('aborted by test double');
        },
      ),
    };
    const service = new RagUploadStreamService(store);
    const request = createOpenMultipartRequest({
      contentType: 'text/plain',
      filename: 'notes.txt',
      name: 'file',
    });
    const result = service.parseAndUpload(request, {
      maxBytes: 1_024,
      objectKey: OBJECT_KEY,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    request.emit('aborted');

    await expect(result).rejects.toMatchObject({ code: 'RAG_UPLOAD_ABORTED' });
    expect(observedSignal?.aborted).toBe(true);
  });
});

function createMultipartRequest(parts: MultipartPart[]): Request {
  const boundary = 'gatelm-rag-test-boundary';
  const request = createRequestStream(boundary);
  setImmediate(() => {
    for (const part of parts) {
      request.write(serializePart(boundary, part));
    }
    request.end(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  });
  return request as unknown as Request;
}

function createOpenMultipartRequest(part: Omit<MultipartPart, 'body'>): Request {
  const boundary = 'gatelm-rag-open-boundary';
  const request = createRequestStream(boundary);
  request.write(serializePartHeader(boundary, part));
  request.write(Buffer.from('partial', 'utf8'));
  return request as unknown as Request;
}

function createRequestStream(boundary: string): PassThrough & {
  headers: Record<string, string>;
} {
  const request = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
  };
  request.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
  return request;
}

function serializePart(boundary: string, part: MultipartPart): Buffer {
  return Buffer.concat([
    serializePartHeader(boundary, part),
    part.body,
    Buffer.from('\r\n', 'utf8'),
  ]);
}

function serializePartHeader(
  boundary: string,
  part: Omit<MultipartPart, 'body'>,
): Buffer {
  const disposition =
    part.filename === undefined
      ? `Content-Disposition: form-data; name="${part.name}"\r\n`
      : `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`;
  const contentType = part.contentType
    ? `Content-Type: ${part.contentType}\r\n`
    : '';
  return Buffer.from(
    `--${boundary}\r\n${disposition}${contentType}\r\n`,
    'utf8',
  );
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
