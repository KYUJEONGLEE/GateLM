import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateTenantChatProjectionEvent } from './tenant-chat-projection.contract';
import invocationTerminalEventSchema = require('./invocation-terminal-event.schema.json');
import usageSettlementEventSchema = require('./usage-settlement-event.schema.json');

describe('Tenant Chat projection event contract', () => {
  it.each([
    ['usage settlement', 'usage-settlement-event.schema.json', usageSettlementEventSchema],
    ['invocation terminal', 'invocation-terminal-event.schema.json', invocationTerminalEventSchema],
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

  it('enforces the usage event conditional attempt rules', () => {
    const payload = usageSettledEvent();
    payload.attempts = [];

    expect(() => validateTenantChatProjectionEvent(payload)).toThrow(
      'projection event schema validation failed',
    );
  });
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
