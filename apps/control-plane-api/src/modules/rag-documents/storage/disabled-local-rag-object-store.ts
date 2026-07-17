import type {
  DeleteRagSourceObjectInput,
  GetRagSourceObjectInput,
  PutRagSourceObjectInput,
  RagObjectStore,
} from './object-store.port';
import { RagObjectStoreError } from './object-store.port';

/**
 * Safe local default. Tests replace the port with an explicit fake, while a
 * developer who wants durable uploads configures an S3-compatible endpoint.
 */
export class DisabledLocalRagObjectStore implements RagObjectStore {
  putObject(_input: PutRagSourceObjectInput): Promise<void> {
    return Promise.reject(new RagObjectStoreError('RAG_OBJECT_UPLOAD_FAILED'));
  }

  deleteObject(_input: DeleteRagSourceObjectInput): Promise<void> {
    return Promise.resolve();
  }

  getObject(_input: GetRagSourceObjectInput): Promise<never> {
    return Promise.reject(new RagObjectStoreError('RAG_OBJECT_READ_FAILED'));
  }
}
