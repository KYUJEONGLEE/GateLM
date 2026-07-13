import { ConfigService } from '@nestjs/config';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { TenantChatProjectionService } from './tenant-chat-projection.service';

const tenantId = '00000000-0000-4000-8000-000000000100';
const userId = '00000000-0000-4000-8000-000000000101';
const employeeId = '00000000-0000-4000-8000-000000000102';
const eventId = '00000000-0000-4000-8000-000000000103';

describe('TenantChatProjectionService', () => {
  it('projects a settled event once and marks the outbox row published', async () => {
    const harness = createHarness(settledRow());

    await expect(harness.service.runOnce()).resolves.toBe(1);

    expect(harness.tx.tenantChatInvocationLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tenantId,
          userId,
          employeeId,
          surface: 'tenant_chat',
          executionScopeKind: 'tenant_chat',
          confirmedTotalTokens: 30n,
          confirmedCostMicroUsd: 50n,
        }),
      }),
    );
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publishedAt: expect.any(Date) }),
      }),
    );
  });

  it('retries a version gap without projecting the terminal event', async () => {
    const harness = createHarness(settledRow());
    harness.tx.tenantChatInvocationOutbox.findMany.mockResolvedValue([]);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).not.toHaveBeenCalled();
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: 'EVENT_VERSION_GAP' }),
      }),
    );
  });

  it('rejects an event whose tenant does not match its outbox envelope', async () => {
    const row = settledRow();
    row.payload.executionScope.tenantId =
      '00000000-0000-4000-8000-000000000999';
    const harness = createHarness(row);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).not.toHaveBeenCalled();
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: 'EVENT_ENVELOPE_MISMATCH',
        }),
      }),
    );
  });

  it('rejects raw content before writing the read model', async () => {
    const row = settledRow();
    (row.payload as Record<string, unknown>).content =
      'must never be projected';
    const harness = createHarness(row);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).not.toHaveBeenCalled();
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastErrorCode: 'FORBIDDEN_EVENT_DATA' }),
      }),
    );
  });

  it('publishes a replay without overwriting a newer projection', async () => {
    const harness = createHarness(settledRow());
    harness.tx.tenantChatInvocationLog.findUnique.mockResolvedValue({
      projectedEventVersion: 3n,
      tenantId,
    });

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).not.toHaveBeenCalled();
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publishedAt: expect.any(Date) }),
      }),
    );
  });

  it('projects a pre-ledger terminal event without a reservation', async () => {
    const row = terminalRow();
    const harness = createHarness(row);
    harness.tx.tenantChatUsageReservation.findUnique.mockResolvedValue(null);
    harness.tx.tenantChatRequestAdmission.findUnique.mockResolvedValue(null);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          terminalOutcome: 'rate_limited',
          snapshotDigest: `sha256:${'a'.repeat(43)}`,
          pricingVersion: 5n,
          latencyMs: 12n,
        }),
      }),
    );
  });
});

function createHarness(row: ReturnType<typeof settledRow>) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([row]),
    tenantChatInvocationOutbox: {
      findMany: jest.fn().mockResolvedValue([
        { eventVersion: 1n, publishedAt: new Date('2026-07-12T12:00:01Z') },
      ]),
      update: jest.fn().mockResolvedValue({}),
    },
    tenantChatInvocationLog: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    tenantChatUsageReservation: {
      findUnique: jest.fn().mockResolvedValue({
        pricingVersion: 5n,
        reservedAt: new Date('2026-07-12T12:00:01Z'),
        snapshotDigest: `sha256:${'a'.repeat(43)}`,
        snapshotVersion: 12n,
        tenantId,
      }),
    },
    tenantChatRequestAdmission: {
      findUnique: jest.fn().mockResolvedValue({
        createdAt: new Date('2026-07-12T12:00:00Z'),
        tenantId,
      }),
    },
    tenantChatRuntimeSnapshot: {
      findUnique: jest.fn().mockResolvedValue({
        digest: `sha256:${'a'.repeat(43)}`,
        pricingVersion: 5n,
        tenantId,
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as PrismaService;
  const values: Record<string, unknown> = {
    TENANT_CHAT_PROJECTOR_BATCH_SIZE: 50,
    TENANT_CHAT_PROJECTOR_ENABLED: 'false',
    TENANT_CHAT_PROJECTOR_INTERVAL_MS: 1000,
    TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS: 5,
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  return {
    service: new TenantChatProjectionService(prisma, config),
    tx,
  };
}

function settledRow() {
  return {
    eventId,
    tenantId,
    aggregateId: 'request_projection_001',
    eventType: 'usage_settled',
    eventVersion: 2n,
    payload: {
      eventId,
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
        tenantId,
        userId,
        actorKind: 'employee',
        employeeId,
      },
      period: {
        start: '2026-06-30T15:00:00Z',
        end: '2026-07-31T15:00:00Z',
        timezone: 'Asia/Seoul',
        currency: 'USD',
      },
      snapshotVersion: 12,
      pricingVersion: 5,
      quota: {
        state: 'normal',
        reservedTokensDelta: -100,
        confirmedInputTokensDelta: 20,
        confirmedOutputTokensDelta: 10,
        confirmedTotalTokensDelta: 30,
        unconfirmedTokensDelta: 0,
      },
      budget: {
        state: 'normal',
        reservedCostMicroUsdDelta: -100,
        confirmedCostMicroUsdDelta: 50,
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
          inputTokens: 20,
          outputTokens: 10,
          costMicroUsd: 50,
        },
      ],
      terminalOutcome: 'succeeded',
    },
    occurredAt: new Date('2026-07-12T12:00:02Z'),
    availableAt: new Date('2026-07-12T12:00:02Z'),
    publishedAt: null,
    deliveryAttempts: 0,
    lastErrorCode: null,
    createdAt: new Date('2026-07-12T12:00:02Z'),
  };
}

function terminalRow(): ReturnType<typeof settledRow> {
  const row = settledRow();
  row.eventType = 'invocation_terminal';
  row.eventVersion = 1n;
  row.payload = {
    eventId,
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
      tenantId,
      userId,
      actorKind: 'employee',
      employeeId,
    },
    snapshotVersion: 12,
    pricingVersion: 5,
    terminalOutcome: 'rate_limited',
    errorCode: 'CHAT_RATE_LIMITED',
    quotaState: 'normal',
    budgetState: 'normal',
    cacheOutcome: 'off',
    latencyMs: 12,
  } as unknown as ReturnType<typeof settledRow>['payload'];
  return row;
}
