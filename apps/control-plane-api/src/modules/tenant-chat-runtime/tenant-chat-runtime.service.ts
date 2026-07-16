import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  computeTenantChatRoutingPolicyHash,
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
  TenantChatRoutingCategory,
  TenantChatRoutingMatrix,
  TenantChatRoutingMode,
  TenantChatRuntimePolicies,
  TenantChatRuntimeRoute,
  TenantChatRuntimeSnapshotDocument,
} from './tenant-chat-runtime.types';
import type { TenantChatModelPricingEntry } from './tenant-chat-model-pricing.catalog';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_DIGEST = `sha256:${'A'.repeat(43)}`;
const UNKNOWN_PRICING_EFFECTIVE_AT = '1970-01-01T00:00:00.000Z';
const ROUTING_CATEGORIES: TenantChatRoutingCategory[] = [
  'general',
  'code',
  'translation',
  'summarization',
  'reasoning',
];
const ROUTING_DIFFICULTIES = ['simple', 'complex'] as const;
const MANDATORY_SAFETY_DETECTORS = new Set([
  'resident_registration_number',
  'api_key',
  'authorization_header',
  'jwt',
  'private_key',
]);

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

interface CurrentPricingRuleRecord {
  provider: string;
  model: string;
  input_micro_usd_per_1m_tokens: bigint;
  output_micro_usd_per_1m_tokens: bigint;
  effective_from: Date;
}

interface ResolvedAdminPrice {
  status: 'available' | 'unavailable';
  source: 'model_pricing_rules' | 'bundled' | 'unavailable';
  effectiveAt: string;
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
  cacheReadInputMicroUsdPerMillionTokens?: number;
}

interface AdminModelTarget {
  modelRef: string;
  providerId: string;
  providerKey: string;
  providerFamily: string;
  modelKey: string;
  price: ResolvedAdminPrice;
}

interface NormalizedAdminRouting {
  mode: TenantChatRoutingMode;
  manualModelRef: string;
  routes: TenantChatRoutingMatrix;
  targets: AdminModelTarget[];
}

@Injectable()
export class TenantChatRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

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

    const currentPricingRules = await this.readCurrentPricingRules(
      this.prisma,
      providers,
    );
    return this.buildAdminRuntimeSetup(providers, pointer, currentPricingRules);
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

    const providers = await tx.providerConnection.findMany({
      where: {
        tenantId: input.tenantId,
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
    });
    if (providers.length === 0) {
      throw new NotFoundException(
        'Active tenant Provider connection not found.',
      );
    }
    const currentPricingRules = await this.readCurrentPricingRules(tx, providers);
    const modelTargets = this.buildAdminModelTargets(
      providers,
      currentPricingRules,
    );
    const routing = this.normalizeAdminRoutingInput(input, modelTargets);

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
    const policies = this.composeAdminPolicies(activeSnapshot, routing, input);
    const pricingRoutes = this.composePricingRoutes(
      policies.routing.routes,
      routing.targets,
    );
    const pricingEffectiveAt = this.pricingEffectiveAt(routing.targets);

    if (
      activeSnapshot &&
      this.isEquivalentAdminPublication(
        activeSnapshot,
        policies,
        pricingEffectiveAt,
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
      effectiveAt: pricingEffectiveAt,
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
    currentPricingRules: CurrentPricingRuleRecord[],
  ): TenantChatAdminRuntimeSetup {
    const modelTargets = this.buildAdminModelTargets(
      providerRecords,
      currentPricingRules,
    );
    const providers = providerRecords.map((provider) =>
      this.toAdminProviderCandidate(provider, modelTargets),
    );
    const snapshot = pointer
      ? this.readValidSnapshotOrNull(pointer.snapshot.snapshotBody)
      : null;
    const activeSnapshot = snapshot
      ? this.toAdminActiveSnapshot(snapshot, providerRecords, modelTargets)
      : null;
    const hasConfiguredModel = providers.some(
      (provider) => provider.models.length > 0,
    );

    let readiness: TenantChatAdminRuntimeSetup['readiness'];
    if (pointer && !activeSnapshot) {
      readiness = 'degraded';
    } else if (activeSnapshot) {
      readiness = 'ready';
    } else if (providers.length === 0) {
      readiness = 'needs_provider';
    } else if (!hasConfiguredModel) {
      readiness = 'needs_model';
    } else {
      readiness = 'needs_activation';
    }

    return { readiness, providers, activeSnapshot };
  }

  private toAdminProviderCandidate(
    provider: AdminProviderRecord,
    targets: AdminModelTarget[],
  ): TenantChatAdminProviderCandidate {
    const providerFamily = this.readProviderFamily(provider.providerConfig);
    return {
      providerConnectionId: provider.id,
      providerKey: provider.provider,
      providerFamily: providerFamily || 'unconfigured',
      displayName: provider.displayName,
      models: this.readConfiguredModels(provider.providerConfig).map(
        (modelKey) => {
          const target = targets.find(
            (candidate) =>
              candidate.providerId === provider.id &&
              candidate.modelKey === modelKey,
          );
          const price = target?.price;
          return {
            modelRef: target?.modelRef ?? this.modelRef(provider.id, modelKey),
            modelKey,
            activationStatus: 'available' as const,
            pricingStatus: price?.status ?? ('unavailable' as const),
            pricing: price?.status === 'available'
              ? {
                  inputMicroUsdPerMillionTokens:
                    price.inputMicroUsdPerMillionTokens,
                  outputMicroUsdPerMillionTokens:
                    price.outputMicroUsdPerMillionTokens,
                  ...(price.cacheReadInputMicroUsdPerMillionTokens !== undefined
                    ? {
                        cacheReadInputMicroUsdPerMillionTokens:
                          price.cacheReadInputMicroUsdPerMillionTokens,
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
    modelTargets: AdminModelTarget[],
  ): TenantChatAdminActiveSnapshot | null {
    const routingPolicy = snapshot.policies.routing.policy;
    const manualModelRef =
      snapshot.policies.routing.manualModelRef ??
      snapshot.policies.routing.routes.find((candidate) => candidate.enabled)
        ?.modelRef;
    const route = routingPolicy
      ? snapshot.policies.routing.routes.find(
          (candidate) =>
            candidate.enabled &&
            candidate.modelRef === manualModelRef,
        )
      : (snapshot.policies.routing.routes.find(
          (candidate) => candidate.enabled && candidate.tier === 'standard',
        ) ?? snapshot.policies.routing.routes.find((candidate) => candidate.enabled));
    if (!route) {
      return null;
    }
    const provider = providers.find((candidate) => candidate.id === route.providerId);
    if (!provider) {
      return null;
    }

    const referencedModelRefs = new Set<string>();
    if (routingPolicy) {
      if (!manualModelRef) {
        return null;
      }
      referencedModelRefs.add(manualModelRef);
      for (const category of ROUTING_CATEGORIES) {
        for (const difficulty of ROUTING_DIFFICULTIES) {
          for (const modelRef of routingPolicy.routes[category][difficulty]
            .modelRefs) {
            referencedModelRefs.add(modelRef);
          }
        }
      }
    }
    const referencedRoutes = routingPolicy
      ? snapshot.policies.routing.routes.filter(
          (candidate) =>
            candidate.enabled &&
            candidate.modelRef !== undefined &&
            referencedModelRefs.has(candidate.modelRef),
        )
      : [route];
    if (
      (routingPolicy && referencedRoutes.length !== referencedModelRefs.size) ||
      referencedRoutes.length === 0
    ) {
      return null;
    }

    const pricingPairs = referencedRoutes.map((runtimeRoute) => {
      const priceRoute = snapshot.pricing.routes.find(
        (candidate) => candidate.routeId === runtimeRoute.routeId,
      );
      const currentTarget = modelTargets.find(
        (candidate) =>
          candidate.providerId === runtimeRoute.providerId &&
          candidate.modelKey === runtimeRoute.modelKey &&
          (!runtimeRoute.modelRef ||
            candidate.modelRef === runtimeRoute.modelRef),
      );
      return { currentTarget, priceRoute };
    });
    if (
      pricingPairs.some(
        ({ currentTarget, priceRoute }) => !currentTarget || !priceRoute,
      )
    ) {
      return null;
    }
    const pricingStatus = pricingPairs.some(
      ({ currentTarget, priceRoute }) =>
        priceRoute?.pricingStatus === 'unavailable' ||
        currentTarget?.price.status === 'unavailable',
    )
      ? ('unavailable' as const)
      : pricingPairs.every(
            ({ currentTarget, priceRoute }) =>
              currentTarget !== undefined &&
              priceRoute !== undefined &&
              this.priceMatchesResolved(priceRoute, currentTarget.price),
          )
        ? ('current' as const)
        : ('update_available' as const);

    const activeManualModelRef =
      manualModelRef ?? this.modelRef(route.providerId, route.modelKey);
    const routes =
      routingPolicy?.routes ?? this.uniformRoutingMatrix(activeManualModelRef);

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
      routingMode: routingPolicy?.mode ?? 'manual',
      manualModelRef: activeManualModelRef,
      routes,
      cachePolicy: {
        enabled: snapshot.policies.cache.enabled,
        ttlSeconds: snapshot.policies.cache.ttlSeconds,
        maxEntriesPerUser: snapshot.policies.cache.maxEntriesPerUser,
      },
      safetyPolicy: {
        detectorSet: snapshot.policies.safety.detectorSet.map((detector) => ({
          ...detector,
        })),
      },
      cacheEnabled:
        snapshot.policies.cache.enabled &&
        snapshot.policies.cache.strategy === 'exact',
    };
  }

  private composeAdminPolicies(
    activeSnapshot: TenantChatRuntimeSnapshotDocument | null,
    routing: NormalizedAdminRouting,
    input: ActivateTenantChatRuntimeInput,
  ): TenantChatRuntimePolicies {
    const safetyWithoutDigest = {
      enabled: true,
      detectorSet: [
        { detectorType: 'email' as const, action: 'redact' as const },
        { detectorType: 'phone_number' as const, action: 'redact' as const },
        { detectorType: 'postal_address' as const, action: 'redact' as const },
        { detectorType: 'person_name' as const, action: 'redact' as const },
        {
          detectorType: 'organization_name' as const,
          action: 'redact' as const,
        },
        {
          detectorType: 'resident_registration_number' as const,
          action: 'block' as const,
        },
        { detectorType: 'api_key' as const, action: 'block' as const },
        {
          detectorType: 'authorization_header' as const,
          action: 'block' as const,
        },
        { detectorType: 'jwt' as const, action: 'block' as const },
        { detectorType: 'private_key' as const, action: 'block' as const },
      ],
    };
    const routingPolicyWithoutHash = {
      schemaVersion: 'gatelm.routing-policy.v2' as const,
      mode: routing.mode,
      bootstrapState: 'configured' as const,
      routes: routing.routes,
    };
    const runtimeRoutes: TenantChatRuntimeRoute[] = routing.targets.map(
      (target) => ({
        routeId: this.routeId(target.modelRef),
        modelRef: target.modelRef,
        providerId: target.providerId,
        modelKey: target.modelKey,
        enabled: true,
      }),
    );
    const providerIds = Array.from(
      new Set(runtimeRoutes.map((route) => route.providerId)),
    );
    const maxRoutingAttempts = ROUTING_CATEGORIES.reduce(
      (maximum, category) =>
        ROUTING_DIFFICULTIES.reduce(
          (cellMaximum, difficulty) =>
            Math.max(
              cellMaximum,
              routing.routes[category][difficulty].modelRefs.length,
            ),
          maximum,
        ),
      1,
    );
    const previousCache = activeSnapshot?.policies.cache ?? {
      strategy: 'exact' as const,
      enabled: true,
      ttlSeconds: 300,
      maxEntriesPerUser: 100,
      keySetId: this.cacheKeySetId(),
    };
    if (
      input.cachePolicy &&
      (!Number.isSafeInteger(input.cachePolicy.ttlSeconds) ||
        input.cachePolicy.ttlSeconds < 1 ||
        !Number.isSafeInteger(input.cachePolicy.maxEntriesPerUser) ||
        input.cachePolicy.maxEntriesPerUser < 1)
    ) {
      throw new BadRequestException(
        'Tenant Chat cache policy values must be positive safe integers.',
      );
    }
    const cache = input.cachePolicy
      ? {
          ...previousCache,
          strategy: input.cachePolicy.enabled
            ? ('exact' as const)
            : ('off' as const),
          enabled: input.cachePolicy.enabled,
          ttlSeconds: input.cachePolicy.ttlSeconds,
          maxEntriesPerUser: input.cachePolicy.maxEntriesPerUser,
        }
      : input.cacheEnabled !== undefined
        ? {
            ...previousCache,
            strategy: input.cacheEnabled
              ? ('exact' as const)
              : ('off' as const),
            enabled: input.cacheEnabled,
          }
      : previousCache;
    const previousSafety = activeSnapshot?.policies.safety ?? {
      ...safetyWithoutDigest,
      policyDigest: computeTenantChatSafetyPolicyDigest(safetyWithoutDigest),
    };
    const safety = input.safetyPolicy
      ? (() => {
          if (
            input.safetyPolicy.detectorSet.length < 1 ||
            input.safetyPolicy.detectorSet.length > 10 ||
            new Set(
              input.safetyPolicy.detectorSet.map(
                (detector) => detector.detectorType,
              ),
            ).size !== input.safetyPolicy.detectorSet.length
          ) {
            throw new BadRequestException(
              'Tenant Chat safety policy requires 1 to 10 unique detectors.',
            );
          }
          if (
            input.safetyPolicy.detectorSet.some(
              (detector) =>
                detector.action === 'allow' &&
                MANDATORY_SAFETY_DETECTORS.has(detector.detectorType),
            )
          ) {
            throw new BadRequestException(
              'Mandatory Tenant Chat safety detectors cannot be disabled.',
            );
          }
          const safetyWithoutDigest = {
            enabled: true,
            detectorSet: input.safetyPolicy.detectorSet.map((detector) => ({
              ...detector,
            })),
          };
          return {
            ...safetyWithoutDigest,
            policyDigest: computeTenantChatSafetyPolicyDigest(safetyWithoutDigest),
          };
        })()
      : previousSafety;

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
        routes: runtimeRoutes,
        policy: {
          ...routingPolicyWithoutHash,
          routingPolicyHash: computeTenantChatRoutingPolicyHash(
            routingPolicyWithoutHash,
          ),
        },
        manualModelRef: routing.manualModelRef,
      },
      fallback: {
        enabled: maxRoutingAttempts > 1,
        routeIds: [],
        maxAttempts: maxRoutingAttempts,
        allowedReasons:
          maxRoutingAttempts > 1
            ? ['provider_timeout', 'provider_error_pre_delta']
            : [],
      },
      providerTokenRate: {
        providers: providerIds.map((providerId) => ({
          providerId,
          limitTokens: 120_000,
          windowSeconds: 60,
        })),
      },
      cache,
      safety,
      streaming: activeSnapshot?.policies.streaming ?? {
        enabled: true,
        maxDurationSeconds: 120,
        finalEventRequired: true,
      },
    };
  }

  private composePricingRoutes(
    runtimeRoutes: TenantChatRuntimeRoute[],
    targets: AdminModelTarget[],
  ): TenantChatPricing['routes'] {
    return runtimeRoutes.map((route) => {
      const target = targets.find(
        (candidate) => candidate.modelRef === route.modelRef,
      );
      if (!target) {
        throw new BadRequestException(
          `Routing target ${route.modelRef ?? route.routeId} is not configured.`,
        );
      }
      const price = target.price;
      return {
        routeId: route.routeId,
        providerId: route.providerId,
        modelKey: route.modelKey,
        pricingStatus: price.status,
        pricingSource: price.source,
        inputMicroUsdPerMillionTokens: price.inputMicroUsdPerMillionTokens,
        outputMicroUsdPerMillionTokens: price.outputMicroUsdPerMillionTokens,
        ...(price.cacheReadInputMicroUsdPerMillionTokens !== undefined
        ? {
            cacheReadInputMicroUsdPerMillionTokens:
              price.cacheReadInputMicroUsdPerMillionTokens,
          }
        : {}),
      };
    });
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

  private cacheKeySetId(): string {
    return (
      this.config?.get<string>('TENANT_CHAT_CACHE_KEY_SET_ID') ??
      'tenant_chat_cache_keys_v1'
    );
  }

  private priceMatchesResolved(
    route: TenantChatPricing['routes'][number],
    price: ResolvedAdminPrice,
  ): boolean {
    return (
      route.pricingStatus === price.status &&
      route.pricingSource === price.source &&
      route.inputMicroUsdPerMillionTokens ===
        price.inputMicroUsdPerMillionTokens &&
      route.outputMicroUsdPerMillionTokens ===
        price.outputMicroUsdPerMillionTokens &&
      route.cacheReadInputMicroUsdPerMillionTokens ===
        price.cacheReadInputMicroUsdPerMillionTokens
    );
  }

  private modelRef(providerId: string, modelKey: string): string {
    const suffix = createHash('sha256')
      .update(`${providerId}\u0000${modelKey}`, 'utf8')
      .digest('hex')
      .slice(0, 32);
    return `tc_${suffix}`;
  }

  private routeId(modelRef: string): string {
    return `route_${modelRef}`;
  }

  private normalizeAdminRoutingInput(
    input: ActivateTenantChatRuntimeInput,
    modelTargets: AdminModelTarget[],
  ): NormalizedAdminRouting {
    const targetsByRef = new Map(
      modelTargets.map((target) => [target.modelRef, target] as const),
    );
    const hasLegacySelection = Boolean(
      input.providerConnectionId || input.modelKey,
    );
    if (
      hasLegacySelection &&
      (!input.providerConnectionId || !input.modelKey)
    ) {
      throw new BadRequestException(
        'providerConnectionId and modelKey must be provided together.',
      );
    }

    let routes = input.routes;
    let legacyModelRef: string | undefined;
    if (!routes && input.providerConnectionId && input.modelKey) {
      legacyModelRef = this.modelRef(
        input.providerConnectionId,
        input.modelKey,
      );
      if (!targetsByRef.has(legacyModelRef)) {
        throw new BadRequestException(
          'The selected model is not configured for this Provider connection.',
        );
      }
      routes = this.uniformRoutingMatrix(legacyModelRef);
    }
    if (!routes) {
      throw new BadRequestException(
        'A complete 5 x 2 Tenant Chat routing matrix is required.',
      );
    }

    const normalizedRoutes = this.validateAndCloneRoutingMatrix(
      routes,
      targetsByRef,
    );
    const manualModelRef =
      input.manualModelRef ??
      legacyModelRef ??
      normalizedRoutes.general.simple.modelRefs[0];
    if (!manualModelRef || !targetsByRef.has(manualModelRef)) {
      throw new BadRequestException(
        'manualModelRef must reference a configured Tenant Chat model.',
      );
    }

    const usedRefs = new Set<string>([manualModelRef]);
    for (const category of ROUTING_CATEGORIES) {
      for (const difficulty of ROUTING_DIFFICULTIES) {
        for (const modelRef of normalizedRoutes[category][difficulty].modelRefs) {
          usedRefs.add(modelRef);
        }
      }
    }

    return {
      mode: input.routingMode ?? (legacyModelRef ? 'manual' : 'auto'),
      manualModelRef,
      routes: normalizedRoutes,
      targets: modelTargets.filter((target) => usedRefs.has(target.modelRef)),
    };
  }

  private validateAndCloneRoutingMatrix(
    routes: TenantChatRoutingMatrix,
    targetsByRef: ReadonlyMap<string, AdminModelTarget>,
  ): TenantChatRoutingMatrix {
    const clone = {} as TenantChatRoutingMatrix;
    for (const category of ROUTING_CATEGORIES) {
      const categoryRoutes = routes[category];
      if (!categoryRoutes) {
        throw new BadRequestException(
          `Routing category ${category} is required.`,
        );
      }
      clone[category] = {} as TenantChatRoutingMatrix[typeof category];
      for (const difficulty of ROUTING_DIFFICULTIES) {
        const modelRefs = categoryRoutes[difficulty]?.modelRefs;
        if (
          !Array.isArray(modelRefs) ||
          modelRefs.length < 1 ||
          modelRefs.length > 4 ||
          new Set(modelRefs).size !== modelRefs.length
        ) {
          throw new BadRequestException(
            `Routing cell ${category}.${difficulty} must contain 1 to 4 unique modelRefs.`,
          );
        }
        for (const modelRef of modelRefs) {
          if (!targetsByRef.has(modelRef)) {
            throw new BadRequestException(
              `Routing cell ${category}.${difficulty} references an unavailable modelRef.`,
            );
          }
        }
        clone[category][difficulty] = { modelRefs: [...modelRefs] };
      }
    }
    return clone;
  }

  private uniformRoutingMatrix(modelRef: string): TenantChatRoutingMatrix {
    const cell = () => ({ modelRefs: [modelRef] });
    return {
      general: { simple: cell(), complex: cell() },
      code: { simple: cell(), complex: cell() },
      translation: { simple: cell(), complex: cell() },
      summarization: { simple: cell(), complex: cell() },
      reasoning: { simple: cell(), complex: cell() },
    };
  }

  private buildAdminModelTargets(
    providers: AdminProviderRecord[],
    currentPricingRules: CurrentPricingRuleRecord[],
  ): AdminModelTarget[] {
    const pricingByProviderAndModel = new Map<string, CurrentPricingRuleRecord>();
    for (const rule of currentPricingRules) {
      const key = `${rule.provider}\u0000${rule.model}`;
      if (!pricingByProviderAndModel.has(key)) {
        pricingByProviderAndModel.set(key, rule);
      }
    }

    return providers.flatMap((provider) => {
      const providerFamily = this.readProviderFamily(provider.providerConfig);
      return this.readConfiguredModels(provider.providerConfig).map((modelKey) => ({
        modelRef: this.modelRef(provider.id, modelKey),
        providerId: provider.id,
        providerKey: provider.provider,
        providerFamily: providerFamily || 'unconfigured',
        modelKey,
        price: this.resolveAdminPrice(
          provider.provider,
          providerFamily,
          modelKey,
          pricingByProviderAndModel,
        ),
      }));
    });
  }

  private resolveAdminPrice(
    providerKey: string,
    providerFamily: string,
    modelKey: string,
    pricingByProviderAndModel: ReadonlyMap<string, CurrentPricingRuleRecord>,
  ): ResolvedAdminPrice {
    for (const lookupProvider of [providerKey, providerFamily]) {
      if (!lookupProvider) {
        continue;
      }
      const rule = pricingByProviderAndModel.get(
        `${lookupProvider}\u0000${modelKey}`,
      );
      const resolved = rule ? this.priceFromCurrentRule(rule) : null;
      if (resolved) {
        return resolved;
      }
    }

    const bundled = findTenantChatModelPricing(providerFamily, modelKey);
    return bundled
      ? this.priceFromBundledCatalog(bundled)
      : {
          status: 'unavailable',
          source: 'unavailable',
          effectiveAt: UNKNOWN_PRICING_EFFECTIVE_AT,
          inputMicroUsdPerMillionTokens: 0,
          outputMicroUsdPerMillionTokens: 0,
        };
  }

  private priceFromCurrentRule(
    rule: CurrentPricingRuleRecord,
  ): ResolvedAdminPrice | null {
    const inputPrice = Number(rule.input_micro_usd_per_1m_tokens);
    const outputPrice = Number(rule.output_micro_usd_per_1m_tokens);
    const effectiveAt = new Date(rule.effective_from);
    if (
      !Number.isSafeInteger(inputPrice) ||
      inputPrice < 0 ||
      !Number.isSafeInteger(outputPrice) ||
      outputPrice < 0 ||
      Number.isNaN(effectiveAt.getTime())
    ) {
      return null;
    }
    return {
      status: 'available',
      source: 'model_pricing_rules',
      effectiveAt: effectiveAt.toISOString(),
      inputMicroUsdPerMillionTokens: inputPrice,
      outputMicroUsdPerMillionTokens: outputPrice,
    };
  }

  private priceFromBundledCatalog(
    price: TenantChatModelPricingEntry,
  ): ResolvedAdminPrice {
    return {
      status: 'available',
      source: 'bundled',
      effectiveAt: price.effectiveAt,
      inputMicroUsdPerMillionTokens: price.inputMicroUsdPerMillionTokens,
      outputMicroUsdPerMillionTokens: price.outputMicroUsdPerMillionTokens,
      ...(price.cacheReadInputMicroUsdPerMillionTokens !== undefined
        ? {
            cacheReadInputMicroUsdPerMillionTokens:
              price.cacheReadInputMicroUsdPerMillionTokens,
          }
        : {}),
    };
  }

  private pricingEffectiveAt(targets: AdminModelTarget[]): string {
    return targets.reduce(
      (latest, target) =>
        target.price.effectiveAt > latest ? target.price.effectiveAt : latest,
      UNKNOWN_PRICING_EFFECTIVE_AT,
    );
  }

  private async readCurrentPricingRules(
    client: Pick<Prisma.TransactionClient, '$queryRaw'>,
    providers: AdminProviderRecord[],
  ): Promise<CurrentPricingRuleRecord[]> {
    if (typeof client.$queryRaw !== 'function') {
      return [];
    }
    const providerKeys = Array.from(
      new Set(
        providers.flatMap((provider) => [
          provider.provider,
          this.readProviderFamily(provider.providerConfig),
        ]),
      ),
    ).filter(Boolean);
    const modelKeys = Array.from(
      new Set(
        providers.flatMap((provider) =>
          this.readConfiguredModels(provider.providerConfig),
        ),
      ),
    );
    if (providerKeys.length === 0 || modelKeys.length === 0) {
      return [];
    }

    try {
      const rows = await client.$queryRaw<CurrentPricingRuleRecord[]>(
        Prisma.sql`
          select distinct on (provider, model)
            provider,
            model,
            input_micro_usd_per_1m_tokens,
            output_micro_usd_per_1m_tokens,
            effective_from
          from model_pricing_rules
          where provider in (${Prisma.join(providerKeys)})
            and model in (${Prisma.join(modelKeys)})
            and currency = 'USD'
            and effective_from <= now()
            and (effective_to is null or effective_to > now())
          order by provider, model, effective_from desc, created_at desc
        `,
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      // The shared pricing table predates Tenant Chat in some installations.
      // Bundled pricing and the explicit unavailable state remain valid fallbacks.
      return [];
    }
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
