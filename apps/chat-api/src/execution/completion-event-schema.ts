export const COMPLETION_EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'schemaVersion', 'requestId', 'turnId', 'sequence'],
  properties: {
    type: { enum: ['tenant_chat.delta', 'tenant_chat.final'] },
    schemaVersion: { const: 1 },
    requestId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
    turnId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
    sequence: { type: 'integer', minimum: 1 },
    delta: { type: 'string', minLength: 1, maxLength: 16384 },
    terminalOutcome: {
      enum: ['succeeded', 'failed', 'cancelled', 'cache_hit', 'quota_blocked', 'budget_blocked'],
    },
    effectiveModelKey: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' },
        { type: 'null' },
      ],
    },
    usage: {
      type: 'object',
      additionalProperties: false,
      required: ['inputTokens', 'outputTokens', 'totalTokens', 'usageQuality'],
      properties: {
        inputTokens: { type: 'integer', minimum: 0 },
        outputTokens: { type: 'integer', minimum: 0 },
        totalTokens: { type: 'integer', minimum: 0 },
        usageQuality: { enum: ['confirmed', 'pending_unconfirmed', 'not_available'] },
      },
    },
    quotaState: { enum: ['normal', 'warning', 'economy', 'blocked'] },
    budgetState: { enum: ['normal', 'warning', 'economy', 'blocked'] },
    cacheOutcome: { enum: ['off', 'hit', 'miss'] },
    replayed: { type: 'boolean' },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 64 },
        message: { type: 'string', minLength: 1, maxLength: 256 },
        retryAfterSeconds: { type: 'integer', minimum: 1, maximum: 300 },
      },
    },
  },
  allOf: [
    {
      if: { properties: { type: { const: 'tenant_chat.delta' } }, required: ['type'] },
      then: {
        required: ['delta'],
        not: {
          anyOf: [
            { required: ['terminalOutcome'] },
            { required: ['usage'] },
            { required: ['error'] },
          ],
        },
      },
    },
    {
      if: { properties: { type: { const: 'tenant_chat.final' } }, required: ['type'] },
      then: {
        required: [
          'terminalOutcome',
          'effectiveModelKey',
          'usage',
          'quotaState',
          'budgetState',
          'cacheOutcome',
          'replayed',
        ],
        not: { required: ['delta'] },
      },
    },
  ],
} as const;
