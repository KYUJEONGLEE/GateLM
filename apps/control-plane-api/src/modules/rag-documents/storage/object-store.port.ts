import type { Readable } from 'node:stream';

export const RAG_OBJECT_STORE = Symbol('RAG_OBJECT_STORE');

export type RagSourceMimeType = 'application/pdf' | 'text/plain';

export interface PutRagSourceObjectInput {
  abortSignal: AbortSignal;
  body: Readable;
  contentType: RagSourceMimeType;
  objectKey: string;
}

export interface DeleteRagSourceObjectInput {
  objectKey: string;
}

export interface GetRagSourceObjectInput {
  abortSignal: AbortSignal;
  objectKey: string;
}

export interface RagObjectStore {
  putObject(input: PutRagSourceObjectInput): Promise<void>;
  deleteObject(input: DeleteRagSourceObjectInput): Promise<void>;
  /**
   * Worker-only source retrieval. It is optional so existing upload-only local
   * fakes remain explicit test doubles; a running worker fails closed when the
   * configured store does not provide it.
   */
  getObject?(input: GetRagSourceObjectInput): Promise<Readable>;
}

export type RagObjectStoreErrorCode =
  | 'RAG_OBJECT_CONFIGURATION_INVALID'
  | 'RAG_OBJECT_DELETE_FAILED'
  | 'RAG_OBJECT_READ_ABORTED'
  | 'RAG_OBJECT_READ_FAILED'
  | 'RAG_OBJECT_UPLOAD_ABORTED'
  | 'RAG_OBJECT_UPLOAD_FAILED';

const SAFE_MESSAGES: Readonly<Record<RagObjectStoreErrorCode, string>> = {
  RAG_OBJECT_CONFIGURATION_INVALID: 'RAG object storage configuration is invalid.',
  RAG_OBJECT_DELETE_FAILED: 'RAG source object deletion failed.',
  RAG_OBJECT_READ_ABORTED: 'RAG source object read was aborted.',
  RAG_OBJECT_READ_FAILED: 'RAG source object read failed.',
  RAG_OBJECT_UPLOAD_ABORTED: 'RAG source object upload was aborted.',
  RAG_OBJECT_UPLOAD_FAILED: 'RAG source object upload failed.',
};

/**
 * Adapter errors intentionally retain neither provider messages nor object
 * locations. Callers may branch on the stable code without leaking AWS data.
 */
export class RagObjectStoreError extends Error {
  override readonly name = 'RagObjectStoreError';

  constructor(readonly code: RagObjectStoreErrorCode) {
    super(SAFE_MESSAGES[code]);
  }
}
