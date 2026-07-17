const UUID_SEGMENT =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SEGMENT}$`, 'i');
const RAG_SOURCE_OBJECT_KEY_PATTERN = new RegExp(
  `^rag/${UUID_SEGMENT}/${UUID_SEGMENT}/source$`,
  'i',
);

export function createRagSourceObjectKey(
  tenantId: string,
  documentId: string,
): string {
  if (!UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(documentId)) {
    throw new Error('RAG source object key identifiers must be UUIDs.');
  }

  return `rag/${tenantId.toLowerCase()}/${documentId.toLowerCase()}/source`;
}

export function isRagSourceObjectKey(value: string): boolean {
  return RAG_SOURCE_OBJECT_KEY_PATTERN.test(value);
}

export function assertRagSourceObjectKey(value: string): void {
  if (!isRagSourceObjectKey(value)) {
    throw new Error('RAG source object key is invalid.');
  }
}
