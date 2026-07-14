import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  ProviderConnectionStatus,
  ResourceStatus,
  RuntimeConfigPublishState,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  canonicalizeTenantChatJson,
  computeTenantChatPricingDigest,
  computeTenantChatPolicyDigest,
  computeTenantChatSafetyPolicyDigest,
  computeTenantChatSnapshotDigest,
  TENANT_CHAT_MODEL_KEY_PATTERN,
  TenantChatRuntimeContractError,
  validateTenantChatRuntimeSnapshot,
} from './tenant-chat-runtime.contract';
import { findTenantChatModelPricing } from './tenant-chat-model-pricing.catalog';
import type {
  ActivateTenantChatRuntimeInput,
  PublishTenantChatRuntimeSnapshotInput,
  TenantChatAdminActiveSnapshot,
  TenantChatAdminProviderCandidate,
  TenantChatAdminRuntimeSetup,
  TenantChatPricing,
  TenantChatRuntimePolicies,
  TenantChatRuntimeSnapshotDocument,
} from './tenant-chat-runtime.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_DIGEST = `sha256:${'A'.repeat(43)}`;

interface AdminProviderRecord {
  id: string;
  provider: string;
  displayName: string;
  providerConfig: Prisma.JsonValue;
}

interface AdminSnapshotPointerRecord {
  snapshot: {
    snapshotBody: Prisma.JsonValue;
  };
}

@Injectable()
export class TenantChatRuntimeService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveSnapshot(
    tenantId: string,
  ): Promise<TenantChatRuntimeSnapshotDocument> {
    this.assertDatabaseTenantId(tenantId);
    const pointer = await this.prisma.tenantChatActiveRuntimeSnapshot.findUnique({
      where: { tenantId },
      include: { snapshot: true },
    });
    if (!pointer) {
      throw new NotFoundException('Active Tenant Chat runtime snapshot not found.');
    }

    const snapshot = this.toSnapshotDocument(pointer.snapshot.snapshotBody);
    validateTenantChatRuntimeSnapshot(snapshot);
    return snapshot;
  }

  async getAdminRuntimeSetup(
    tenantId: string,
  ): Promise<TenantChatAdminRuntimeSetup> {
    this.assertDatabaseTenantId(tenantId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant || tenant.status !== ResourceStatus.ACTIVE) {
      throw new NotFoundException('Active tenant not found.');
    }

    const [providers, pointer] = await Promise.all([
      this.prisma.providerConnection.findMany({
        where: {
          tenantId,
          projectId: null,
          status: ProviderConnectionStatus.ACTIVE,
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          provider: true,
          displayName: true,
          providerConfig: true,
        },
      }),
      this.prisma.tenantChatActiveRuntimeSnapshot.findUnique({
        where: { tenantId },
        select: {
          snapshot: {
            select: { snapshotBody: true },
          },
        },
      }),
    ]);

    return this.buildAdminRuntimeSetup(providers, pointer);
  }

  async activateAdminRuntime(
    input: ActivateTenantChatRuntimeInput,
  ): Promise<TenantChatAdminRuntimeSetup> {
    this.assertDatabaseTenantId(input.tenantId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.prisma.$transaction(
          async (tx) => this.activateAdminRuntimeInTransaction(tx, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return this.getAdminRuntimeSetup(input.tenantId);
      } catch (error) {
        if (attempt < 2 && this.isRetryablePublishConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Tenant Chat runtime publish did not converge.');
  }

  async publishSnapshot(
    input: PublishTenantChatRuntimeSnapshotInput,
  ): Promise<TenantChatRuntimeSnapshotDocument> {
    const { snapshot } = input;
    try {
      validateTenantChatRuntimeSnapshot(snapshot);
    } catch (error) {
      if (error instanceof TenantChatRuntimeContractError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    this.assertDatabaseTenantId(snapshot.tenantId);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.publishInTransaction(tx, snapshot),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (attempt === 0 && this.isRetryablePublishConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Tenant Chat runtime publish did not converge.');
  }

  private async publishInTransaction(
    tx: Prisma.TransactionClient,
    snapshot: TenantChatRuntimeSnapshotDocument,
  ): Promise<TenantChatRuntimeSnapshotDocument> {
    const tenant = await tx.tenant.findUnique({
      where: { id: snapshot.tenantId },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status !== ResourceStatus.ACTIVE) {
      throw new NotFoundException('Active tenant not found.');
    }

    const existingSnapshot = await tx.tenantChatRuntimeSnapshot.findUnique({
      where: {
        tenantId_version: {
          tenantId: snapshot.tenantId,
          version: BigInt(snapshot.version),
        },
      },
    });
    if (existingSnapshot) {
      if (
        existingSnapshot.snapshotId !== snapshot.snapshotId ||
        existingSnapshot.digest !== snapshot.digest
      ) {
        throw new ConflictException(
          'Tenant Chat snapshot version is already bound to different content.',
        );
      }
      const activePointer = await tx.tenantChatActiveRuntimeSnapshot.findUnique({
        where: { tenantId: snapshot.tenantId },
        select: { snapshotId: true },
      });
      if (activePointer?.snapshotId !== existingSnapshot.snapshotId) {
        throw new ConflictException(
          'A historical Tenant Chat snapshot cannot be reactivated; publish a new monotonic version.',
        );
      }
      return this.toSnapshotDocument(existingSnapshot.snapshotBody);
    }

    const latestSnapshot = await tx.tenantChatRuntimeSnapshot.findFirst({
      where: { tenantId: snapshot.tenantId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    if (latestSnapshot && BigInt(snapshot.version) <= latestSnapshot.version) {
      throw new ConflictException(
        'Tenant Chat snapshot version must increase monotonically.',
      );
    }

    const pricingCatalog = await this.ensurePricingCatalog(tx, snapshot);
    const runtimeConfig = await this.ensureRuntimeConfig(tx, snapshot);
    const publishedAt = new Date(snapshot.publishedAt);

    await tx.tenantChatRuntimeSnapshot.create({
      data: {
        snapshotId: snapshot.snapshotId,
        tenantId: snapshot.tenantId,
        runtimeConfigId: runtimeConfig.id,
        pricingCatalogId: pricingCatalog.id,
        version: BigInt(snapshot.version),
        digest: snapshot.digest,
        policyVersion: BigInt(snapshot.policyVersion),
        employeeNoticeVersion: BigInt(snapshot.employeeNoticeVersion),
        pricingVersion: BigInt(snapshot.pricing.version),
        pricingDigest: snapshot.pricing.digest,
        snapshotBody: this.toInputJson(snapshot),
        publishedAt,
        publishedBy: snapshot.publishedBy,
      },
    });
    await this.activateSnapshot(tx, snapshot, snapshot.snapshotId);

    return snapshot;
  }

  private async activateAdminRuntimeInTransaction(
    tx: Prisma.TransactionClient,
    input: ActivateTenantChatRuntimeInput,
  ): Promise<TenantChatRuntimeSnapshotDocument> {
    const tenant = await tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { status: true },
    });
    if (!tenant || tenant.status !== ResourceStatus.ACTIVE) {
      throw new NotFoundException('Active tenant not found.');
    }

    const provider = await tx.providerConnection.findFirst({
      where: {
        id: input.providerConnectionId,
        tenantId: input.tenantId,
        projectId: null,
        status: ProviderConnectionStatus.ACTIVE,
      },
      select: {
        id: true,
        provider: true,
        displayName: true,
        providerConfig: true,
      },
    });
    if (!provider) {
      throw new NotFoundException(
        'Active tenant Provider connection not found.',
      );
    }

    const providerFamily = this.readProviderFamily(provider.providerConfig);
    const configuredModels = this.readConfiguredModels(provider.providerConfig);
    if (!configuredModels.includes(input.modelKey)) {
      throw new BadRequestException(
        'The selected model is not configured for this Provider connection.',
      );
    }
    const catalogPrice = findTenantChatModelPricing(
      providerFamily,
      input.modelKey,
    );
    if (!catalogPrice) {
      throw new UnprocessableEntityException(
        'Tenant Chat pricing is unavailable for the selected Provider model.',
      );
    }

    const activePointer = await tx.tenantChatActiveRuntimeSnapshot.findUnique({
      where: { tenantId: input.tenantId },
      select: {
        snapshot: {
          select: { snapshotBody: true },
        },
      },
    });
    const activeSnapshot = activePointer
      ? this.readValidSnapshotOrNull(activePointer.snapshot.snapshotBody)
      : null;
    const policies = this.composeAdminPolicies(
      activeSnapshot,
      provider.id,
      input.modelKey,
    );
    const pricingRoutes = this.composePricingRoutes(
      provider.id,
      input.modelKey,
      catalogPrice,
    );

    if (
      activeSnapshot &&
      this.isEquivalentAdminPublication(
        activeSnapshot,
        policies,
        catalogPrice.effectiveAt,
        pricingRoutes,
      )
    ) {
      return activeSnapshot;
    }

    const [latestSnapshot, latestPolicy, latestPricing] = await Promise.all([
      tx.tenantChatRuntimeSnapshot.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
      tx.tenantChatRuntimeConfig.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
      tx.tenantChatPricingCatalog.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
    ]);
    const pricing: TenantChatPricing = {
      version: this.nextVersion(latestPricing?.version),
      digest: PLACEHOLDER_DIGEST,
      currency: 'USD',
      unit: 'micro_usd_per_1m_tokens',
      effectiveAt: catalogPrice.effectiveAt,
      routes: pricingRoutes,
    };
    pricing.digest = computeTenantChatPricingDigest(pricing);

    const snapshot: TenantChatRuntimeSnapshotDocument = {
      snapshotId: `tenant_chat_snapshot_${randomUUID().replaceAll('-', '')}`,
      version: this.nextVersion(latestSnapshot?.version),
      digest: PLACEHOLDER_DIGEST,
      tenantId: input.tenantId,
      policyVersion: this.nextVersion(latestPolicy?.version),
      employeeNoticeVersion: activeSnapshot?.employeeNoticeVersion ?? 1,
      pricing,
      policies,
      publishedAt: new Date().toISOString(),
      publishedBy: input.publishedBy,
    };
    snapshot.digest = computeTenantChatSnapshotDigest(snapshot);
    validateTenantChatRuntimeSnapshot(snapshot);

    return this.publishInTransaction(tx, snapshot);
  }

  private buildAdminRuntimeSetup(
    providerRecords: AdminProviderRecord[],
    pointer: AdminSnapshotPointerRecord | null,
  ): TenantChatAdminRuntimeSetup {
    const providers = providerRecords.map((provider) =>
      this.toAdminProviderCandidate(provider),
    );
    const snapshot = pointer
      ? this.readValidSnapshotOrNull(pointer.snapshot.snapshotBody)
      : null;
    const activeSnapshot = snapshot
      ? this.toAdminActiveSnapshot(snapshot, providerRecords)
      : null;
    const hasActivatableModel = providers.some((provider) =>
      provider.models.some((model) => model.activationStatus === 'available'),
    );

    let readiness: TenantChatAdminRuntimeSetup['readiness'];
    if (pointer && !activeSnapshot) {
      readiness = 'degraded';
    } else if (activeSnapshot) {
      readiness = 'ready';
    } else if (providers.length === 0) {
      readiness = 'needs_provider';
    } else if (!hasActivatableModel) {
      readiness = 'needs_model';
    } else {
      readiness = 'needs_activation';
    }

    return { readiness, providers, activeSnapshot };
  }

  private toAdminProviderCandidate(
    provider: AdminProviderRecord,
  ): TenantChatAdminProviderCandidate {
    const providerFamily = this.readProviderFamily(provider.providerConfig);
    return {
      providerConnectionId: provider.id,
      providerKey: provider.provider,
      providerFamily: providerFamily || 'unconfigured',
      displayName: provider.displayName,
      models: this.readConfiguredModels(provider.providerConfig).map(
        (modelKey) => {
          const pricing = findTenantChatModelPricing(providerFamily, modelKey);
          return {
            modelKey,
            activationStatus: pricing
              ? ('available' as const)
              : ('pricing_unavailable' as const),
            pricing: pricing
              ? {
                  inputMicroUsdPerMillionTokens:
                    pricing.inputMicroUsdPerMillionTokens,
                  outputMicroUsdPerMillionTokens:
                    pricing.outputMicroUsdPerMillionTokens,
                  ...(pricing.cacheReadInputMicroUsdPerMillionTokens !== undefined
                    ? {
                        cacheReadInputMicroUsdPerMillionTokens:
                          pricing.cacheReadInputMicroUsdPerMillionTokens,
                      }
                    : {}),
                }
              : null,
          };
        },
      ),
    };
  }

  private toAdminActiveSnapshot(
    snapshot: TenantChatRuntimeSnapshotDocument,
    providers: AdminProviderRecord[],
  ): TenantChatAdminActiveSnapshot | null {
    const route =
      snapshot.policies.routing.routes.find(
        (candidate) => candidate.enabled && candidate.tier === 'standard',
      ) ?? snapshot.policies.routing.routes.find((candidate) => candidate.enabled);
    if (!route) {
      return null;
    }
    const provider = providers.find((candidate) => candidate.id === route.providerId);
    if (!provider) {
      return null;
    }
    const priceRoute = snapshot.pricing.routes.find(
      (candidate) => candidate.routeId === route.routeId,
    );
    if (!priceRoute) {
      return null;
    }
    const catalogPrice = findTenantChatModelPricing(
      this.readProviderFamily(provider.providerConfig),
      route.modelKey,
    );
    const pricingStatus = !catalogPrice
      ? ('unavailable' as const)
      : this.priceMatchesCatalog(
            priceRoute,
            snapshot.pricing.effectiveAt,
            catalogPrice,
          )
        ? ('current' as const)
        : ('update_available' as const);

    return {
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
      policyVersion: snapshot.policyVersion,
      pricingVersion: snapshot.pricing.version,
      providerConnectionId: route.providerId,
      modelKey: route.modelKey,
      publishedAt: snapshot.publishedAt,
      pricingStatus,
    };
  }

  private composeAdminPolicies(
    activeSnapshot: TenantChatRuntimeSnapshotDocument | null,
    providerId: string,
    modelKey: string,
  ): TenantChatRuntimePolicies {
    const safetyWithoutDigest = {
      enabled: true,
      detectorSet: [
        { detectorType: 'email' as const, action: 'redact' as const },
        { detectorType: 'api_key' as const, action: 'block' as const },
      ],
    };
    const [standardRouteId, economyRouteId] = this.routeIds(
      providerId,
      modelKey,
    );

    return {
      rateLimit: activeSnapshot?.policies.rateLimit ?? {
        requests: 60,
        windowSeconds: 60,
      },
      concurrency: activeSnapshot?.policies.concurrency ?? {
        maxActiveAdmissionsPerUser: 2,
        admissionTtlSeconds: 30,
      },
      quota: activeSnapshot?.policies.quota ?? {
        period: 'calendar_month',
        timezone: 'Asia/Seoul',
        defaultMonthlyTokenLimit: 1_000_000,
        warningPercent: 80,
        economyPercent: 100,
        hardStopPercent: 120,
      },
      budget: activeSnapshot?.policies.budget ?? {
        period: 'calendar_month',
        timezone: 'Asia/Seoul',
        currency: 'USD',
        monthlyLimitMicroUsd: 1_000_000_000,
        warningPercent: 80,
        economyPercent: 90,
        hardStopPercent: 100,
      },
      routing: {
        routes: [
          {
            routeId: standardRouteId,
            tier: 'standard',
            providerId,
            modelKey,
            enabled: true,
          },
          {
            routeId: economyRouteId,
            tier: 'economy',
            providerId,
            modelKey,
            enabled: true,
          },
        ],
      },
      fallback: {
        enabled: false,
        routeIds: [],
        maxAttempts: 1,
        allowedReasons: [],
      },
      providerTokenRate: {
        providers: [{ providerId, limitTokens: 120_000, windowSeconds: 60 }],
      },
      cache: activeSnapshot?.policies.cache ?? {
        strategy: 'off',
        enabled: false,
        ttlSeconds: 300,
        maxEntriesPerUser: 100,
        keySetId: 'tenant_chat_cache_keys_v1',
      },
      safety: activeSnapshot?.policies.safety ?? {
        ...safetyWithoutDigest,
        policyDigest: computeTenantChatSafetyPolicyDigest(safetyWithoutDigest),
      },
      streaming: activeSnapshot?.policies.streaming ?? {
        enabled: true,
        maxDurationSeconds: 120,
        finalEventRequired: true,
      },
    };
  }

  private composePricingRoutes(
    providerId: string,
    modelKey: string,
    price: {
      inputMicroUsdPerMillionTokens: number;
      outputMicroUsdPerMillionTokens: number;
      cacheReadInputMicroUsdPerMillionTokens?: number;
    },
  ): TenantChatPricing['routes'] {
    return this.routeIds(providerId, modelKey).map((routeId) => ({
      routeId,
      providerId,
      modelKey,
      inputMicroUsdPerMillionTokens: price.inputMicroUsdPerMillionTokens,
      outputMicroUsdPerMillionTokens: price.outputMicroUsdPerMillionTokens,
      ...(price.cacheReadInputMicroUsdPerMillionTokens !== undefined
        ? {
            cacheReadInputMicroUsdPerMillionTokens:
              price.cacheReadInputMicroUsdPerMillionTokens,
          }
        : {}),
    }));
  }

  private isEquivalentAdminPublication(
    snapshot: TenantChatRuntimeSnapshotDocument,
    policies: TenantChatRuntimePolicies,
    effectiveAt: string,
    pricingRoutes: TenantChatPricing['routes'],
  ): boolean {
    return (
      canonicalizeTenantChatJson(snapshot.policies) ===
        canonicalizeTenantChatJson(policies) &&
      snapshot.pricing.effectiveAt === effectiveAt &&
      canonicalizeTenantChatJson(snapshot.pricing.routes) ===
        canonicalizeTenantChatJson(pricingRoutes)
    );
  }

  private priceMatchesCatalog(
    route: TenantChatPricing['routes'][number],
    effectiveAt: string,
    catalogPrice: {
      effectiveAt: string;
      inputMicroUsdPerMillionTokens: number;
      outputMicroUsdPerMillionTokens: number;
      cacheReadInputMicroUsdPerMillionTokens?: number;
    },
  ): boolean {
    return (
      effectiveAt === catalogPrice.effectiveAt &&
      route.inputMicroUsdPerMillionTokens ===
        catalogPrice.inputMicroUsdPerMillionTokens &&
      route.outputMicroUsdPerMillionTokens ===
        catalogPrice.outputMicroUsdPerMillionTokens &&
      route.cacheReadInputMicroUsdPerMillionTokens ===
        catalogPrice.cacheReadInputMicroUsdPerMillionTokens
    );
  }

  private routeIds(providerId: string, modelKey: string): [string, string] {
    const suffix = createHash('sha256')
      .update(`${providerId}\u0000${modelKey}`, 'utf8')
      .digest('base64url')
      .slice(0, 24);
    return [`route_standard_${suffix}`, `route_economy_${suffix}`];
  }

  private readProviderFamily(value: Prisma.JsonValue): string {
    const config = this.toRecordOrNull(value);
    const family = config?.providerFamily ?? config?.providerKey;
    return typeof family === 'string' && /^[a-z][a-z0-9_-]{1,63}$/.test(family)
      ? family
      : '';
  }

  private readConfiguredModels(value: Prisma.JsonValue): string[] {
    const models = this.toRecordOrNull(value)?.models;
    if (!Array.isArray(models)) {
      return [];
    }
    return Array.from(
      new Set(
        models.filter(
          (model): model is string =>
            typeof model === 'string' && TENANT_CHAT_MODEL_KEY_PATTERN.test(model),
        ),
      ),
    );
  }

  private readValidSnapshotOrNull(
    value: Prisma.JsonValue,
  ): TenantChatRuntimeSnapshotDocument | null {
    try {
      const snapshot = this.toSnapshotDocument(value);
      validateTenantChatRuntimeSnapshot(snapshot);
      return snapshot;
    } catch {
      return null;
    }
  }

  private toRecordOrNull(
    value: Prisma.JsonValue,
  ): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private nextVersion(value: bigint | undefined): number {
    const next = Number(value ?? 0n) + 1;
    if (!Number.isSafeInteger(next) || next < 1) {
      throw new ConflictException('Tenant Chat runtime version is out of range.');
    }
    return next;
  }

  private async ensurePricingCatalog(
    tx: Prisma.TransactionClient,
    snapshot: TenantChatRuntimeSnapshotDocument,
  ) {
    const existing = await tx.tenantChatPricingCatalog.findUnique({
      where: {
        tenantId_version: {
          tenantId: snapshot.tenantId,
          version: BigInt(snapshot.pricing.version),
        },
      },
    });
    if (existing) {
      if (existing.digest !== snapshot.pricing.digest) {
        throw new ConflictException(
          'Tenant Chat pricing version is already bound to different content.',
        );
      }
      return existing;
    }

    return tx.tenantChatPricingCatalog.create({
      data: {
        tenantId: snapshot.tenantId,
        version: BigInt(snapshot.pricing.version),
        digest: snapshot.pricing.digest,
        currency: snapshot.pricing.currency,
        unit: snapshot.pricing.unit,
        document: this.toInputJson(snapshot.pricing),
        effectiveAt: new Date(snapshot.pricing.effectiveAt),
        publishedAt: new Date(snapshot.publishedAt),
        publishedBy: snapshot.publishedBy,
      },
    });
  }

  private async ensureRuntimeConfig(
    tx: Prisma.TransactionClient,
    snapshot: TenantChatRuntimeSnapshotDocument,
  ) {
    const contentHash = computeTenantChatPolicyDigest(snapshot.policies);
    const existing = await tx.tenantChatRuntimeConfig.findUnique({
      where: {
        tenantId_version: {
          tenantId: snapshot.tenantId,
          version: BigInt(snapshot.policyVersion),
        },
      },
    });
    if (existing) {
      if (existing.contentHash !== contentHash) {
        throw new ConflictException(
          'Tenant Chat policy version is already bound to different content.',
        );
      }
      if (existing.publishState !== RuntimeConfigPublishState.ACTIVE) {
        await this.markRuntimeConfigActive(tx, snapshot.tenantId, existing.id);
      }
      return existing;
    }

    const created = await tx.tenantChatRuntimeConfig.create({
      data: {
        tenantId: snapshot.tenantId,
        version: BigInt(snapshot.policyVersion),
        contentHash,
        publishState: RuntimeConfigPublishState.ACTIVE,
        document: this.toInputJson(snapshot.policies),
        effectiveAt: new Date(snapshot.publishedAt),
        publishedAt: new Date(snapshot.publishedAt),
      },
    });
    await this.supersedeOtherActiveRuntimeConfigs(
      tx,
      snapshot.tenantId,
      created.id,
    );
    return created;
  }

  private async markRuntimeConfigActive(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runtimeConfigId: string,
  ): Promise<void> {
    await this.supersedeOtherActiveRuntimeConfigs(
      tx,
      tenantId,
      runtimeConfigId,
    );
    await tx.tenantChatRuntimeConfig.update({
      where: { id: runtimeConfigId },
      data: { publishState: RuntimeConfigPublishState.ACTIVE },
    });
  }

  private async supersedeOtherActiveRuntimeConfigs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runtimeConfigId: string,
  ): Promise<void> {
    await tx.tenantChatRuntimeConfig.updateMany({
      where: {
        tenantId,
        id: { not: runtimeConfigId },
        publishState: RuntimeConfigPublishState.ACTIVE,
      },
      data: { publishState: RuntimeConfigPublishState.SUPERSEDED },
    });
  }

  private async activateSnapshot(
    tx: Prisma.TransactionClient,
    snapshot: TenantChatRuntimeSnapshotDocument,
    snapshotId: string,
  ): Promise<void> {
    await tx.tenantChatActiveRuntimeSnapshot.upsert({
      where: { tenantId: snapshot.tenantId },
      create: {
        tenantId: snapshot.tenantId,
        snapshotId,
        updatedBy: snapshot.publishedBy,
      },
      update: {
        snapshotId,
        updatedBy: snapshot.publishedBy,
      },
    });
  }

  private toInputJson(value: object): Prisma.InputJsonObject {
    return value as unknown as Prisma.InputJsonObject;
  }

  private toSnapshotDocument(
    value: Prisma.JsonValue,
  ): TenantChatRuntimeSnapshotDocument {
    return value as unknown as TenantChatRuntimeSnapshotDocument;
  }

  private isRetryablePublishConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    );
  }

  private assertDatabaseTenantId(tenantId: string): void {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new BadRequestException(
        'tenantId must be a UUID at the Control Plane persistence boundary.',
      );
    }
  }
}
