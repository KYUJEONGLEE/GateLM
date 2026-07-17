import { Readable } from 'node:stream';

import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import { RagObjectStoreError } from './object-store.port';
import {
  createRagSourceObjectKey,
  isRagSourceObjectKey,
} from './rag-object-key';
import { S3RagObjectStore } from './s3-rag-object-store';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const OBJECT_KEY = createRagSourceObjectKey(TENANT_ID, DOCUMENT_ID);

describe('S3RagObjectStore', () => {
  it('uses an opaque UUID key, explicit SSE-KMS, and no ACL or metadata', async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const upload = {
      abort: jest.fn().mockResolvedValue(undefined),
      done: jest.fn().mockResolvedValue({}),
    };
    const uploadFactory = jest.fn().mockImplementation((options) => {
      capturedOptions = options as Record<string, unknown>;
      return upload;
    });
    const client = createS3ClientDouble();
    const store = new S3RagObjectStore(
      client,
      {
        bucket: 'private-rag-bucket',
        kmsKeyId: 'alias/gatelm-rag-kms',
      },
      uploadFactory,
    );
    const abortController = new AbortController();
    const body = Readable.from(Buffer.from('streamed content', 'utf8'));

    await store.putObject({
      abortSignal: abortController.signal,
      body,
      contentType: 'text/plain',
      objectKey: OBJECT_KEY,
    });

    const params = capturedOptions?.params as Record<string, unknown>;
    expect(capturedOptions).toMatchObject({
      client,
      leavePartsOnError: false,
      partSize: 5 * 1024 * 1024,
      queueSize: 1,
    });
    expect(params).toMatchObject({
      Body: body,
      Bucket: 'private-rag-bucket',
      ContentType: 'text/plain',
      Key: OBJECT_KEY,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'alias/gatelm-rag-kms',
    });
    expect(params).not.toHaveProperty('ACL');
    expect(params).not.toHaveProperty('Metadata');
    expect(params).not.toHaveProperty('ContentDisposition');
  });

  it('aborts a managed upload when the caller signal is aborted', async () => {
    let rejectUpload: ((error: Error) => void) | undefined;
    const upload = {
      abort: jest.fn().mockImplementation(async () => {
        rejectUpload?.(new Error('raw provider abort detail'));
      }),
      done: jest.fn().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectUpload = reject;
          }),
      ),
    };
    const store = new S3RagObjectStore(
      createS3ClientDouble(),
      { bucket: 'private-rag-bucket', kmsKeyId: 'kms-key-id' },
      () => upload,
    );
    const abortController = new AbortController();
    const result = store.putObject({
      abortSignal: abortController.signal,
      body: Readable.from('text'),
      contentType: 'text/plain',
      objectKey: OBJECT_KEY,
    });

    await Promise.resolve();
    abortController.abort();

    await expect(result).rejects.toMatchObject({
      code: 'RAG_OBJECT_UPLOAD_ABORTED',
    });
    expect(upload.abort).toHaveBeenCalledTimes(1);
  });

  it('redacts provider upload failures', async () => {
    const store = new S3RagObjectStore(
      createS3ClientDouble(),
      { bucket: 'private-rag-bucket', kmsKeyId: 'kms-key-id' },
      () => ({
        abort: jest.fn().mockResolvedValue(undefined),
        done: jest
          .fn()
          .mockRejectedValue(new Error('bucket-name and provider response')),
      }),
    );
    let caught: unknown;

    try {
      await store.putObject({
        abortSignal: new AbortController().signal,
        body: Readable.from('text'),
        contentType: 'text/plain',
        objectKey: OBJECT_KEY,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RagObjectStoreError);
    expect(caught).toMatchObject({ code: 'RAG_OBJECT_UPLOAD_FAILED' });
    expect((caught as Error).message).not.toContain('bucket-name');
    expect((caught as Error).message).not.toContain('provider response');
  });

  it('redacts synchronous managed-upload construction failures', async () => {
    const store = new S3RagObjectStore(
      createS3ClientDouble(),
      { bucket: 'private-rag-bucket', kmsKeyId: 'kms-key-id' },
      () => {
        throw new Error('constructor leaked private bucket detail');
      },
    );
    let caught: unknown;

    try {
      await store.putObject({
        abortSignal: new AbortController().signal,
        body: Readable.from('text'),
        contentType: 'text/plain',
        objectKey: OBJECT_KEY,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'RAG_OBJECT_UPLOAD_FAILED' });
    expect((caught as Error).message).not.toContain('private bucket detail');
  });

  it('deletes only by the configured private bucket and opaque key', async () => {
    const client = createS3ClientDouble();
    const store = new S3RagObjectStore(client, {
      bucket: 'private-rag-bucket',
      kmsKeyId: 'kms-key-id',
    });

    await store.deleteObject({ objectKey: OBJECT_KEY });

    const command = (client.send as jest.Mock).mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toEqual({
      Bucket: 'private-rag-bucket',
      Key: OBJECT_KEY,
    });
  });

  it('rejects unsafe object keys without echoing them', async () => {
    const unsafeKey = 'rag/tenant/private-filename.txt';
    const store = new S3RagObjectStore(createS3ClientDouble(), {
      bucket: 'private-rag-bucket',
      kmsKeyId: 'kms-key-id',
    });
    let caught: unknown;

    try {
      await store.deleteObject({ objectKey: unsafeKey });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'RAG_OBJECT_CONFIGURATION_INVALID',
    });
    expect((caught as Error).message).not.toContain(unsafeKey);
  });

  it('fails safely when S3/KMS configuration is incomplete', () => {
    expect(
      () =>
        new S3RagObjectStore(createS3ClientDouble(), {
          bucket: '',
          kmsKeyId: 'provider-secret-value',
        }),
    ).toThrow(
      expect.objectContaining({ code: 'RAG_OBJECT_CONFIGURATION_INVALID' }),
    );
  });
});

describe('RAG source object key', () => {
  it('contains only the two UUIDs and the fixed source suffix', () => {
    expect(OBJECT_KEY).toBe(
      'rag/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/source',
    );
    expect(isRagSourceObjectKey(OBJECT_KEY)).toBe(true);
    expect(OBJECT_KEY).not.toMatch(/filename|title|tenant-name/u);
  });
});

function createS3ClientDouble(): S3Client {
  return {
    send: jest.fn().mockResolvedValue({}),
  } as unknown as S3Client;
}
