export class RagRetrievalError extends Error {
  constructor(
    readonly code: string,
    readonly status: number = 503,
    message = 'Tenant knowledge retrieval is unavailable.',
  ) {
    super(message);
    this.name = 'RagRetrievalError';
  }
}

export class RagRetrievalDisabledError extends RagRetrievalError {
  constructor() { super('RAG_RETRIEVAL_DISABLED', 503); this.name = 'RagRetrievalDisabledError'; }
}

export class RagRetrievalIntegrityError extends RagRetrievalError {
  constructor() { super('RAG_RETRIEVAL_INTEGRITY_FAILED', 503); this.name = 'RagRetrievalIntegrityError'; }
}
