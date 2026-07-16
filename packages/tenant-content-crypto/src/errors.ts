export class ContentKeyUnavailable extends Error {
  readonly code = 'CHAT_CONTENT_KEY_UNAVAILABLE';

  constructor() {
    super('Tenant Chat content key is unavailable.');
    this.name = 'ContentKeyUnavailable';
  }
}

export class ContentIntegrityError extends Error {
  readonly code = 'CHAT_CONTENT_INTEGRITY_FAILED';

  constructor() {
    super('Tenant Chat content integrity validation failed.');
    this.name = 'ContentIntegrityError';
  }
}
