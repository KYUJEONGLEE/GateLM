import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';

import {
  RagObjectStoreError,
  type DeleteRagSourceObjectInput,
  type GetRagSourceObjectInput,
  type PutRagSourceObjectInput,
  type RagObjectStore,
} from './object-store.port';
import { assertRagSourceObjectKey } from './rag-object-key';

const MINIMUM_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

export interface S3RagObjectStoreConfig {
  bucket: string;
  kmsKeyId: string;
  partSizeBytes?: number;
  queueSize?: number;
}

interface ManagedUploadHandle {
  abort(): Promise<void>;
  done(): Promise<unknown>;
}

type ManagedUploadOptions = ConstructorParameters<typeof Upload>[0];
type ManagedUploadFactory = (
  options: ManagedUploadOptions,
) => ManagedUploadHandle;

const createManagedUpload: ManagedUploadFactory = (options) =>
  new Upload(options);

export class S3RagObjectStore implements RagObjectStore {
  private readonly bucket: string;
  private readonly kmsKeyId: string;
  private readonly partSizeBytes: number;
  private readonly queueSize: number;

  constructor(
    private readonly client: S3Client,
    config: S3RagObjectStoreConfig,
    private readonly uploadFactory: ManagedUploadFactory = createManagedUpload,
  ) {
    this.bucket = config.bucket.trim();
    this.kmsKeyId = config.kmsKeyId.trim();
    this.partSizeBytes =
      config.partSizeBytes ?? MINIMUM_MULTIPART_PART_SIZE_BYTES;
    this.queueSize = config.queueSize ?? 1;
    this.validateConfiguration();
  }

  async putObject(input: PutRagSourceObjectInput): Promise<void> {
    this.assertObjectKey(input.objectKey);
    if (input.abortSignal.aborted) {
      throw new RagObjectStoreError('RAG_OBJECT_UPLOAD_ABORTED');
    }

    let upload: ManagedUploadHandle;
    try {
      upload = this.uploadFactory({
        client: this.client,
        leavePartsOnError: false,
        params: {
          Body: input.body,
          Bucket: this.bucket,
          ContentType: input.contentType,
          Key: input.objectKey,
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: this.kmsKeyId,
        },
        partSize: this.partSizeBytes,
        queueSize: this.queueSize,
      });
    } catch {
      throw new RagObjectStoreError('RAG_OBJECT_UPLOAD_FAILED');
    }
    const abortUpload = (): void => {
      void upload.abort().catch(() => undefined);
    };
    input.abortSignal.addEventListener('abort', abortUpload, { once: true });

    try {
      await upload.done();
    } catch {
      throw new RagObjectStoreError(
        input.abortSignal.aborted
          ? 'RAG_OBJECT_UPLOAD_ABORTED'
          : 'RAG_OBJECT_UPLOAD_FAILED',
      );
    } finally {
      input.abortSignal.removeEventListener('abort', abortUpload);
    }
  }

  async deleteObject(input: DeleteRagSourceObjectInput): Promise<void> {
    this.assertObjectKey(input.objectKey);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: input.objectKey,
        }),
      );
    } catch {
      throw new RagObjectStoreError('RAG_OBJECT_DELETE_FAILED');
    }
  }

  async getObject(input: GetRagSourceObjectInput): Promise<Readable> {
    this.assertObjectKey(input.objectKey);
    if (input.abortSignal.aborted) {
      throw new RagObjectStoreError('RAG_OBJECT_READ_ABORTED');
    }
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }),
        { abortSignal: input.abortSignal },
      );
      if (!(response.Body instanceof Readable)) {
        throw new Error('source body is unavailable');
      }
      return response.Body;
    } catch {
      throw new RagObjectStoreError(
        input.abortSignal.aborted
          ? 'RAG_OBJECT_READ_ABORTED'
          : 'RAG_OBJECT_READ_FAILED',
      );
    }
  }

  private assertObjectKey(objectKey: string): void {
    try {
      assertRagSourceObjectKey(objectKey);
    } catch {
      throw new RagObjectStoreError('RAG_OBJECT_CONFIGURATION_INVALID');
    }
  }

  private validateConfiguration(): void {
    if (
      this.bucket.length === 0 ||
      this.kmsKeyId.length === 0 ||
      !Number.isSafeInteger(this.partSizeBytes) ||
      this.partSizeBytes < MINIMUM_MULTIPART_PART_SIZE_BYTES ||
      !Number.isSafeInteger(this.queueSize) ||
      this.queueSize < 1 ||
      this.queueSize > 8
    ) {
      throw new RagObjectStoreError('RAG_OBJECT_CONFIGURATION_INVALID');
    }
  }
}
