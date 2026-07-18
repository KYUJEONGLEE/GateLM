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
          cacheOutcome: 'off',
          routingDifficulty: 'complex',
        }),
      }),
    );
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publishedAt: expect.any(Date) }),
      }),
    );
  });

  it('projects an explicit v3 cache outcome instead of the reservation fallback', async () => {
    const row = settledRow();
    row.payload.schemaVersion = 3;
    Object.assign(row.payload, { cacheOutcome: 'miss' });
    Object.assign(row.payload, { routingDifficulty: 'complex' });
    const harness = createHarness(row);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publishedAt: expect.any(Date) }),
      }),
    );
    expect(harness.tx.tenantChatInvocationLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ cacheOutcome: 'miss' }),
      }),
    );
  });

  it('rejects routing difficulty that conflicts with the fixed reservation', async () => {
    const row = settledRow();
    row.payload.schemaVersion = 3;
    Object.assign(row.payload, {
      cacheOutcome: 'miss',
      routingDifficulty: 'simple',
    });
    const harness = createHarness(row);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).not.toHaveBeenCalled();
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: 'PROJECTION_SOURCE_MISMATCH',
        }),
      }),
    );
  });

  it('projects the content-free safety summary from a v3 terminal usage event', async () => {
    const row = settledRow();
    row.payload.schemaVersion = 3;
    Object.assign(row.payload, {
      cacheOutcome: 'miss',
      maskingAction: 'redacted',
      maskingDetectedTypes: ['email', 'phone_number'],
      maskingDetectedCount: 2,
      safetyPolicyDigest: `sha256:${'A'.repeat(43)}`,
    });
    const harness = createHarness(row);
    harness.tx.tenantChatRequestAdmission.findUnique.mockResolvedValue({
      ...admissionSource(),
      maskingAction: 'redacted',
      maskingDetectedTypes: ['email', 'phone_number'],
      maskingDetectedCount: 2,
      safetyPolicyDigest: `sha256:${'A'.repeat(43)}`,
    });

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          maskingAction: 'redacted',
          maskingDetectedTypes: ['email', 'phone_number'],
          maskingDetectedCount: 2,
          safetyPolicyDigest: `sha256:${'A'.repeat(43)}`,
        }),
      }),
    );
  });

  it('does not add rollup writes while the dashboard rollup flag is disabled', async () => {
    const harness = createHarness(settledRow());

    await expect(harness.service.runOnce()).resolves.toBe(1);

    expect(harness.tx.$executeRaw).not.toHaveBeenCalled();
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

  it('defers a version whose predecessor is still pending without consuming an attempt', async () => {
    const harness = createHarness(settledRow());
    harness.tx.tenantChatInvocationOutbox.findMany.mockResolvedValue([
      { eventVersion: 1n, publishedAt: null, lastErrorCode: null },
    ]);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).not.toHaveBeenCalled();
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: 'EVENT_VERSION_PENDING',
        }),
      }),
    );
    expect(
      harness.tx.tenantChatInvocationOutbox.update.mock.calls[0]?.[0].data,
    ).not.toHaveProperty('deliveryAttempts');
  });

  it('counts a predecessor DLQ as a bounded projection failure', async () => {
    const harness = createHarness(settledRow());
    harness.tx.tenantChatInvocationOutbox.findMany.mockResolvedValue([
      {
        eventVersion: 1n,
        publishedAt: null,
        lastErrorCode: 'DLQ_PROJECTION_FAILED',
      },
    ]);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryAttempts: 1,
          lastErrorCode: 'EVENT_VERSION_BLOCKED',
        }),
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

  it('projects a pre-ledger terminal event from its admission without a reservation', async () => {
    const row = terminalRow();
    const harness = createHarness(row);
    harness.tx.tenantChatUsageReservation.findUnique.mockResolvedValue(null);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          terminalOutcome: 'rate_limited',
          snapshotDigest: `sha256:${'a'.repeat(43)}`,
          pricingVersion: 5n,
          latencyMs: 12n,
          ttftMs: null,
        }),
      }),
    );
  });

  it('projects a cache-hit TTFT from a v2 ledgerless terminal event', async () => {
    const row = terminalRow();
    row.payload.schemaVersion = 2;
    Object.assign(row.payload, {
      cacheOutcome: 'hit',
      terminalOutcome: 'cache_hit',
      ttftMs: 0,
    });
    const harness = createHarness(row);
    harness.tx.tenantChatUsageReservation.findUnique.mockResolvedValue(null);

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ttftMs: 0n }),
      }),
    );
  });

  it('fails closed when the event identity differs from its admission', async () => {
    const harness = createHarness(settledRow());
    harness.tx.tenantChatRequestAdmission.findUnique.mockResolvedValue({
      ...admissionSource(),
      userId: '00000000-0000-4000-8000-000000000999',
    });

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).not.toHaveBeenCalled();
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: 'PROJECTION_SOURCE_MISMATCH',
        }),
      }),
    );
  });

  it('fails closed when reservation and runtime snapshot provenance differ', async () => {
    const harness = createHarness(settledRow());
    harness.tx.tenantChatUsageReservation.findUnique.mockResolvedValue({
      ...reservationSource(),
      snapshotDigest: `sha256:${'b'.repeat(43)}`,
    });

    await harness.service.runOnce();

    expect(harness.tx.tenantChatInvocationLog.upsert).not.toHaveBeenCalled();
    expect(harness.tx.tenantChatInvocationOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: 'PROJECTION_SOURCE_MISMATCH',
        }),
      }),
    );
  });

  it.each([2, 3])(
    'accumulates a v%d late usage settlement onto confirmed totals',
    async (schemaVersion) => {
      const row = lateSettledRow();
      row.payload.schemaVersion = schemaVersion;
      if (schemaVersion === 3) {
        Object.assign(row.payload, { cacheOutcome: 'off' });
      }
      const harness = createHarness(row);
      harness.tx.tenantChatInvocationOutbox.findMany.mockResolvedValue([
        { eventVersion: 1n, publishedAt: new Date(), lastErrorCode: null },
        { eventVersion: 2n, publishedAt: new Date(), lastErrorCode: null },
      ]);
      harness.tx.tenantChatInvocationLog.findUnique.mockResolvedValue({
        projectedEventVersion: 2n,
        tenantId,
        confirmedInputTokens: 20n,
        confirmedOutputTokens: 10n,
        confirmedTotalTokens: 30n,
        confirmedCostMicroUsd: 50n,
      });

      await harness.service.runOnce();

      expect(harness.tx.tenantChatInvocationLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            confirmedInputTokens: 24n,
            confirmedOutputTokens: 12n,
            confirmedTotalTokens: 36n,
            confirmedCostMicroUsd: 60n,
            projectedEventVersion: 3n,
          }),
        }),
      );
    },
  );

  it('marks both old and new UTC hours dirty when a late correction moves buckets', async () => {
    const row = lateSettledRow();
    row.payload.occurredAt = '2026-07-13T14:00:02Z';
    const harness = createHarness(row, true);
    harness.tx.tenantChatInvocationOutbox.findMany.mockResolvedValue([
      { eventVersion: 1n, publishedAt: new Date(), lastErrorCode: null },
      { eventVersion: 2n, publishedAt: new Date(), lastErrorCode: null },
    ]);
    harness.tx.tenantChatInvocationLog.findUnique.mockResolvedValue({
      projectedEventVersion: 2n,
      tenantId,
      confirmedInputTokens: 20n,
      confirmedOutputTokens: 10n,
      confirmedTotalTokens: 30n,
      confirmedCostMicroUsd: 50n,
      completedAt: new Date('2026-07-12T12:00:02Z'),
    });

    await harness.service.runOnce();

    expect(harness.tx.$executeRaw).toHaveBeenCalledTimes(6);
  });

  it('does not schedule another batch after module destruction', async () => {
    jest.useFakeTimers();
    const harness = createHarness(settledRow());
    let finishRun: ((value: number) => void) | undefined;
    jest.spyOn(harness.service, 'runOnce').mockImplementation(
      () => new Promise<number>((resolve) => {
        finishRun = resolve;
      }),
    );

    (
      harness.service as unknown as { schedule: (delayMs: number) => void }
    ).schedule(0);
    jest.advanceTimersByTime(0);
    harness.service.onModuleDestroy();
    finishRun?.(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});

function createHarness(
  row: ReturnType<typeof settledRow>,
  dashboardRollupEnabled = false,
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValueOnce([row]).mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    tenantChatInvocationOutbox: {
      findMany: jest.fn().mockResolvedValue([
        {
          eventVersion: 1n,
          publishedAt: new Date('2026-07-12T12:00:01Z'),
          lastErrorCode: null,
        },
      ]),
      update: jest.fn().mockResolvedValue({}),
    },
    tenantChatInvocationLog: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    tenantChatUsageReservation: {
      findUnique: jest.fn().mockResolvedValue(reservationSource()),
    },
    tenantChatRequestAdmission: {
      findUnique: jest.fn().mockResolvedValue(admissionSource()),
    },
    tenantChatRuntimeSnapshot: {
      findUnique: jest.fn().mockResolvedValue({
        digest: `sha256:${'a'.repeat(43)}`,
        pricingVersion: 5n,
        tenantId,
        version: 12n,
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
    DASHBOARD_ROLLUP_ENABLED: dashboardRollupEnabled ? 'true' : 'false',
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  return {
    service: new TenantChatProjectionService(prisma, config),
    tx,
  };
}

function reservationSource() {
  return {
    cacheOutcome: 'off',
    idempotencyKey: 'idempotency_projection_001',
    pricingVersion: 5n,
    requestId: 'request_projection_001',
    reservationId: 'reservation_projection_001',
    routingDifficulty: 'complex',
    reservedAt: new Date('2026-07-12T12:00:01Z'),
    snapshotDigest: `sha256:${'a'.repeat(43)}`,
    snapshotVersion: 12n,
    tenantId,
    turnId: 'turn_projection_001',
    userId,
  };
}

function admissionSource() {
  return {
    actorKind: 'employee',
    bindingDigest: `hmac-sha256:${'A'.repeat(43)}`,
    createdAt: new Date('2026-07-12T12:00:00Z'),
    employeeId,
    idempotencyKey: 'idempotency_projection_001',
    maskingAction: null,
    maskingDetectedTypes: null,
    maskingDetectedCount: null,
    requestId: 'request_projection_001',
    safetyPolicyDigest: null,
    snapshotVersion: 12n,
    tenantId,
    turnId: 'turn_projection_001',
    userId,
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

function lateSettledRow(): ReturnType<typeof settledRow> {
  const row = settledRow();
  row.eventVersion = 3n;
  row.payload.schemaVersion = 2;
  row.payload.eventVersion = 3;
  row.payload.occurredAt = '2026-07-12T12:20:00Z';
  row.payload.quota = {
    state: 'normal',
    reservedTokensDelta: 0,
    confirmedInputTokensDelta: 4,
    confirmedOutputTokensDelta: 2,
    confirmedTotalTokensDelta: 6,
    unconfirmedTokensDelta: -100,
  };
  row.payload.budget = {
    state: 'normal',
    reservedCostMicroUsdDelta: 0,
    confirmedCostMicroUsdDelta: 10,
    unconfirmedExposureMicroUsdDelta: -100,
  };
  Object.assign(row.payload, { lateUsage: true });
  return row;
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
