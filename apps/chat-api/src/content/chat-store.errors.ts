export class ConversationNotFound extends Error {
  constructor() {
    super('Tenant Chat conversation was not found.');
    this.name = 'ConversationNotFound';
  }
}

export class ConversationVersionConflict extends Error {
  constructor() {
    super('Tenant Chat conversation version conflicted.');
    this.name = 'ConversationVersionConflict';
  }
}

export class IdempotencyConflict extends Error {
  constructor() {
    super('Tenant Chat idempotency binding conflicted.');
    this.name = 'IdempotencyConflict';
  }
}

export class TurnStateConflict extends Error {
  constructor() {
    super('Tenant Chat turn state conflicted.');
    this.name = 'TurnStateConflict';
  }
}
