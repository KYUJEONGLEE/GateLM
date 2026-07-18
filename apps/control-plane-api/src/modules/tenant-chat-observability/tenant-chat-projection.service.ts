import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TenantChatInvocationOutbox } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import {
  enqueueDashboardRollupDirtyHierarchy,
  utcBucketStart,
} from '@/modules/dashboard-rollup/dashboard-rollup.service';

import {
  TENANT_CHAT_EVENT_TYPES,
  TenantChatAttemptEvent,
  TenantChatProjectionEvent,
} from './tenant-chat-observability.types';
import { validateTenantChatProjectionEvent } from './tenant-chat-projection.contract';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING_DIGEST_PATTERN = /^hmac-sha256:[A-Za-z0-9_-]{43}$/;
const SAFETY_POLICY_DIGEST_PATTERN = /^sha256:[A-Za-z0-9_-]{43}$/;
const SAFETY_DETECTOR_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_KEYS = new Set([
  'authorization',
  'body',
  'content',
  'credential',
  'jwt',
  'messages',
  'prompt',
  'providerRawError',
  'rawError',
  'response',
]);

type ProjectionTransaction = Prisma.TransactionClient;

@Injectable()
export class TenantChatProjectionService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TenantChatProjectionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private destroyed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('TENANT_CHAT_PROJECTOR_ENABLED') !== 'true') {
      return;
    }
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      const batchSize =
        this.config.get<number>('TENANT_CHAT_PROJECTOR_BATCH_SIZE') ?? 50;
      let processed = 0;
      while (processed < batchSize) {
        const claimed = await this.prisma.$transaction(
          async (tx) => this.processNext(tx),
          { timeout: 15000 },
        );
        if (!claimed) {
          break;
        }
        processed += 1;
      }
      return processed;
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.destroyed) {
      return;
    }
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error('Tenant Chat projection batch failed', error);
      } finally {
        this.schedule(
          this.config.get<number>('TENANT_CHAT_PROJECTOR_INTERVAL_MS') ?? 1000,
        );
      }
    }, delayMs);
    this.timer.unref();
  }

  private async processNext(tx: ProjectionTransaction): Promise<boolean> {
    const rows = await tx.$queryRaw<TenantChatInvocationOutbox[]>(Prisma.sql`
      SELECT
        event_id AS "eventId",
        tenant_id AS "tenantId",
        aggregate_id AS "aggregateId",
        event_type AS "eventType",
        event_version AS "eventVersion",
        payload,
        occurred_at AS "occurredAt",
        available_at AS "availableAt",
        published_at AS "publishedAt",
        delivery_attempts AS "deliveryAttempts",
        last_error_code AS "lastErrorCode",
        created_at AS "createdAt"
      FROM tenant_chat_invocation_outbox
      WHERE published_at IS NULL AND available_at <= now()
      ORDER BY created_at, event_version, event_id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      return false;
    }
    await this.processRow(tx, row);
    return true;
  }

  private async processRow(
    tx: ProjectionTransaction,
    row: TenantChatInvocationOutbox,
  ): Promise<void> {
    try {
      const event = parseProjectionEvent(row.payload);
      assertEnvelopeMatches(row, event);
      await this.assertEarlierVersionsProjected(tx, row);
      if (isTerminalEvent(event)) {
        await this.projectTerminalEvent(tx, event);
      }
      await tx.tenantChatInvocationOutbox.update({
        where: { eventId: row.eventId },
        data: {
          deliveryAttempts: { increment: 1 },
          lastErrorCode: null,
          publishedAt: new Date(),
        },
      });
    } catch (error) {
      const code = projectionErrorCode(error);
      if (code === 'EVENT_VERSION_PENDING') {
        await this.deferPendingVersion(tx, row);
      } else {
        await this.recordFailure(tx, row, code);
      }
    }
  }

  private async assertEarlierVersionsProjected(
    tx: ProjectionTransaction,
    row: TenantChatInvocationOutbox,
  ): Promise<void> {
    if (row.eventVersion <= 1n) {
      return;
    }
    const earlier = await tx.tenantChatInvocationOutbox.findMany({
      where: {
        aggregateId: row.aggregateId,
        eventVersion: { lt: row.eventVersion },
      },
      select: {
        eventVersion: true,
        publishedAt: true,
        lastErrorCode: true,
      },
      orderBy: { eventVersion: 'asc' },
    });
    const byVersion = new Map(
      earlier.map((candidate) => [candidate.eventVersion.toString(), candidate]),
    );
    for (let version = 1n; version < row.eventVersion; version += 1n) {
      const candidate = byVersion.get(version.toString());
      if (!candidate) {
        throw new ProjectionError('EVENT_VERSION_GAP');
      }
      if (candidate.publishedAt) {
        continue;
      }
      if (candidate.lastErrorCode?.startsWith('DLQ_')) {
        throw new ProjectionError('EVENT_VERSION_BLOCKED');
      }
      throw new ProjectionError('EVENT_VERSION_PENDING');
    }
  }

  private async projectTerminalEvent(
    tx: ProjectionTransaction,
    event: TenantChatProjectionEvent,
  ): Promise<void> {
    const existing = await tx.tenantChatInvocationLog.findUnique({
      where: { requestId: event.requestId },
      select: {
        projectedEventVersion: true,
        tenantId: true,
        confirmedInputTokens: true,
        confirmedOutputTokens: true,
        confirmedTotalTokens: true,
        confirmedCostMicroUsd: true,
        savedCostMicroUsd: true,
        maskingAction: true,
        maskingDetectedTypes: true,
        maskingDetectedCount: true,
        safetyPolicyDigest: true,
        completedAt: true,
      },
    });
    if (existing) {
      if (existing.tenantId !== event.executionScope.tenantId) {
        throw new ProjectionError('TENANT_SCOPE_MISMATCH');
      }
    }

    const [reservation, admission, runtimeSnapshot] = await Promise.all([
      tx.tenantChatUsageReservation.findUnique({
        where: { requestId: event.requestId },
        select: {
          idempotencyKey: true,
          cacheOutcome: true,
          pricingVersion: true,
          requestId: true,
          reservationId: true,
          reservedAt: true,
          snapshotDigest: true,
          snapshotVersion: true,
          tenantId: true,
          turnId: true,
          userId: true,
        },
      }),
      tx.tenantChatRequestAdmission.findUnique({
        where: { requestId: event.requestId },
        select: {
          actorKind: true,
          bindingDigest: true,
          createdAt: true,
          employeeId: true,
          idempotencyKey: true,
          maskingAction: true,
          maskingDetectedTypes: true,
          maskingDetectedCount: true,
          requestId: true,
          safetyPolicyDigest: true,
          snapshotVersion: true,
          tenantId: true,
          turnId: true,
          userId: true,
        },
      }),
      tx.tenantChatRuntimeSnapshot.findUnique({
        where: {
          tenantId_version: {
            tenantId: event.executionScope.tenantId,
            version: BigInt(event.snapshotVersion),
          },
        },
        select: {
          digest: true,
          pricingVersion: true,
          snapshotBody: true,
          tenantId: true,
          version: true,
        },
      }),
    ]);
    if (
      reservation?.tenantId &&
      reservation.tenantId !== event.executionScope.tenantId
    ) {
      throw new ProjectionError('TENANT_SCOPE_MISMATCH');
    }
    if (
      admission?.tenantId &&
      admission.tenantId !== event.executionScope.tenantId
    ) {
      throw new ProjectionError('TENANT_SCOPE_MISMATCH');
    }
    if (
      runtimeSnapshot?.tenantId &&
      runtimeSnapshot.tenantId !== event.executionScope.tenantId
    ) {
      throw new ProjectionError('TENANT_SCOPE_MISMATCH');
    }
    if (!admission || !runtimeSnapshot) {
      throw new ProjectionError('PROJECTION_SOURCE_UNAVAILABLE');
    }

    const eventEmployeeId = event.executionScope.employeeId ?? null;
    if (
      admission.requestId !== event.requestId ||
      admission.turnId !== event.turnId ||
      admission.idempotencyKey !== event.idempotencyKey ||
      admission.tenantId !== event.executionScope.tenantId ||
      admission.userId !== event.executionScope.userId ||
      admission.actorKind !== event.executionScope.actorKind ||
      admission.employeeId !== eventEmployeeId ||
      admission.snapshotVersion !== BigInt(event.snapshotVersion) ||
      !BINDING_DIGEST_PATTERN.test(admission.bindingDigest) ||
      runtimeSnapshot.tenantId !== event.executionScope.tenantId ||
      runtimeSnapshot.version !== BigInt(event.snapshotVersion)
    ) {
      throw new ProjectionError('PROJECTION_SOURCE_MISMATCH');
    }

    const runtimePricingVersion = Number(runtimeSnapshot.pricingVersion);
    if (
      !Number.isSafeInteger(runtimePricingVersion) ||
      runtimePricingVersion < 1 ||
      (event.pricingVersion !== undefined &&
        event.pricingVersion !== runtimePricingVersion)
    ) {
      throw new ProjectionError('PROJECTION_SOURCE_MISMATCH');
    }

    if (event.eventType === 'invocation_terminal') {
      if (reservation) {
        throw new ProjectionError('PROJECTION_SOURCE_MISMATCH');
      }
    } else {
      if (!reservation) {
        throw new ProjectionError('PROJECTION_SOURCE_UNAVAILABLE');
      }
      if (
        reservation.reservationId !== event.reservationId ||
        reservation.requestId !== event.requestId ||
        reservation.turnId !== event.turnId ||
        reservation.idempotencyKey !== event.idempotencyKey ||
        reservation.tenantId !== event.executionScope.tenantId ||
        reservation.userId !== event.executionScope.userId ||
        reservation.snapshotVersion !== BigInt(event.snapshotVersion) ||
        reservation.snapshotDigest !== runtimeSnapshot.digest ||
        reservation.pricingVersion !== runtimeSnapshot.pricingVersion ||
        event.pricingVersion !== runtimePricingVersion
      ) {
        throw new ProjectionError('PROJECTION_SOURCE_MISMATCH');
      }
    }

    if (
      existing?.projectedEventVersion !== undefined &&
      existing.projectedEventVersion >= BigInt(event.eventVersion)
    ) {
      return;
    }

    const attempts = event.attempts ?? [];
    const effectiveAttempt = selectEffectiveAttempt(attempts);
    const effectiveProviderId =
      event.effectiveProviderId ?? effectiveAttempt?.providerId;
    const effectiveModelKey =
      event.effectiveModelKey ?? effectiveAttempt?.modelKey;
    const effectiveRouteTier =
      event.effectiveRouteTier ??
      routeTierFromSnapshot(
        runtimeSnapshot.snapshotBody,
        effectiveProviderId,
        effectiveModelKey,
      );
    const occurredAt = new Date(event.occurredAt);
    const startedAt =
      admission.createdAt ??
      reservation?.reservedAt ??
      new Date(occurredAt.getTime() - (event.latencyMs ?? 0));
    const quota = event.quota;
    const budget = event.budget;
    const confirmedInputTokens = quota?.confirmedInputTokensDelta ?? 0;
    const confirmedOutputTokens = quota?.confirmedOutputTokensDelta ?? 0;
    const confirmedTotalTokens =
      quota?.confirmedTotalTokensDelta ??
      confirmedInputTokens + confirmedOutputTokens;
    const confirmedCostMicroUsd = budget?.confirmedCostMicroUsdDelta ?? 0;
    const savedCostMicroUsd =
      event.savedCostMicroUsd !== undefined
        ? BigInt(event.savedCostMicroUsd)
        : event.cacheOutcome === 'hit'
          ? existing?.savedCostMicroUsd ?? null
          : 0n;
    const eventSafety = safetySummaryFromEvent(event);
    const admissionSafety = safetySummaryFromProjectionSource(admission);
    if (
      eventSafety &&
      admissionSafety &&
      !sameProjectedSafetySummary(eventSafety, admissionSafety) &&
      !(
        event.terminalOutcome === 'safety_blocked' &&
        eventSafety.maskingAction === 'blocked' &&
        sameProjectedSafetyEvidence(eventSafety, admissionSafety)
      )
    ) {
      throw new ProjectionError('PROJECTION_SOURCE_MISMATCH');
    }
    const safety = eventSafety ?? admissionSafety;
    const maskingAction =
      safety?.maskingAction ??
      (event.terminalOutcome === 'safety_blocked'
        ? 'blocked'
        : existing?.maskingAction ?? null);
    const isLateUsageDelta =
      event.schemaVersion >= 2 &&
      event.eventType === 'usage_settled' &&
      event.lateUsage === true;
    const projectedConfirmedInputTokens =
      BigInt(confirmedInputTokens) +
      (isLateUsageDelta ? existing?.confirmedInputTokens ?? 0n : 0n);
    const projectedConfirmedOutputTokens =
      BigInt(confirmedOutputTokens) +
      (isLateUsageDelta ? existing?.confirmedOutputTokens ?? 0n : 0n);
    const projectedConfirmedTotalTokens =
      BigInt(confirmedTotalTokens) +
      (isLateUsageDelta ? existing?.confirmedTotalTokens ?? 0n : 0n);
    const projectedConfirmedCostMicroUsd =
      BigInt(confirmedCostMicroUsd) +
      (isLateUsageDelta ? existing?.confirmedCostMicroUsd ?? 0n : 0n);
    const snapshotDigest = runtimeSnapshot.digest;
    const pricingVersion = runtimePricingVersion;

    await tx.tenantChatInvocationLog.upsert({
      where: { requestId: event.requestId },
      create: {
        requestId: event.requestId,
        tenantId: event.executionScope.tenantId,
        userId: event.executionScope.userId,
        employeeId: event.executionScope.employeeId,
        actorKind: event.executionScope.actorKind,
        turnId: event.turnId,
        surface: 'tenant_chat',
        executionScopeKind: 'tenant_chat',
        snapshotVersion: BigInt(event.snapshotVersion),
        snapshotDigest,
        pricingVersion: BigInt(pricingVersion),
        terminalOutcome: event.terminalOutcome ?? 'failed',
        effectiveProviderId,
        effectiveModelKey,
        effectiveRouteTier,
        attemptCount: attempts.length,
        confirmedInputTokens: projectedConfirmedInputTokens,
        confirmedOutputTokens: projectedConfirmedOutputTokens,
        confirmedTotalTokens: projectedConfirmedTotalTokens,
        confirmedCostMicroUsd: projectedConfirmedCostMicroUsd,
        savedCostMicroUsd,
        maskingAction,
        maskingDetectedTypes: safety?.maskingDetectedTypes,
        maskingDetectedCount: safety?.maskingDetectedCount,
        safetyPolicyDigest: safety?.safetyPolicyDigest,
        quotaState: quota?.state ?? event.quotaState ?? 'normal',
        budgetState: budget?.state ?? event.budgetState ?? 'normal',
        cacheOutcome: event.cacheOutcome ?? reservation?.cacheOutcome ?? 'off',
        latencyMs: BigInt(
          event.latencyMs ?? Math.max(0, occurredAt.getTime() - startedAt.getTime()),
        ),
        startedAt,
        completedAt: occurredAt,
        projectedEventVersion: BigInt(event.eventVersion),
      },
      update: {
        terminalOutcome: event.terminalOutcome ?? 'failed',
        effectiveProviderId,
        effectiveModelKey,
        effectiveRouteTier,
        attemptCount: attempts.length,
        confirmedInputTokens: projectedConfirmedInputTokens,
        confirmedOutputTokens: projectedConfirmedOutputTokens,
        confirmedTotalTokens: projectedConfirmedTotalTokens,
        confirmedCostMicroUsd: projectedConfirmedCostMicroUsd,
        savedCostMicroUsd,
        maskingAction,
        maskingDetectedTypes: safety?.maskingDetectedTypes,
        maskingDetectedCount: safety?.maskingDetectedCount,
        safetyPolicyDigest: safety?.safetyPolicyDigest,
        quotaState: quota?.state ?? event.quotaState ?? 'normal',
        budgetState: budget?.state ?? event.budgetState ?? 'normal',
        cacheOutcome: event.cacheOutcome ?? reservation?.cacheOutcome ?? 'off',
        latencyMs: BigInt(
          event.latencyMs ?? Math.max(0, occurredAt.getTime() - startedAt.getTime()),
        ),
        completedAt: occurredAt,
        projectedEventVersion: BigInt(event.eventVersion),
      },
    });
    if (this.config.get<string>('DASHBOARD_ROLLUP_ENABLED') === 'true') {
      const dirtyHours = new Map<string, Date>();
      for (const completedAt of [existing?.completedAt, occurredAt]) {
        if (!completedAt) {
          continue;
        }
        const hour = utcBucketStart(completedAt, 'hour');
        dirtyHours.set(hour.toISOString(), hour);
      }
      for (const hour of dirtyHours.values()) {
        await enqueueDashboardRollupDirtyHierarchy(tx, {
          tenantId: event.executionScope.tenantId,
          surface: 'tenant_chat',
          occurredAt: hour,
          reasonCode: 'PROJECTION_CHANGED',
        });
      }
    }
  }

  private async recordFailure(
    tx: ProjectionTransaction,
    row: TenantChatInvocationOutbox,
    code: string,
  ): Promise<void> {
    const maxAttempts =
      this.config.get<number>('TENANT_CHAT_PROJECTOR_MAX_ATTEMPTS') ?? 5;
    const nextAttempt = row.deliveryAttempts + 1;
    const deadLettered = nextAttempt >= maxAttempts;
    await tx.tenantChatInvocationOutbox.update({
      where: { eventId: row.eventId },
      data: {
        deliveryAttempts: nextAttempt,
        lastErrorCode: deadLettered ? `DLQ_${code}` : code,
        availableAt: new Date(
          Date.now() + (deadLettered ? 24 * 60 * 60 * 1000 : retryDelay(nextAttempt)),
        ),
      },
    });
  }

  private async deferPendingVersion(
    tx: ProjectionTransaction,
    row: TenantChatInvocationOutbox,
  ): Promise<void> {
    await tx.tenantChatInvocationOutbox.update({
      where: { eventId: row.eventId },
      data: {
        availableAt: new Date(Date.now() + 1000),
        lastErrorCode: 'EVENT_VERSION_PENDING',
      },
    });
  }
}

class ProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function parseProjectionEvent(payload: Prisma.JsonValue): TenantChatProjectionEvent {
  rejectForbiddenData(payload);
  try {
    validateTenantChatProjectionEvent(payload);
  } catch {
    throw new ProjectionError('INVALID_EVENT_SCHEMA');
  }
  if (!isRecord(payload)) {
    throw new ProjectionError('INVALID_EVENT_PAYLOAD');
  }
  const eventType = readString(payload, 'eventType');
  if (!TENANT_CHAT_EVENT_TYPES.includes(eventType as never)) {
    throw new ProjectionError('INVALID_EVENT_TYPE');
  }
  const executionScope = payload.executionScope;
  if (!isRecord(executionScope)) {
    throw new ProjectionError('INVALID_EXECUTION_SCOPE');
  }
  const actorKind = readString(executionScope, 'actorKind');
  const employeeId = optionalString(executionScope.employeeId);
  if (
    readString(executionScope, 'kind') !== 'tenant_chat' ||
    (actorKind !== 'employee' && actorKind !== 'tenant_admin') ||
    (actorKind === 'employee' && !employeeId)
  ) {
    throw new ProjectionError('INVALID_EXECUTION_SCOPE');
  }
  const tenantId = readString(executionScope, 'tenantId');
  const userId = readString(executionScope, 'userId');
  if (!UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(userId)) {
    throw new ProjectionError('INVALID_EXECUTION_SCOPE');
  }
  if (employeeId && !UUID_PATTERN.test(employeeId)) {
    throw new ProjectionError('INVALID_EXECUTION_SCOPE');
  }

  return {
    ...(payload as unknown as TenantChatProjectionEvent),
    eventType: eventType as TenantChatProjectionEvent['eventType'],
    executionScope: {
      kind: 'tenant_chat',
      tenantId,
      userId,
      actorKind,
      ...(employeeId ? { employeeId } : {}),
    },
    eventVersion: readPositiveInteger(payload, 'eventVersion'),
    schemaVersion: readPositiveInteger(payload, 'schemaVersion'),
    snapshotVersion: readPositiveInteger(payload, 'snapshotVersion'),
  };
}

type ProjectedSafetySummary = {
  maskingAction: 'none' | 'redacted' | 'blocked';
  maskingDetectedTypes: string[];
  maskingDetectedCount: number;
  safetyPolicyDigest: string;
};

function safetySummaryFromEvent(
  event: TenantChatProjectionEvent,
): ProjectedSafetySummary | undefined {
  return buildProjectedSafetySummary({
    maskingAction: event.maskingAction,
    maskingDetectedTypes: event.maskingDetectedTypes,
    maskingDetectedCount: event.maskingDetectedCount,
    safetyPolicyDigest: event.safetyPolicyDigest,
  });
}

function safetySummaryFromProjectionSource(source: {
  maskingAction: string | null;
  maskingDetectedTypes: Prisma.JsonValue | null;
  maskingDetectedCount: number | null;
  safetyPolicyDigest: string | null;
}): ProjectedSafetySummary | undefined {
  return buildProjectedSafetySummary(source);
}

function buildProjectedSafetySummary(source: {
  maskingAction?: string | null;
  maskingDetectedTypes?: unknown;
  maskingDetectedCount?: number | null;
  safetyPolicyDigest?: string | null;
}): ProjectedSafetySummary | undefined {
  const values = [
    source.maskingAction,
    source.maskingDetectedTypes,
    source.maskingDetectedCount,
    source.safetyPolicyDigest,
  ];
  if (values.every((value) => value === undefined || value === null)) {
    return undefined;
  }
  if (
    (source.maskingAction !== 'none' &&
      source.maskingAction !== 'redacted' &&
      source.maskingAction !== 'blocked') ||
    !Array.isArray(source.maskingDetectedTypes) ||
    source.maskingDetectedTypes.length > 32 ||
    !Number.isSafeInteger(source.maskingDetectedCount) ||
    (source.maskingDetectedCount ?? -1) < 0 ||
    (source.maskingDetectedCount ?? 1_000_001) > 1_000_000 ||
    typeof source.safetyPolicyDigest !== 'string' ||
    !SAFETY_POLICY_DIGEST_PATTERN.test(source.safetyPolicyDigest)
  ) {
    throw new ProjectionError('PROJECTION_SOURCE_MISMATCH');
  }
  const detectedTypes = source.maskingDetectedTypes;
  if (
    detectedTypes.some(
      (value, index) =>
        typeof value !== 'string' ||
        !SAFETY_DETECTOR_TYPE_PATTERN.test(value) ||
        (index > 0 && detectedTypes[index - 1] >= value),
    )
  ) {
    throw new ProjectionError('PROJECTION_SOURCE_MISMATCH');
  }
  return {
    maskingAction: source.maskingAction,
    maskingDetectedTypes: detectedTypes as string[],
    maskingDetectedCount: source.maskingDetectedCount as number,
    safetyPolicyDigest: source.safetyPolicyDigest,
  };
}

function sameProjectedSafetySummary(
  left: ProjectedSafetySummary,
  right: ProjectedSafetySummary,
): boolean {
  return (
    left.maskingAction === right.maskingAction &&
    sameProjectedSafetyEvidence(left, right)
  );
}

function sameProjectedSafetyEvidence(
  left: ProjectedSafetySummary,
  right: ProjectedSafetySummary,
): boolean {
  return (
    left.maskingDetectedCount === right.maskingDetectedCount &&
    left.safetyPolicyDigest === right.safetyPolicyDigest &&
    left.maskingDetectedTypes.length === right.maskingDetectedTypes.length &&
    left.maskingDetectedTypes.every(
      (detectorType, index) => detectorType === right.maskingDetectedTypes[index],
    )
  );
}

function assertEnvelopeMatches(
  row: TenantChatInvocationOutbox,
  event: TenantChatProjectionEvent,
): void {
  if (
    (event.schemaVersion !== 1 &&
      event.schemaVersion !== 2 &&
      event.schemaVersion !== 3) ||
    event.eventId !== row.eventId ||
    event.aggregateId !== row.aggregateId ||
    event.requestId !== row.aggregateId ||
    event.eventType !== row.eventType ||
    BigInt(event.eventVersion) !== row.eventVersion ||
    event.executionScope.tenantId !== row.tenantId
  ) {
    throw new ProjectionError('EVENT_ENVELOPE_MISMATCH');
  }
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ProjectionError('INVALID_EVENT_TIMESTAMP');
  }
}

function isTerminalEvent(event: TenantChatProjectionEvent): boolean {
  return (
    event.eventType === 'invocation_terminal' ||
    event.eventType === 'usage_settled' ||
    event.eventType === 'usage_released' ||
    event.eventType === 'usage_unconfirmed'
  );
}

function selectEffectiveAttempt(
  attempts: TenantChatAttemptEvent[],
): TenantChatAttemptEvent | undefined {
  return (
    [...attempts].reverse().find((attempt) => attempt.outcome === 'succeeded') ??
    attempts[attempts.length - 1]
  );
}

function routeTierFromSnapshot(
  snapshotBody: Prisma.JsonValue,
  providerId: string | undefined,
  modelKey: string | undefined,
): 'high_quality' | 'standard' | 'economy' | undefined {
  if (!providerId || !modelKey || !isRecord(snapshotBody)) {
    return undefined;
  }
  const policies = snapshotBody.policies;
  const routing = isRecord(policies) ? policies.routing : undefined;
  const routes = isRecord(routing) ? routing.routes : undefined;
  if (!Array.isArray(routes)) {
    return undefined;
  }
  const route = routes.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.providerId === providerId &&
      candidate.modelKey === modelKey,
  );
  if (!isRecord(route)) {
    return undefined;
  }
  return route.tier === 'high_quality' ||
    route.tier === 'standard' ||
    route.tier === 'economy'
    ? route.tier
    : undefined;
}

function rejectForbiddenData(value: Prisma.JsonValue): void {
  if (Array.isArray(value)) {
    value.forEach(rejectForbiddenData);
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new ProjectionError('FORBIDDEN_EVENT_DATA');
    }
    rejectForbiddenData(nested as Prisma.JsonValue);
  }
}

function projectionErrorCode(error: unknown): string {
  return error instanceof ProjectionError ? error.code : 'PROJECTION_FAILED';
}

function retryDelay(attempt: number): number {
  return Math.min(30000, 250 * 2 ** Math.min(attempt, 7));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProjectionError('INVALID_EVENT_PAYLOAD');
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ProjectionError('INVALID_EVENT_PAYLOAD');
  }
  return Number(value);
}
