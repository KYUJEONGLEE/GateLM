import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateTenantChatProjectionEvent } from './tenant-chat-projection.contract';
import invocationTerminalEventSchema = require('./invocation-terminal-event.schema.json');
import invocationTerminalEventV2Schema = require('./invocation-terminal-event-v2.schema.json');
import usageSettlementEventSchema = require('./usage-settlement-event.schema.json');
import usageSettlementEventV2Schema = require('./usage-settlement-event-v2.schema.json');
import usageSettlementEventV3Schema = require('./usage-settlement-event-v3.schema.json');

describe('Tenant Chat projection event contract', () => {
  it.each([
    ['usage settlement', 'usage-settlement-event.schema.json', usageSettlementEventSchema],
    ['invocation terminal', 'invocation-terminal-event.schema.json', invocationTerminalEventSchema],
    ['usage settlement v2', 'usage-settlement-event-v2.schema.json', usageSettlementEventV2Schema],
    ['usage settlement v3', 'usage-settlement-event-v3.schema.json', usageSettlementEventV3Schema],
    ['invocation terminal v2', 'invocation-terminal-event-v2.schema.json', invocationTerminalEventV2Schema],
  ])('executes the active %s schema without drift', (_label, fileName, runtimeSchema) => {
    const contractSchema = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          `../../../../../docs/tenant-chat/schemas/${fileName}`,
        ),
        'utf8',
      ),
    ) as unknown;

    expect(runtimeSchema).toEqual(contractSchema);
  });

  it('rejects additional properties in a terminal event', () => {
    const payload = terminalEvent();
    (payload as Record<string, unknown>).prompt = 'forbidden';

    expect(() => validateTenantChatProjectionEvent(payload)).toThrow(
      'projection event schema validation failed',
    );
  });

  it.each(['gpt-5.4-mini', 'models/gemini-2.5-flash', 'provider:model.v1'])(
    'accepts the canonical model key %s in bounded cache provenance',
    (modelKey) => {
      const payload = {
        ...terminalEvent(),
        schemaVersion: 2,
        terminalOutcome: 'cache_hit',
        cacheOutcome: 'hit',
        effectiveProviderId: 'provider_001',
        effectiveModelKey: modelKey,
        effectiveRouteTier: 'high_quality',
        routingDifficulty: 'complex',
        savedCostMicroUsd: 425,
      };
      delete (payload as { errorCode?: string }).errorCode;

      expect(() => validateTenantChatProjectionEvent(payload)).not.toThrow();
    },
  );

  it('rejects an unbounded cache model key', () => {
    const payload = {
      ...terminalEvent(),
      schemaVersion: 2,
      terminalOutcome: 'cache_hit',
      cacheOutcome: 'hit',
      effectiveProviderId: 'provider_001',
      effectiveModelKey: 'gpt model',
      savedCostMicroUsd: 425,
    };
    delete (payload as { errorCode?: string }).errorCode;

    expect(() => validateTenantChatProjectionEvent(payload)).toThrow(
      'projection event schema validation failed',
    );
  });

  it('accepts only simple or complex as routing difficulty', () => {
    const payload = {
      ...usageSettledEvent(),
      schemaVersion: 3,
      cacheOutcome: 'off',
      routingDifficulty: 'complex',
    };
    expect(() => validateTenantChatProjectionEvent(payload)).not.toThrow();

    payload.routingDifficulty = 'high_quality';
    expect(() => validateTenantChatProjectionEvent(payload)).toThrow(
      'projection event schema validation failed',
    );
  });

  it('enforces the usage event conditional attempt rules', () => {
    const payload = usageSettledEvent();
    payload.attempts = [];

    expect(() => validateTenantChatProjectionEvent(payload)).toThrow(
      'projection event schema validation failed',
    );
  });

  it('accepts a v2 late settlement with a negative unconfirmed delta', () => {
    const payload = usageSettledEvent();
    payload.schemaVersion = 2;
    payload.quota.reservedTokensDelta = 0;
    payload.quota.unconfirmedTokensDelta = -10;
    payload.budget.reservedCostMicroUsdDelta = 0;
    payload.budget.unconfirmedExposureMicroUsdDelta = -10;
    Object.assign(payload, { lateUsage: true });

    expect(() => validateTenantChatProjectionEvent(payload)).not.toThrow();
  });

  it('requires bounded cache provenance in a v3 usage event', () => {
    const payload = usageSettledEvent() as ReturnType<typeof usageSettledEvent> & {
      cacheOutcome?: string;
    };
    payload.schemaVersion = 3;
    payload.cacheOutcome = 'miss';
    expect(() => validateTenantChatProjectionEvent(payload)).not.toThrow();

    delete payload.cacheOutcome;
    expect(() => validateTenantChatProjectionEvent(payload)).toThrow(
      'projection event schema validation failed',
    );
  });

  it('accepts only a complete content-free safety summary bundle', () => {
    const payload = terminalEvent() as ReturnType<typeof terminalEvent> & {
      maskingAction?: string;
      maskingDetectedTypes?: string[];
      maskingDetectedCount?: number;
      safetyPolicyDigest?: string;
    };
    payload.schemaVersion = 2;
    payload.maskingAction = 'redacted';
    payload.maskingDetectedTypes = ['email', 'phone_number'];
    payload.maskingDetectedCount = 2;
    payload.safetyPolicyDigest = `sha256:${'A'.repeat(43)}`;
    expect(() => validateTenantChatProjectionEvent(payload)).not.toThrow();

    delete payload.maskingDetectedTypes;
    expect(() => validateTenantChatProjectionEvent(payload)).toThrow(
      'projection event schema validation failed',
    );
  });

  it('accepts TTFT only on terminal v3 usage and v2 invocation events', () => {
    const usage = usageSettledEvent() as ReturnType<typeof usageSettledEvent> & {
      cacheOutcome?: string;
      ttftMs?: number;
    };
    usage.schemaVersion = 3;
    usage.cacheOutcome = 'miss';
    usage.ttftMs = 184;
    expect(() => validateTenantChatProjectionEvent(usage)).not.toThrow();

    const terminal = terminalEvent() as ReturnType<typeof terminalEvent> & {
      ttftMs?: number;
    };
    terminal.schemaVersion = 2;
    terminal.ttftMs = 0;
    expect(() => validateTenantChatProjectionEvent(terminal)).not.toThrow();

    const reservation = {
      ...usage,
      eventType: 'usage_reserved',
      attempts: [],
      quota: {
        ...usage.quota,
        reservedTokensDelta: 10,
        confirmedInputTokensDelta: 0,
        confirmedOutputTokensDelta: 0,
        confirmedTotalTokensDelta: 0,
        unconfirmedTokensDelta: 0,
      },
      budget: {
        ...usage.budget,
        reservedCostMicroUsdDelta: 0,
        confirmedCostMicroUsdDelta: 0,
        unconfirmedExposureMicroUsdDelta: 0,
      },
    };
    delete (reservation as { terminalOutcome?: string }).terminalOutcome;
    expect(() => validateTenantChatProjectionEvent(reservation)).toThrow(
      'projection event schema validation failed',
    );
  });

  it.each([1, 2, 3])(
    'accepts a v%d reservation with zero monetary cost',
    (schemaVersion) => {
      const payload = {
        ...usageSettledEvent(),
        schemaVersion,
        eventType: 'usage_reserved',
        eventVersion: 1,
        quota: {
          state: 'normal',
          reservedTokensDelta: 10,
          confirmedInputTokensDelta: 0,
          confirmedOutputTokensDelta: 0,
          confirmedTotalTokensDelta: 0,
          unconfirmedTokensDelta: 0,
        },
        budget: {
          state: 'normal',
          reservedCostMicroUsdDelta: 0,
          confirmedCostMicroUsdDelta: 0,
          unconfirmedExposureMicroUsdDelta: 0,
        },
        attempts: [],
      };
      if (schemaVersion === 3) {
        Object.assign(payload, { cacheOutcome: 'off' });
      }
      delete (payload as { terminalOutcome?: string }).terminalOutcome;

      expect(() => validateTenantChatProjectionEvent(payload)).not.toThrow();
    },
  );
});

function terminalEvent() {
  return {
    eventId: 'event_projection_001',
    schemaVersion: 1,
    eventType: 'invocation_terminal',
    eventVersion: 1,
    occurredAt: '2026-07-12T12:00:02Z',
    aggregateId: 'request_projection_001',
    requestId: 'request_projection_001',
    turnId: 'turn_projection_001',
    idempotencyKey: 'idempotency_projection_001',
    executionScope: {
      kind: 'tenant_chat',
      tenantId: '00000000-0000-4000-8000-000000000100',
      userId: '00000000-0000-4000-8000-000000000101',
      actorKind: 'tenant_admin',
    },
    snapshotVersion: 1,
    pricingVersion: 1,
    terminalOutcome: 'rate_limited',
    errorCode: 'CHAT_RATE_LIMITED',
    quotaState: 'normal',
    budgetState: 'normal',
    cacheOutcome: 'off',
    latencyMs: 10,
  };
}

function usageSettledEvent() {
  return {
    eventId: 'event_projection_001',
    schemaVersion: 1,
    eventType: 'usage_settled',
    eventVersion: 2,
    occurredAt: '2026-07-12T12:00:02Z',
    aggregateId: 'request_projection_001',
    requestId: 'request_projection_001',
    turnId: 'turn_projection_001',
    idempotencyKey: 'idempotency_projection_001',
    reservationId: 'reservation_projection_001',
    executionScope: {
      kind: 'tenant_chat',
      tenantId: '00000000-0000-4000-8000-000000000100',
      userId: '00000000-0000-4000-8000-000000000101',
      actorKind: 'tenant_admin',
    },
    period: {
      start: '2026-07-01T00:00:00Z',
      end: '2026-08-01T00:00:00Z',
      timezone: 'UTC',
      currency: 'USD',
    },
    snapshotVersion: 1,
    pricingVersion: 1,
    quota: {
      state: 'normal',
      reservedTokensDelta: -10,
      confirmedInputTokensDelta: 5,
      confirmedOutputTokensDelta: 5,
      confirmedTotalTokensDelta: 10,
      unconfirmedTokensDelta: 0,
    },
    budget: {
      state: 'normal',
      reservedCostMicroUsdDelta: -10,
      confirmedCostMicroUsdDelta: 10,
      unconfirmedExposureMicroUsdDelta: 0,
    },
    attempts: [
      {
        attemptNo: 1,
        kind: 'primary',
        providerId: 'provider_mock',
        modelKey: 'model_mock',
        outcome: 'succeeded',
        usageQuality: 'confirmed',
        inputTokens: 5,
        outputTokens: 5,
        costMicroUsd: 10,
      },
    ],
    terminalOutcome: 'succeeded',
  };
}
