import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppToken,
  CredentialStatus,
  GatewayApiKey,
  Prisma,
  ProviderConnection,
  ProviderConnectionStatus,
  ResourceStatus,
  RuntimeConfig,
  RuntimeConfigPublishState,
  RuntimeSnapshot,
} from '@prisma/client';
import { createHash } from 'node:crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ActiveRuntimeConfigResponseDto,
  ListRuntimeConfigHistoryQueryDto,
  MAX_RUNTIME_MODEL_CONTEXT_WINDOW_TOKENS,
  PublishRuntimeConfigDto,
  ProviderCatalogResponseDto,
  RUNTIME_CONFIG_ROUTING_CATEGORIES,
  RUNTIME_CONFIG_VERSION_PATTERN,
  RollbackRuntimeConfigDto,
  ResourceStatusDto,
  RuntimeConfigBudgetPolicyResponseDto,
  RuntimeConfigCachePolicyResponseDto,
  RuntimeConfigCostingDto,
  RuntimeConfigCredentialRefDto,
  RuntimeConfigDraftResponseDto,
  RuntimeConfigHashingDto,
  RuntimeConfigHistoryDetailResponseDto,
  RuntimeConfigHistoryItemDto,
  RuntimeConfigHistoryResponseDto,
  RuntimeConfigModelResponseDto,
  RuntimeConfigPricingRuleResponseDto,
  RuntimeConfigPromptCapturePolicyResponseDto,
  RuntimeConfigProviderDto,
  RuntimeConfigRateLimitResponseDto,
  RuntimeConfigResponseCapturePolicyResponseDto,
  RuntimeConfigRoutingPolicyResponseDto,
  RuntimeConfigRoutingRoutesDto,
  RuntimeConfigSafetyDetectorResponseDto,
  RuntimeConfigSafetyPolicyResponseDto,
  RuntimeSnapshotResponseDto,
  UpsertRuntimeConfigDraftDto,
} from './dto/runtime-config.dto';

const DEFAULT_DRAFT_CONFIG_VERSION = 'draft';
const CONFIG_HASH_ALGORITHM =
  'sha256(canonical_json(runtimeConfig_without_configHash))';
const ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE =
  'Active Runtime Config is not executable.';
const MISSING_PROVIDER_CREDENTIAL_BINDING_MESSAGE =
  'RuntimeSnapshot publish validation failed: provider credential binding is missing.';
const DEFAULT_PUBLISHED_BY = 'control_plane';
const DEFAULT_GATEWAY_INSTANCE_ID = 'gateway_core_static';
const DEFAULT_BUDGET_WARNING_THRESHOLD_PERCENT = 80;
const PROVIDER_CATALOG_ID_PREFIX = 'provider_catalog';
const DEFAULT_PROMPT_CAPTURE_MAX_CHARS = 8000;
const DEFAULT_RESPONSE_CAPTURE_MAX_CHARS = 8000;
const BUILTIN_MOCK_MODEL_REF = 'mock-balanced';
const BUILTIN_MOCK_PROVIDER_ID = '00000000-0000-4000-8000-000000000001';
const BUILTIN_MOCK_PROVIDER_NAME = 'mock';
const BUILTIN_MOCK_PROVIDER_BASE_URL = 'http://mock-provider:8090';
const ROUTING_DIFFICULTIES = ['simple', 'complex'] as const;
const LEGACY_ROUTING_FIELDS = [
  'defaultProvider',
  'defaultModel',
  'lowCostProvider',
  'lowCostModel',
  'highQualityProvider',
  'highQualityModel',
  'fallbackProvider',
  'fallbackModel',
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const FORBIDDEN_RUNTIME_CONFIG_KEYS = new Set([
  'secretHash',
  'plaintext',
  'authorizationHeader',
  'rawCredential',
  'rawProviderKey',
  'apiKeySecret',
  'appTokenSecret',
  'providerKey',
]);
const MANDATORY_SAFETY_DETECTORS = new Set([
  'resident_registration_number',
  'api_key',
  'authorization_header',
  'jwt',
  'private_key',
]);

type RuntimeApplicationContext = NonNullable<
  Awaited<ReturnType<PrismaService['application']['findUnique']>>
> & {
  tenant: { id: string; status: ResourceStatus };
  project: { id: string; status: ResourceStatus };
};

type RoutingProvider = Pick<
  ProviderConnection,
  'id' | 'provider' | 'status'
>;

@Injectable()
export class RuntimeConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveRuntimeConfig(
    applicationId: string,
  ): Promise<ActiveRuntimeConfigResponseDto> {
    const { document } = await this.getExecutableActiveRuntimeConfig({
      applicationId,
      notFoundMessage: 'Active Runtime Config not found.',
    });

    return document;
  }

  async listRuntimeConfigHistory(
    applicationId: string,
    query: ListRuntimeConfigHistoryQueryDto = {},
  ): Promise<RuntimeConfigHistoryResponseDto> {
    await this.getApplicationContextOrThrow(applicationId);
    const limit = query.limit ?? 50;
    const runtimeConfigs = await this.prisma.runtimeConfig.findMany({
      where: { applicationId },
      select: {
        id: true,
        configVersion: true,
        configHash: true,
        publishState: true,
        effectiveAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = runtimeConfigs.length > limit;
    const page = runtimeConfigs.slice(0, limit);

    return {
      applicationId,
      items: page.map((runtimeConfig) =>
        this.toRuntimeConfigHistoryItem(runtimeConfig),
      ),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async getRuntimeConfigHistoryDetail(
    applicationId: string,
    configVersion: string,
  ): Promise<RuntimeConfigHistoryDetailResponseDto> {
    await this.getApplicationContextOrThrow(applicationId);
    const requestedConfigVersion =
      this.toRuntimeConfigVersionForLookup(configVersion);
    if (!requestedConfigVersion) {
      throw new NotFoundException('Runtime Config history item not found.');
    }

    const runtimeConfig = await this.prisma.runtimeConfig.findUnique({
      where: {
        applicationId_configVersion: {
          applicationId,
          configVersion: requestedConfigVersion,
        },
      },
      select: {
        id: true,
        configVersion: true,
        configHash: true,
        publishState: true,
        document: true,
        effectiveAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!runtimeConfig) {
      throw new NotFoundException('Runtime Config history item not found.');
    }

    const migrated = this.readRuntimeConfigDocument(runtimeConfig);
    const { document } = migrated;
    this.assertNoForbiddenRuntimeConfigKeys(document);

    return {
      applicationId,
      item: this.toRuntimeConfigHistoryItem(migrated.runtimeConfig),
      runtimeConfig: {
        ...document,
        publishState: this.toRuntimeConfigPublishState(
          runtimeConfig.publishState,
        ),
      },
    };
  }

  async getActiveRuntimeSnapshot(
    applicationId: string,
  ): Promise<RuntimeSnapshotResponseDto> {
    const persistedSnapshot =
      await this.getPersistedActiveRuntimeSnapshot(applicationId);
    if (persistedSnapshot) {
      return persistedSnapshot;
    }

    const { runtimeConfig, document } =
      await this.getExecutableActiveRuntimeConfig({
        applicationId,
        notFoundMessage: 'Active RuntimeSnapshot not found.',
      });

    return this.toRuntimeSnapshotResponse(runtimeConfig, document);
  }

  async getActiveProviderCatalog(
    applicationId: string,
  ): Promise<ProviderCatalogResponseDto> {
    const persistedCatalog =
      await this.getPersistedActiveProviderCatalog(applicationId);
    if (persistedCatalog) {
      return persistedCatalog;
    }

    const { runtimeConfig, document } =
      await this.getExecutableActiveRuntimeConfig({
        applicationId,
        notFoundMessage: 'Active Provider Catalog not found.',
      });

    return this.toProviderCatalogResponse(runtimeConfig, document);
  }

  async getProviderCatalog(
    catalogId: string,
  ): Promise<ProviderCatalogResponseDto> {
    const parsedCatalogId = this.parseProviderCatalogId(catalogId);
    const persistedCatalog = await this.getPersistedProviderCatalog({
      applicationId: parsedCatalogId.applicationId,
      catalogId,
      catalogVersion: parsedCatalogId.catalogVersion,
    });
    if (persistedCatalog) {
      return persistedCatalog;
    }

    const catalog = await this.getActiveProviderCatalog(
      parsedCatalogId.applicationId,
    );

    if (
      catalog.catalogId !== catalogId ||
      catalog.catalogVersion !== parsedCatalogId.catalogVersion
    ) {
      throw new NotFoundException('Provider Catalog not found.');
    }

    return catalog;
  }

  private async getPersistedActiveProviderCatalog(
    applicationId: string,
  ): Promise<ProviderCatalogResponseDto | null> {
    const application = await this.getApplicationContextOrThrow(
      applicationId,
    );
    this.assertActiveContext(application);
    const activeSnapshot =
      await this.prisma.activeRuntimeSnapshot.findUnique({
        where: {
          tenantId_projectId_applicationId: {
            tenantId: application.tenantId,
            projectId: application.projectId,
            applicationId,
          },
        },
        include: {
          runtimeSnapshot: {
            include: {
              runtimeConfig: true,
            },
          },
        },
      });

    if (!activeSnapshot) {
      return null;
    }

    if (
      activeSnapshot.runtimeSnapshot.tenantId !== activeSnapshot.tenantId ||
      activeSnapshot.runtimeSnapshot.projectId !== activeSnapshot.projectId ||
      activeSnapshot.runtimeSnapshot.applicationId !==
        activeSnapshot.applicationId
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }

    if (
      this.isPersistedLegacyRuntimeSnapshot(activeSnapshot.runtimeSnapshot)
    ) {
      const compatibility =
        this.toLegacyRuntimeSnapshotCompatibilityResponse(
          activeSnapshot.runtimeSnapshot,
        );
      return this.toProviderCatalogResponse(
        compatibility.runtimeConfig,
        compatibility.document,
      );
    }

    return this.toPersistedProviderCatalogResponse(
      activeSnapshot.runtimeSnapshot,
    );
  }

  private async getPersistedProviderCatalog(args: {
    applicationId: string;
    catalogId: string;
    catalogVersion: number;
  }): Promise<ProviderCatalogResponseDto | null> {
    const application = await this.getApplicationContextOrThrow(
      args.applicationId,
    );
    this.assertActiveContext(application);
    const runtimeSnapshot = await this.prisma.runtimeSnapshot.findUnique({
      where: {
        applicationId_version: {
          applicationId: args.applicationId,
          version: BigInt(args.catalogVersion),
        },
      },
      include: {
        runtimeConfig: true,
      },
    });

    if (!runtimeSnapshot) {
      return null;
    }

    if (
      runtimeSnapshot.tenantId !== application.tenantId ||
      runtimeSnapshot.projectId !== application.projectId ||
      runtimeSnapshot.applicationId !== application.id
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }

    if (this.isPersistedLegacyRuntimeSnapshot(runtimeSnapshot)) {
      const compatibility =
        this.toLegacyRuntimeSnapshotCompatibilityResponse(runtimeSnapshot);
      const catalog = this.toProviderCatalogResponse(
        compatibility.runtimeConfig,
        compatibility.document,
      );
      if (
        catalog.catalogId !== args.catalogId ||
        catalog.catalogVersion !== args.catalogVersion
      ) {
        throw new NotFoundException('Provider Catalog not found.');
      }
      return catalog;
    }

    const snapshot = this.toPersistedRuntimeSnapshotResponse(
      runtimeSnapshot,
    );
    if (
      snapshot.providerCatalogRef.catalogId !== args.catalogId ||
      snapshot.providerCatalogRef.catalogVersion !== args.catalogVersion
    ) {
      throw new NotFoundException('Provider Catalog not found.');
    }

    return this.toPersistedProviderCatalogResponse(runtimeSnapshot);
  }

  private async getPersistedActiveRuntimeSnapshot(
    applicationId: string,
  ): Promise<RuntimeSnapshotResponseDto | null> {
    const application = await this.getApplicationContextOrThrow(
      applicationId,
    );
    this.assertActiveContext(application);
    const activeSnapshot =
      await this.prisma.activeRuntimeSnapshot.findUnique({
        where: {
          tenantId_projectId_applicationId: {
            tenantId: application.tenantId,
            projectId: application.projectId,
            applicationId,
          },
        },
        include: {
          runtimeSnapshot: {
            include: {
              runtimeConfig: true,
            },
          },
        },
      });

    if (!activeSnapshot) {
      return null;
    }

    if (
      activeSnapshot.runtimeSnapshot.tenantId !== activeSnapshot.tenantId ||
      activeSnapshot.runtimeSnapshot.projectId !== activeSnapshot.projectId ||
      activeSnapshot.runtimeSnapshot.applicationId !==
        activeSnapshot.applicationId
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }

    if (
      this.isPersistedLegacyRuntimeSnapshot(activeSnapshot.runtimeSnapshot)
    ) {
      return this.toLegacyRuntimeSnapshotCompatibilityResponse(
        activeSnapshot.runtimeSnapshot,
      ).snapshot;
    }

    const snapshot = this.toPersistedRuntimeSnapshotResponse(
      activeSnapshot.runtimeSnapshot,
    );
    if (
      snapshot.lookupKey?.tenantId !== activeSnapshot.tenantId ||
      snapshot.lookupKey?.projectId !== activeSnapshot.projectId ||
      snapshot.lookupKey?.applicationId !== activeSnapshot.applicationId
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }

    return snapshot;
  }

  private async getExecutableActiveRuntimeConfig(args: {
    applicationId: string;
    notFoundMessage: string;
  }): Promise<{
    runtimeConfig: RuntimeConfig;
    document: ActiveRuntimeConfigResponseDto;
  }> {
    const { applicationId, notFoundMessage } = args;
    const storedRuntimeConfig = await this.prisma.runtimeConfig.findFirst({
      where: {
        applicationId,
        publishState: RuntimeConfigPublishState.ACTIVE,
      },
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    if (!storedRuntimeConfig) {
      throw new NotFoundException(notFoundMessage);
    }

    const { runtimeConfig, document } =
      this.readRuntimeConfigDocument(storedRuntimeConfig);
    await this.assertRuntimeConfigExecutable({
      applicationId,
      runtimeConfig,
      document,
      now: new Date(),
    });

    return { runtimeConfig, document };
  }

  async upsertDraft(
    applicationId: string,
    dto: UpsertRuntimeConfigDraftDto,
  ): Promise<RuntimeConfigDraftResponseDto> {
    const now = new Date();
    const configVersion =
      dto.configVersion?.trim() || DEFAULT_DRAFT_CONFIG_VERSION;
    const document = await this.buildRuntimeConfigDocument({
      applicationId,
      configVersion,
      dto,
      publishState: 'draft',
      now,
      publishedAt: now,
    });

    const existing = await this.prisma.runtimeConfig.findUnique({
      where: {
        applicationId_configVersion: {
          applicationId,
          configVersion,
        },
      },
    });

    if (
      existing &&
      existing.publishState !== RuntimeConfigPublishState.DRAFT
    ) {
      throw new ConflictException(
        'Runtime Config version is already published.',
      );
    }

    let saved: RuntimeConfig;
    try {
      saved = existing
        ? await this.prisma.runtimeConfig.update({
            where: { id: existing.id },
            data: {
              configHash: document.configHash,
              document: this.toInputJsonObject(document),
              effectiveAt: this.toDate(document.effectiveAt),
              publishedAt: null,
            },
          })
        : await this.prisma.runtimeConfig.create({
            data: {
              tenantId: document.tenantId,
              projectId: document.projectId,
              applicationId: document.applicationId,
              configVersion: document.configVersion,
              configHash: document.configHash,
              publishState: RuntimeConfigPublishState.DRAFT,
              document: this.toInputJsonObject(document),
              effectiveAt: this.toDate(document.effectiveAt),
              publishedAt: null,
            },
          });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Runtime Config draft already exists. Retry the request.',
        );
      }

      throw error;
    }

    return this.toDraftResponse(saved);
  }

  async publishRuntimeConfig(
    applicationId: string,
    dto: PublishRuntimeConfigDto,
  ): Promise<ActiveRuntimeConfigResponseDto> {
    const now = new Date();
    const draftConfigVersion =
      dto.draftConfigVersion?.trim() || DEFAULT_DRAFT_CONFIG_VERSION;
    const draft = await this.prisma.runtimeConfig.findFirst({
      where: {
        applicationId,
        configVersion: draftConfigVersion,
        publishState: RuntimeConfigPublishState.DRAFT,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!draft) {
      throw new NotFoundException('Runtime Config draft not found.');
    }

    const { document: draftDocument } =
      this.readRuntimeConfigDocument(draft);
    const activeConfigVersion =
      dto.configVersion?.trim() || this.createPublishedConfigVersion(now);
    if (activeConfigVersion === draft.configVersion) {
      throw new ConflictException(
        'Published Runtime Config version must differ from the draft version.',
      );
    }

    const activeDocument = await this.buildRuntimeConfigDocument({
      applicationId,
      configVersion: activeConfigVersion,
      dto: this.toDraftDto(draftDocument, dto.effectiveAt),
      publishState: 'active',
      now,
      publishedAt: now,
    });

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.runtimeConfig.updateMany({
            where: {
              applicationId,
              publishState: RuntimeConfigPublishState.ACTIVE,
            },
            data: {
              publishState: RuntimeConfigPublishState.SUPERSEDED,
            },
          });

          const runtimeConfig = await tx.runtimeConfig.create({
            data: {
              tenantId: activeDocument.tenantId,
              projectId: activeDocument.projectId,
              applicationId: activeDocument.applicationId,
              configVersion: activeDocument.configVersion,
              configHash: activeDocument.configHash,
              publishState: RuntimeConfigPublishState.ACTIVE,
              document: this.toInputJsonObject(activeDocument),
              effectiveAt: this.toDate(activeDocument.effectiveAt),
              publishedAt: this.toDate(activeDocument.publishedAt),
            },
          });
          await this.persistActiveRuntimeSnapshot({
            tx,
            runtimeConfig,
            document: activeDocument,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Runtime Config version already exists for this application.',
        );
      }
      if (this.isConcurrentWriteError(error)) {
        throw new ConflictException(
          'Runtime Config publish conflicted. Retry the request.',
        );
      }

      throw error;
    }

    return activeDocument;
  }

  async rollbackRuntimeConfig(
    applicationId: string,
    dto: RollbackRuntimeConfigDto,
  ): Promise<ActiveRuntimeConfigResponseDto> {
    const now = new Date();
    const targetConfigVersion = dto.targetConfigVersion?.trim();
    if (!targetConfigVersion) {
      throw new ConflictException(
        'Runtime Config rollback target version is required.',
      );
    }
    const target = await this.prisma.runtimeConfig.findUnique({
      where: {
        applicationId_configVersion: {
          applicationId,
          configVersion: targetConfigVersion,
        },
      },
    });

    if (!target) {
      throw new NotFoundException('Runtime Config rollback target not found.');
    }
    if (
      target.publishState !== RuntimeConfigPublishState.SUPERSEDED &&
      target.publishState !== RuntimeConfigPublishState.ROLLED_BACK
    ) {
      throw new ConflictException(
        'Runtime Config rollback target must be a previous published version.',
      );
    }

    const { document: targetDocument } =
      this.readRuntimeConfigDocument(target);
    const rollbackConfigVersion =
      dto.rollbackConfigVersion?.trim() ||
      this.createRollbackConfigVersion(target.configVersion, now);
    if (rollbackConfigVersion === target.configVersion) {
      throw new ConflictException(
        'Rollback Runtime Config version must differ from the target version.',
      );
    }

    const activeDocument = await this.buildRuntimeConfigDocument({
      applicationId,
      configVersion: rollbackConfigVersion,
      dto: this.toDraftDto(targetDocument, dto.effectiveAt ?? now.toISOString()),
      publishState: 'active',
      now,
      publishedAt: now,
    });

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.runtimeConfig.updateMany({
            where: {
              applicationId,
              publishState: RuntimeConfigPublishState.ACTIVE,
            },
            data: {
              publishState: RuntimeConfigPublishState.ROLLED_BACK,
            },
          });

          const runtimeConfig = await tx.runtimeConfig.create({
            data: {
              tenantId: activeDocument.tenantId,
              projectId: activeDocument.projectId,
              applicationId: activeDocument.applicationId,
              configVersion: activeDocument.configVersion,
              configHash: activeDocument.configHash,
              publishState: RuntimeConfigPublishState.ACTIVE,
              document: this.toInputJsonObject(activeDocument),
              effectiveAt: this.toDate(activeDocument.effectiveAt),
              publishedAt: this.toDate(activeDocument.publishedAt),
            },
          });
          await this.persistActiveRuntimeSnapshot({
            tx,
            runtimeConfig,
            document: activeDocument,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Runtime Config version already exists for this application.',
        );
      }
      if (this.isConcurrentWriteError(error)) {
        throw new ConflictException(
          'Runtime Config rollback conflicted. Retry the request.',
        );
      }

      throw error;
    }

    return activeDocument;
  }

  private async persistActiveRuntimeSnapshot(args: {
    tx: Prisma.TransactionClient;
    runtimeConfig: RuntimeConfig;
    document: ActiveRuntimeConfigResponseDto;
  }): Promise<void> {
    const snapshot = this.toRuntimeSnapshotResponse(
      args.runtimeConfig,
      args.document,
    );
    await args.tx.runtimeSnapshot.create({
      data: {
        id: snapshot.runtimeSnapshotId,
        tenantId: args.document.tenantId,
        projectId: args.document.projectId,
        applicationId: args.document.applicationId,
        runtimeConfigId: args.runtimeConfig.id,
        version: BigInt(snapshot.runtimeSnapshotVersion),
        contentHash: snapshot.contentHash,
        snapshotBody: this.toInputJsonObject(snapshot),
        publishedAt: this.toDate(snapshot.publishedAt),
        publishedBy: snapshot.publishedBy,
      },
    });
    await args.tx.activeRuntimeSnapshot.upsert({
      where: {
        tenantId_projectId_applicationId: {
          tenantId: args.document.tenantId,
          projectId: args.document.projectId,
          applicationId: args.document.applicationId,
        },
      },
      update: {
        runtimeSnapshotId: snapshot.runtimeSnapshotId,
        updatedBy: snapshot.publishedBy,
      },
      create: {
        tenantId: args.document.tenantId,
        projectId: args.document.projectId,
        applicationId: args.document.applicationId,
        runtimeSnapshotId: snapshot.runtimeSnapshotId,
        updatedBy: snapshot.publishedBy,
      },
    });
  }

  private async buildRuntimeConfigDocument(args: {
    applicationId: string;
    configVersion: string;
    dto: UpsertRuntimeConfigDraftDto;
    publishState: 'draft' | 'active';
    now: Date;
    publishedAt: Date;
  }): Promise<ActiveRuntimeConfigResponseDto> {
    const context = await this.getApplicationContextOrThrow(args.applicationId);
    this.assertActiveContext(context);

    const [apiKey, providers] = await Promise.all([
      this.getActiveApiKeyOrThrow(context.projectId, args.now),
      this.getApplicationProvidersOrThrow(context.id),
    ]);
    const models = this.withBuiltinMockModel(
      this.resolveModels(args.dto.models, providers),
    );
    const routingProviders = this.withBuiltinMockRoutingProvider(providers);
    const routingPolicy = this.resolveRoutingPolicy({
      dto: args.dto,
      models,
      providers: routingProviders,
    });
    const routingTargets = this.resolveRoutingTargets(
      routingPolicy,
      models,
      routingProviders,
    );
    const routingProviderNames = [
      ...new Set(routingTargets.map((target) => target.provider.provider)),
    ];
    this.assertRoutingProviderConnectionsActive(
      routingProviders,
      routingProviderNames,
    );
    this.assertRoutingModelsActive(
      routingTargets.map((target) => target.model),
    );
    const effectiveAt = args.dto.effectiveAt
      ? new Date(args.dto.effectiveAt)
      : args.now;
    const generatedAt = args.now.toISOString();
    const effectiveAtIso = effectiveAt.toISOString();
    const publishedAtIso = args.publishedAt.toISOString();
    const safetyPolicy = this.resolveSafetyPolicy(args.dto.safetyPolicy);
    const providersResponse = this.withBuiltinMockRuntimeProvider(
      providers.map((provider) => this.toRuntimeProvider(provider, models)),
    );
    if (args.publishState === 'active') {
      this.assertRuntimeSnapshotProviderCredentialBindings(
        providersResponse,
        routingProviderNames,
      );
    }
    const pricingRules = this.resolvePricingRules(
      args.dto.pricingRules,
      models,
      effectiveAtIso,
      args.now,
    );
    const documentWithoutHash: ActiveRuntimeConfigResponseDto = {
      schemaVersion: 'gatelm.active-runtime-config.v2',
      configVersion: args.configVersion,
      configHash: '',
      configHashAlgorithm: CONFIG_HASH_ALGORITHM,
      generatedAt,
      effectiveAt: effectiveAtIso,
      publishedAt: publishedAtIso,
      publishState: args.publishState,
      tenantId: context.tenantId,
      tenantStatus: this.toResourceStatus(context.tenant.status),
      projectId: context.projectId,
      projectStatus: this.toResourceStatus(context.project.status),
      applicationId: context.id,
      applicationStatus: this.toResourceStatus(context.status),
      apiKeyId: apiKey.id,
      apiKeyStatus: this.toCredentialStatus(apiKey.status),
      appTokenId: null,
      appTokenStatus: null,
      apiKey: this.toCredentialRef(apiKey, 'api_key'),
      appToken: null,
      providers: providersResponse,
      models,
      rateLimit: this.resolveRateLimit(args.dto.rateLimit),
      budgetPolicy: this.resolveBudgetPolicy(args.dto.budgetPolicy),
      safetyPolicy,
      cachePolicy: this.resolveCachePolicy(args.dto.cachePolicy),
      promptCapturePolicy: this.resolvePromptCapturePolicy(
        args.dto.promptCapturePolicy,
      ),
      responseCapturePolicy: this.resolveResponseCapturePolicy(
        args.dto.responseCapturePolicy,
      ),
      routingPolicy,
      pricingRules,
      hashing: this.resolveHashing(),
      costing: this.resolveCosting(),
    };

    return {
      ...documentWithoutHash,
      configHash: this.sha256(
        this.canonicalJson({
          ...documentWithoutHash,
          configHash: undefined,
        }),
      ),
    };
  }

  private async assertRuntimeConfigExecutable(args: {
    applicationId: string;
    runtimeConfig: RuntimeConfig;
    document: ActiveRuntimeConfigResponseDto;
    now: Date;
  }): Promise<void> {
    this.assertActiveRuntimeConfigSnapshot(args);
    this.assertRuntimeConfigPolicyBundle(args.document);
    const routingTargets = this.resolveRoutingTargets(
      args.document.routingPolicy,
      args.document.models,
      this.toProviderConnectionsForRouting(args.document.providers),
    );
    this.assertRuntimeSnapshotProviderCredentialBindings(
      args.document.providers,
      [
        ...new Set(
          routingTargets.map((target) => target.provider.provider),
        ),
      ],
    );
    this.assertNoForbiddenRuntimeConfigKeys(args.document);

    const context = await this.getApplicationContextOrThrow(args.applicationId);
    this.assertActiveContext(context);
    this.assertDocumentMatchesCurrentContext(args.document, context);

    await Promise.all([
      this.assertCurrentApiKeyExecutable(args.document, context, args.now),
      this.assertCurrentRoutingProvidersExecutable(args.document, context),
    ]);
  }

  private assertActiveRuntimeConfigSnapshot(args: {
    applicationId: string;
    runtimeConfig: RuntimeConfig;
    document: ActiveRuntimeConfigResponseDto;
  }): void {
    const { applicationId, runtimeConfig, document } = args;
    if (
      runtimeConfig.publishState !== RuntimeConfigPublishState.ACTIVE ||
      runtimeConfig.applicationId !== applicationId ||
      runtimeConfig.applicationId !== document.applicationId ||
      runtimeConfig.tenantId !== document.tenantId ||
      runtimeConfig.projectId !== document.projectId ||
      runtimeConfig.configVersion !== document.configVersion ||
      runtimeConfig.configHash !== document.configHash ||
      document.schemaVersion !== 'gatelm.active-runtime-config.v2' ||
      document.configHashAlgorithm !== CONFIG_HASH_ALGORITHM ||
      document.publishState !== 'active'
    ) {
      throw new ConflictException(
        ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
      );
    }
  }

  private assertDocumentMatchesCurrentContext(
    document: ActiveRuntimeConfigResponseDto,
    context: RuntimeApplicationContext,
  ): void {
    if (
      document.tenantId !== context.tenantId ||
      document.projectId !== context.projectId ||
      document.applicationId !== context.id ||
      document.tenantStatus !== 'active' ||
      document.projectStatus !== 'active' ||
      document.applicationStatus !== 'active'
    ) {
      throw new ConflictException(
        ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
      );
    }
  }

  private async assertCurrentApiKeyExecutable(
    document: ActiveRuntimeConfigResponseDto,
    context: RuntimeApplicationContext,
    now: Date,
  ): Promise<void> {
    const apiKey = await this.prisma.gatewayApiKey.findUnique({
      where: { id: document.apiKeyId },
    });

    if (
      !apiKey ||
      document.apiKey.id !== document.apiKeyId ||
      document.apiKey.type !== 'api_key' ||
      document.apiKeyStatus !== 'active' ||
      document.apiKey.status !== 'active' ||
      apiKey.tenantId !== context.tenantId ||
      apiKey.projectId !== context.projectId ||
      !this.isCredentialCurrentlyActive(apiKey, now)
    ) {
      throw new ConflictException(
        ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
      );
    }
  }

  private async assertCurrentRoutingProvidersExecutable(
    document: ActiveRuntimeConfigResponseDto,
    context: RuntimeApplicationContext,
  ): Promise<void> {
    const routingProviderNames = new Set(
      this.resolveRoutingTargets(
        document.routingPolicy,
        document.models,
        this.toProviderConnectionsForRouting(document.providers),
      ).map((target) => target.provider.provider),
    );
    const currentProviderConnections =
      await this.prisma.applicationProviderConnection.findMany({
        where: {
          applicationId: context.id,
          providerConnection: {
            provider: { in: [...routingProviderNames] },
          },
        },
        include: {
          providerConnection: true,
        },
      });
    const currentProviders = currentProviderConnections.map(
      (connection) => connection.providerConnection,
    );
    const currentByName = new Map(
      currentProviders.map((provider) => [provider.provider, provider]),
    );

    for (const providerName of routingProviderNames) {
      const documentProvider = document.providers.find(
        (provider) => provider.provider === providerName,
      );
      if (
        documentProvider?.providerId === BUILTIN_MOCK_PROVIDER_ID &&
        documentProvider.provider === BUILTIN_MOCK_PROVIDER_NAME &&
        documentProvider.status === 'active'
      ) {
        continue;
      }
      const currentProvider = currentByName.get(providerName);
      if (
        !documentProvider ||
        !currentProvider ||
        documentProvider.providerId !== currentProvider.id ||
        documentProvider.status !== 'active' ||
        currentProvider.status !== ProviderConnectionStatus.ACTIVE
      ) {
        throw new ConflictException(
          ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
        );
      }
    }
  }

  private assertRuntimeConfigPolicyBundle(
    document: ActiveRuntimeConfigResponseDto,
  ): void {
    this.assertRuntimeConfigRequiredPolicyShape(document);
    const routingTargets = this.resolveRoutingTargets(
      document.routingPolicy,
      document.models,
      this.toProviderConnectionsForRouting(document.providers),
    );
    for (const target of routingTargets) {
      this.assertRoutingModelExecutable(
        document,
        target.provider.provider,
        target.model.model,
      );
    }
    const expectedBootstrapState = this.toRoutingBootstrapState(
      document.routingPolicy.routes,
      document.models,
      this.toProviderConnectionsForRouting(document.providers),
    );

    if (
      document.rateLimit.scope !== 'application' ||
      document.rateLimit.algorithm !== 'fixed_window' ||
      !Number.isInteger(document.rateLimit.windowSeconds) ||
      document.rateLimit.windowSeconds < 1 ||
      document.rateLimit.windowSeconds > 100000 ||
      !Number.isInteger(document.rateLimit.limit) ||
      document.rateLimit.limit < 1 ||
      !this.isExecutableBudgetPolicy(document.budgetPolicy) ||
      document.cachePolicy.type !== 'exact' ||
      !Number.isInteger(document.cachePolicy.ttlSeconds) ||
      document.cachePolicy.ttlSeconds < 1 ||
      !this.isExecutablePromptCapturePolicy(document.promptCapturePolicy) ||
      !this.isExecutableResponseCapturePolicy(document.responseCapturePolicy) ||
      document.safetyPolicy.mode !== 'rule_based' ||
      !document.safetyPolicy.securityPolicyHash ||
      !Array.isArray(document.safetyPolicy.detectors) ||
      document.safetyPolicy.detectors.length === 0 ||
      document.routingPolicy.schemaVersion !== 'gatelm.routing-policy.v2' ||
      !['auto', 'manual'].includes(document.routingPolicy.mode) ||
      !['mock_bootstrap', 'configured'].includes(
        document.routingPolicy.bootstrapState,
      ) ||
      document.routingPolicy.bootstrapState !== expectedBootstrapState ||
      !this.isRoutingRoutesShape(document.routingPolicy.routes) ||
      !this.isRoutingPolicyHash(document.routingPolicy.routingPolicyHash) ||
      !Array.isArray(document.pricingRules) ||
      document.pricingRules.length === 0
    ) {
      throw new ConflictException(
        ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
      );
    }
    this.assertSafetyDetectorsExecutable(document.safetyPolicy.detectors);
  }

  private assertRuntimeConfigRequiredPolicyShape(
    document: ActiveRuntimeConfigResponseDto,
  ): void {
    const runtimeDocument = document as unknown as Record<string, unknown>;
    if (
      !this.isNonEmptyString(runtimeDocument.apiKeyId) ||
      !this.isCredentialRefShape(runtimeDocument.apiKey, 'api_key') ||
      !Array.isArray(document.providers) ||
      document.providers.length === 0 ||
      !Array.isArray(document.models) ||
      document.models.length === 0 ||
      !document.rateLimit ||
      !document.budgetPolicy ||
      !document.cachePolicy ||
      !document.promptCapturePolicy ||
      !document.responseCapturePolicy ||
      !document.safetyPolicy ||
      !document.routingPolicy ||
      !Array.isArray(document.pricingRules)
    ) {
      throw new ConflictException(
        ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
      );
    }
  }

  private assertRoutingModelExecutable(
    document: ActiveRuntimeConfigResponseDto,
    providerName: string,
    modelName: string,
  ): void {
    const provider = document.providers.find(
      (candidate) => candidate.provider === providerName,
    );
    const model = document.models.find(
      (candidate) =>
        candidate.provider === providerName && candidate.model === modelName,
    );

    if (
      !provider ||
      !model ||
      provider.status !== 'active' ||
      !Array.isArray(provider.models) ||
      !provider.models.includes(modelName) ||
      model.status !== 'active'
    ) {
      throw new ConflictException(
        ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
      );
    }
  }

  private assertSafetyDetectorsExecutable(
    detectors: RuntimeConfigSafetyDetectorResponseDto[],
  ): void {
    for (const detector of detectors) {
      if (MANDATORY_SAFETY_DETECTORS.has(detector.type) && !detector.enabled) {
        throw new ConflictException(
          `Safety detector ${detector.type} is mandatory and cannot be disabled.`,
        );
      }
    }
  }

  private isCredentialRefShape(
    value: unknown,
    expectedType: 'api_key' | 'app_token',
  ): value is RuntimeConfigCredentialRefDto {
    if (!this.isRecord(value)) {
      return false;
    }

    return (
      this.isNonEmptyString(value.id) &&
      value.type === expectedType &&
      this.isCredentialStatusValue(value.status) &&
      this.isNonEmptyString(value.prefix) &&
      typeof value.last4 === 'string' &&
      value.last4.length === 4 &&
      Array.isArray(value.scopes) &&
      value.scopes.every((scope) => this.isNonEmptyString(scope)) &&
      (value.expiresAt === null || this.isNonEmptyString(value.expiresAt)) &&
      value.verification === 'prefix_then_hash_compare'
    );
  }

  private isCredentialStatusValue(
    value: unknown,
  ): value is RuntimeConfigCredentialRefDto['status'] {
    return (
      value === 'active' ||
      value === 'revoked' ||
      value === 'expired' ||
      value === 'disabled'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private assertNoForbiddenRuntimeConfigKeys(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach((item) => this.assertNoForbiddenRuntimeConfigKeys(item));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }

    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (FORBIDDEN_RUNTIME_CONFIG_KEYS.has(key)) {
        throw new ConflictException(
          ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
        );
      }

      this.assertNoForbiddenRuntimeConfigKeys(nestedValue);
    }
  }

  private isCredentialCurrentlyActive(
    credential: GatewayApiKey | AppToken,
    now: Date,
  ): boolean {
    return (
      credential.status === CredentialStatus.ACTIVE &&
      (!credential.expiresAt || credential.expiresAt > now)
    );
  }

  private async getApplicationContextOrThrow(
    applicationId: string,
  ): Promise<RuntimeApplicationContext> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        tenant: { select: { id: true, status: true } },
        project: { select: { id: true, status: true } },
      },
    });

    if (!application) {
      throw new NotFoundException('Application not found.');
    }

    return application;
  }

  private assertActiveContext(context: {
    status: ResourceStatus;
    tenant: { status: ResourceStatus };
    project: { status: ResourceStatus };
  }): void {
    if (
      context.tenant.status !== ResourceStatus.ACTIVE ||
      context.project.status !== ResourceStatus.ACTIVE ||
      context.status !== ResourceStatus.ACTIVE
    ) {
      throw new ConflictException(
        'Runtime Config requires active tenant, project, and application.',
      );
    }
  }

  private async getActiveApiKeyOrThrow(
    projectId: string,
    now: Date,
  ): Promise<GatewayApiKey> {
    const apiKey = await this.prisma.gatewayApiKey.findFirst({
      where: {
        projectId,
        status: CredentialStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (!apiKey) {
      throw new ConflictException(
        'Runtime Config requires an active API Key.',
      );
    }

    return apiKey;
  }

  private async getApplicationProvidersOrThrow(
    applicationId: string,
  ): Promise<ProviderConnection[]> {
    const connections =
      await this.prisma.applicationProviderConnection.findMany({
        where: { applicationId },
        include: {
          providerConnection: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    const providers = connections.map(
      (connection) => connection.providerConnection,
    );

    if (providers.length === 0) {
      throw new ConflictException(
        'Runtime Config requires at least one application provider connection.',
      );
    }

    return providers;
  }

  private assertRoutingProviderConnectionsActive(
    providers: RoutingProvider[],
    routingProviderNames: string[],
  ): void {
    const providersByName = new Map(
      providers.map((provider) => [provider.provider, provider]),
    );

    for (const providerName of routingProviderNames) {
      const provider = providersByName.get(providerName);
      if (!provider || provider.status !== ProviderConnectionStatus.ACTIVE) {
        throw new ConflictException(
          'Runtime Config selected providers must be active.',
        );
      }
    }
  }

  private assertRoutingModelsActive(
    routingModels: RuntimeConfigModelResponseDto[],
  ): void {
    if (routingModels.some((model) => model.status !== 'active')) {
      throw new ConflictException(
        'Runtime Config selected models must be active.',
      );
    }
  }

  private assertRuntimeSnapshotProviderCredentialBindings(
    providers: RuntimeConfigProviderDto[],
    routingProviderNames: string[],
  ): void {
    const routingProviderSet = new Set(routingProviderNames);
    for (const provider of providers) {
      if (!routingProviderSet.has(provider.provider)) {
        continue;
      }
      if (!(provider.credentialRequired ?? provider.resolver !== 'none')) {
        continue;
      }
      if (
        !provider.credentialRef ||
        provider.credentialRef.credentialState !== 'active'
      ) {
        throw new ConflictException(
          MISSING_PROVIDER_CREDENTIAL_BINDING_MESSAGE,
        );
      }
    }
  }

  private resolveModels(
    dtoModels: UpsertRuntimeConfigDraftDto['models'],
    providers: ProviderConnection[],
  ): RuntimeConfigModelResponseDto[] {
    const providerNames = new Set(
      providers.map((provider) => provider.provider),
    );
    const providersByName = new Map(
      providers.map((provider) => [provider.provider, provider]),
    );
    const hasRegisteredMockProvider = providerNames.has(
      BUILTIN_MOCK_PROVIDER_NAME,
    );

    if (dtoModels?.length) {
      const modelKeys = new Set<string>();
      for (const model of dtoModels) {
        const isInjectedBuiltinMockModel =
          !hasRegisteredMockProvider &&
          model.provider === BUILTIN_MOCK_PROVIDER_NAME &&
          model.model === BUILTIN_MOCK_MODEL_REF;
        if (
          !isInjectedBuiltinMockModel &&
          !providerNames.has(model.provider)
        ) {
          throw new ConflictException(
            'Runtime Config model provider is not registered.',
          );
        }

        const modelKey = this.toModelKey(model.provider, model.model);
        if (modelKeys.has(modelKey)) {
          throw new ConflictException(
            'Runtime Config model entries must be unique by provider and model.',
          );
        }
        modelKeys.add(modelKey);
      }

      const models = dtoModels
        .filter(
          (model) =>
            hasRegisteredMockProvider ||
            model.provider !== BUILTIN_MOCK_PROVIDER_NAME ||
            model.model !== BUILTIN_MOCK_MODEL_REF,
        )
        .map((model) => {
          const provider = providersByName.get(model.provider);
          const defaults = provider
            ? this.resolveProviderModel(provider, model.model)
            : null;

          return {
            provider: model.provider,
            model: model.model,
            displayName:
              model.displayName ?? defaults?.displayName ?? model.model,
            status: model.status ?? 'active',
            contextWindowTokens:
              model.contextWindowTokens ??
              defaults?.contextWindowTokens ??
              8192,
            supportsStreaming:
              model.supportsStreaming ?? defaults?.supportsStreaming ?? false,
            supportsJsonMode:
              model.supportsJsonMode ?? defaults?.supportsJsonMode ?? false,
          };
        });

      for (const provider of providers) {
        if (models.some((model) => model.provider === provider.provider)) {
          continue;
        }

        models.push(
          ...this.resolveProviderModelNames(provider).map((model) =>
            this.resolveProviderModel(provider, model),
          ),
        );
      }

      return models;
    }

    return providers.flatMap((provider) =>
      this.resolveProviderModelNames(provider).map((model) =>
        this.resolveProviderModel(provider, model),
      ),
    );
  }

  private resolveProviderModel(
    provider: ProviderConnection,
    model: string,
  ): RuntimeConfigModelResponseDto {
    const providerConfig = this.toRecordOrNull(provider.providerConfig);
    const modelMetadata = this.toRecordOrNull(providerConfig?.modelMetadata);
    const metadata = this.toRecordOrNull(modelMetadata?.[model]);
    const contextWindowTokens = this.toModelContextWindowTokens(
      metadata?.contextWindowTokens,
    );

    return {
      provider: provider.provider,
      model,
      displayName:
        typeof metadata?.displayName === 'string' &&
        metadata.displayName.trim()
          ? metadata.displayName.trim()
          : model,
      status: 'active',
      contextWindowTokens: contextWindowTokens ?? 8192,
      supportsStreaming: metadata?.supportsStreaming === true,
      supportsJsonMode: metadata?.supportsJsonMode === true,
    };
  }

  private toModelContextWindowTokens(value: unknown): number | null {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= MAX_RUNTIME_MODEL_CONTEXT_WINDOW_TOKENS
      ? value
      : null;
  }

  private resolveProviderModelNames(provider: ProviderConnection): string[] {
    const providerConfig = this.toRecordOrNull(provider.providerConfig);
    const configuredModels = providerConfig?.models;
    if (Array.isArray(configuredModels)) {
      const models = configuredModels.filter(
        (model): model is string =>
          typeof model === 'string' && model.trim().length > 0,
      );
      if (models.length > 0) {
        return [...new Set(models.map((model) => model.trim()))];
      }
    }

    if (provider.provider === 'mock') {
      return ['mock-fast', 'mock-balanced'];
    }

    return [`${provider.provider}-default`];
  }

  private resolveRateLimit(
    dto: UpsertRuntimeConfigDraftDto['rateLimit'],
  ): RuntimeConfigRateLimitResponseDto {
    return {
      enabled: dto?.enabled ?? true,
      scope: 'application',
      algorithm: 'fixed_window',
      windowSeconds: dto?.windowSeconds ?? 60,
      limit: dto?.limit ?? 60,
    };
  }

  private resolveBudgetPolicy(
    dto: UpsertRuntimeConfigDraftDto['budgetPolicy'],
  ): RuntimeConfigBudgetPolicyResponseDto {
    if (dto?.enabled === true && dto.enforcementMode === 'disabled') {
      throw new ConflictException('Runtime Config budget policy is invalid.');
    }
    if (
      dto?.enabled === false &&
      dto.enforcementMode &&
      dto.enforcementMode !== 'disabled'
    ) {
      throw new ConflictException('Runtime Config budget policy is invalid.');
    }

    const enabled =
      dto?.enabled ??
      Boolean(dto?.enforcementMode && dto.enforcementMode !== 'disabled');
    const enforcementMode = enabled
      ? dto?.enforcementMode ?? 'warn'
      : 'disabled';

    return {
      enabled,
      enforcementMode,
      warningThresholdPercent:
        dto?.warningThresholdPercent ??
        DEFAULT_BUDGET_WARNING_THRESHOLD_PERCENT,
    };
  }

  private resolveCachePolicy(
    dto: UpsertRuntimeConfigDraftDto['cachePolicy'],
  ): RuntimeConfigCachePolicyResponseDto {
    return {
      enabled: dto?.enabled ?? true,
      type: 'exact',
      ttlSeconds: dto?.ttlSeconds ?? 3600,
    };
  }

  private resolvePromptCapturePolicy(
    dto: UpsertRuntimeConfigDraftDto['promptCapturePolicy'],
  ): RuntimeConfigPromptCapturePolicyResponseDto {
    const enabled = dto?.enabled ?? false;
    const mode = enabled ? dto?.mode ?? 'log_safe_full' : 'disabled';
    if (enabled && mode !== 'log_safe_full') {
      throw new ConflictException(
        'Runtime Config prompt capture policy is invalid.',
      );
    }
    if (!enabled && dto?.mode && dto.mode !== 'disabled') {
      throw new ConflictException(
        'Runtime Config prompt capture policy is invalid.',
      );
    }

    return {
      enabled,
      mode,
      maxChars: dto?.maxChars ?? DEFAULT_PROMPT_CAPTURE_MAX_CHARS,
    };
  }

  private resolveResponseCapturePolicy(
    dto: UpsertRuntimeConfigDraftDto['responseCapturePolicy'],
  ): RuntimeConfigResponseCapturePolicyResponseDto {
    const enabled = dto?.enabled ?? false;
    const mode = enabled ? dto?.mode ?? 'raw_full' : 'disabled';
    if (enabled && mode !== 'raw_full') {
      throw new ConflictException(
        'Runtime Config response capture policy is invalid.',
      );
    }
    if (!enabled && dto?.mode && dto.mode !== 'disabled') {
      throw new ConflictException(
        'Runtime Config response capture policy is invalid.',
      );
    }

    return {
      enabled,
      mode,
      maxChars: dto?.maxChars ?? DEFAULT_RESPONSE_CAPTURE_MAX_CHARS,
    };
  }

  private resolveSafetyPolicy(
    dto: UpsertRuntimeConfigDraftDto['safetyPolicy'],
  ): RuntimeConfigSafetyPolicyResponseDto {
    const detectors = dto?.detectors?.length
      ? dto.detectors
      : this.defaultSafetyDetectors();
    for (const detector of detectors) {
      if (MANDATORY_SAFETY_DETECTORS.has(detector.type) && !detector.enabled) {
        throw new ConflictException(
          `Safety detector ${detector.type} is mandatory and cannot be disabled.`,
        );
      }
    }
    const mappedDetectors = detectors.map((detector) => ({
      type: detector.type,
      enabled: detector.enabled,
      action: detector.action,
      placeholder: detector.placeholder,
    }));

    return {
      mode: 'rule_based',
      securityPolicyHash: this.sha256(
        this.canonicalJson({
          mode: 'rule_based',
          detectors: mappedDetectors,
        }),
      ),
      remoteSafety: {
        enabled: false,
        mode: 'disabled',
      },
      detectors: mappedDetectors,
    };
  }

  private resolveRoutingPolicy(args: {
    dto: UpsertRuntimeConfigDraftDto;
    models: RuntimeConfigModelResponseDto[];
    providers: RoutingProvider[];
  }): RuntimeConfigRoutingPolicyResponseDto {
    const routes = args.dto.routingPolicy
      ? this.normalizeRoutingRoutes(args.dto.routingPolicy.routes)
      : this.buildUniformRoutingRoutes(BUILTIN_MOCK_MODEL_REF);
    this.resolveRoutingTargets(
      {
        schemaVersion: 'gatelm.routing-policy.v2',
        mode: args.dto.routingPolicy?.mode ?? 'auto',
        bootstrapState: 'configured',
        routes,
        routingPolicyHash: '',
      },
      args.models,
      args.providers,
    );
    const routingPolicyWithoutHash = {
      schemaVersion: 'gatelm.routing-policy.v2',
      mode: args.dto.routingPolicy?.mode ?? 'auto',
      bootstrapState: this.toRoutingBootstrapState(
        routes,
        args.models,
        args.providers,
      ),
      routes,
    } as const;

    return {
      ...routingPolicyWithoutHash,
      routingPolicyHash: this.sha256Tagged(
        this.canonicalJson(routingPolicyWithoutHash),
      ),
    };
  }

  private normalizeRoutingRoutes(
    routes: RuntimeConfigRoutingRoutesDto,
  ): RuntimeConfigRoutingRoutesDto {
    if (!this.isRoutingAuthoringProfile(routes)) {
      throw new ConflictException(
        'Runtime Config routing policy must use one global Simple model, one global Complex model, and at most one global fallback model.',
      );
    }

    return Object.fromEntries(
      RUNTIME_CONFIG_ROUTING_CATEGORIES.map((category) => [
        category,
        Object.fromEntries(
          ROUTING_DIFFICULTIES.map((difficulty) => [
            difficulty,
            {
              modelRefs: routes[category][difficulty].modelRefs.map((ref) =>
                ref.trim(),
              ),
            },
          ]),
        ),
      ]),
    ) as unknown as RuntimeConfigRoutingRoutesDto;
  }

  private buildUniformRoutingRoutes(modelRef: string): RuntimeConfigRoutingRoutesDto {
    return this.buildRoutingAuthoringRoutes(modelRef, modelRef);
  }

  private buildRoutingAuthoringRoutes(
    simpleModelRef: string,
    complexModelRef: string,
    fallbackModelRef?: string,
  ): RuntimeConfigRoutingRoutesDto {
    const simpleModelRefs = fallbackModelRef
      ? [simpleModelRef, fallbackModelRef]
      : [simpleModelRef];
    const complexModelRefs = fallbackModelRef
      ? [complexModelRef, fallbackModelRef]
      : [complexModelRef];

    return Object.fromEntries(
      RUNTIME_CONFIG_ROUTING_CATEGORIES.map((category) => [
        category,
        {
          simple: { modelRefs: [...simpleModelRefs] },
          complex: { modelRefs: [...complexModelRefs] },
        },
      ]),
    ) as unknown as RuntimeConfigRoutingRoutesDto;
  }

  private isRoutingAuthoringProfile(
    value: unknown,
  ): value is RuntimeConfigRoutingRoutesDto {
    if (!this.isRoutingRoutesShape(value)) {
      return false;
    }

    const generalSimple = value.general.simple.modelRefs;
    const generalComplex = value.general.complex.modelRefs;
    if (generalSimple.length > 2 || generalComplex.length > 2) {
      return false;
    }

    const simpleModelRef = generalSimple[0];
    const complexModelRef = generalComplex[0];
    const fallbackModelRef = generalSimple[1];
    if (
      !simpleModelRef ||
      !complexModelRef ||
      (fallbackModelRef !== undefined &&
        (fallbackModelRef === simpleModelRef ||
          fallbackModelRef === complexModelRef))
    ) {
      return false;
    }

    return RUNTIME_CONFIG_ROUTING_CATEGORIES.every((category) =>
      ROUTING_DIFFICULTIES.every((difficulty) => {
        const modelRefs = value[category][difficulty].modelRefs;
        const expectedPrimary =
          difficulty === 'simple' ? simpleModelRef : complexModelRef;
        return (
          modelRefs.length === (fallbackModelRef ? 2 : 1) &&
          modelRefs[0] === expectedPrimary &&
          modelRefs[1] === fallbackModelRef
        );
      }),
    );
  }

  private isRoutingRoutesShape(value: unknown): value is RuntimeConfigRoutingRoutesDto {
    if (!this.isRecord(value)) {
      return false;
    }
    if (
      Object.keys(value).length !== RUNTIME_CONFIG_ROUTING_CATEGORIES.length ||
      !RUNTIME_CONFIG_ROUTING_CATEGORIES.every((category) => category in value)
    ) {
      return false;
    }

    return RUNTIME_CONFIG_ROUTING_CATEGORIES.every((category) => {
      const categoryRoutes = value[category];
      if (
        !this.isRecord(categoryRoutes) ||
        Object.keys(categoryRoutes).length !== ROUTING_DIFFICULTIES.length
      ) {
        return false;
      }
      return ROUTING_DIFFICULTIES.every((difficulty) => {
        const cell = categoryRoutes[difficulty];
        if (
          !this.isRecord(cell) ||
          Object.keys(cell).length !== 1 ||
          !Array.isArray(cell.modelRefs) ||
          cell.modelRefs.length === 0 ||
          !cell.modelRefs.every(
            (ref) =>
              typeof ref === 'string' &&
              ref.trim().length > 0 &&
              ref.trim().length <= 240,
          )
        ) {
          return false;
        }
        const normalizedRefs = cell.modelRefs.map((ref) => ref.trim());
        return new Set(normalizedRefs).size === normalizedRefs.length;
      });
    });
  }

  private routingModelRefs(routes: RuntimeConfigRoutingRoutesDto): string[] {
    return RUNTIME_CONFIG_ROUTING_CATEGORIES.flatMap((category) =>
      ROUTING_DIFFICULTIES.flatMap(
        (difficulty) => routes[category][difficulty].modelRefs,
      ),
    );
  }

  private withBuiltinMockModel(
    models: RuntimeConfigModelResponseDto[],
  ): RuntimeConfigModelResponseDto[] {
    if (
      models.some(
        (model) =>
          model.provider === BUILTIN_MOCK_PROVIDER_NAME &&
          model.model === BUILTIN_MOCK_MODEL_REF &&
          model.status === 'active',
      )
    ) {
      return models;
    }

    return [
      ...models.filter(
        (model) =>
          model.provider !== BUILTIN_MOCK_PROVIDER_NAME ||
          model.model !== BUILTIN_MOCK_MODEL_REF,
      ),
      {
        provider: BUILTIN_MOCK_PROVIDER_NAME,
        model: BUILTIN_MOCK_MODEL_REF,
        displayName: 'Mock Balanced',
        status: 'active',
        contextWindowTokens: 8192,
        supportsStreaming: false,
        supportsJsonMode: false,
      },
    ];
  }

  private withBuiltinMockRoutingProvider(
    providers: RoutingProvider[],
  ): RoutingProvider[] {
    if (
      providers.some(
        (provider) =>
          provider.provider === BUILTIN_MOCK_PROVIDER_NAME &&
          provider.status === ProviderConnectionStatus.ACTIVE,
      )
    ) {
      return providers;
    }

    return [
      ...providers.filter(
        (provider) => provider.provider !== BUILTIN_MOCK_PROVIDER_NAME,
      ),
      {
        id: BUILTIN_MOCK_PROVIDER_ID,
        provider: BUILTIN_MOCK_PROVIDER_NAME,
        status: ProviderConnectionStatus.ACTIVE,
      },
    ];
  }

  private withBuiltinMockRuntimeProvider(
    providers: RuntimeConfigProviderDto[],
  ): RuntimeConfigProviderDto[] {
    const activeMockProvider = providers.find(
      (provider) =>
        provider.provider === BUILTIN_MOCK_PROVIDER_NAME &&
        provider.status === 'active',
    );
    if (activeMockProvider) {
      return providers.map((provider) =>
        provider === activeMockProvider &&
        !provider.models.includes(BUILTIN_MOCK_MODEL_REF)
          ? {
              ...provider,
              models: [...provider.models, BUILTIN_MOCK_MODEL_REF],
            }
          : provider,
      );
    }

    return [
      ...providers.filter(
        (provider) => provider.provider !== BUILTIN_MOCK_PROVIDER_NAME,
      ),
      {
        providerId: BUILTIN_MOCK_PROVIDER_ID,
        provider: BUILTIN_MOCK_PROVIDER_NAME,
        displayName: 'Built-in Mock Provider',
        status: 'active',
        adapterType: 'mock',
        baseUrl: BUILTIN_MOCK_PROVIDER_BASE_URL,
        timeoutMs: 30000,
        credentialRequired: false,
        credentialRef: null,
        secretRef: null,
        credentialPreview: null,
        resolver: 'none',
        adapterConfig: { requestFormat: 'mock_chat_completions' },
        models: [BUILTIN_MOCK_MODEL_REF],
        failureMode: 'fail_closed',
      },
    ];
  }

  private resolveRoutingTargets(
    policy: RuntimeConfigRoutingPolicyResponseDto,
    models: RuntimeConfigModelResponseDto[],
    providers: RoutingProvider[],
  ): Array<{ provider: RoutingProvider; model: RuntimeConfigModelResponseDto }> {
    if (!this.isRoutingRoutesShape(policy.routes)) {
      throw new ConflictException(
        'Runtime Config routing policy requires all category and difficulty cells.',
      );
    }

    const targets: Array<{
      provider: RoutingProvider;
      model: RuntimeConfigModelResponseDto;
    }> = [];
    for (const modelRef of new Set(this.routingModelRefs(policy.routes))) {
      if (modelRef === BUILTIN_MOCK_MODEL_REF) {
        const mockProvider = providers.find(
          (provider) => provider.provider === 'mock',
        );
        const mockModel = models.find(
          (model) => model.provider === 'mock' && model.model === 'mock-balanced',
        );
        if (!mockProvider || !mockModel) {
          throw new ConflictException(
            'Runtime Config built-in mock target is unavailable.',
          );
        }
        targets.push({ provider: mockProvider, model: mockModel });
        continue;
      }

      const target = providers
        .map((provider) => ({
          provider,
          model: models.find(
            (model) =>
              model.provider === provider.provider &&
              `${provider.id}:${model.model}` === modelRef,
          ),
        }))
        .find(
          (candidate): candidate is {
            provider: RoutingProvider;
            model: RuntimeConfigModelResponseDto;
          } => Boolean(candidate.model),
        );
      if (!target) {
        throw new ConflictException(
          'Runtime Config routing modelRef is not available in the provider catalog.',
        );
      }
      targets.push(target);
    }

    return targets;
  }

  private toRoutingBootstrapState(
    routes: RuntimeConfigRoutingRoutesDto,
    models: RuntimeConfigModelResponseDto[],
    providers: RoutingProvider[],
  ): RuntimeConfigRoutingPolicyResponseDto['bootstrapState'] {
    if (this.routingModelRefs(routes).includes(BUILTIN_MOCK_MODEL_REF)) {
      return 'mock_bootstrap';
    }
    const targets = this.resolveRoutingTargets(
      {
        schemaVersion: 'gatelm.routing-policy.v2',
        mode: 'auto',
        bootstrapState: 'configured',
        routes,
        routingPolicyHash: '',
      },
      models,
      providers,
    );
    return targets.some((target) => target.provider.provider === 'mock')
      ? 'mock_bootstrap'
      : 'configured';
  }

  private resolvePricingRules(
    dtoPricingRules: UpsertRuntimeConfigDraftDto['pricingRules'],
    models: RuntimeConfigModelResponseDto[],
    effectiveAt: string,
    now: Date,
  ): RuntimeConfigPricingRuleResponseDto[] {
    if (dtoPricingRules?.length) {
      return dtoPricingRules.map((rule) => ({
        ...this.assertPricingRuleModelExists(rule, models),
        pricingRuleId: this.toPricingRuleId(rule.provider, rule.model),
        pricingVersion:
          rule.pricingVersion ?? this.toPricingVersion(rule.provider, now),
        currency: 'USD',
        unit: 'token',
        promptTokenMicroUsd: rule.promptTokenMicroUsd ?? 0,
        completionTokenMicroUsd: rule.completionTokenMicroUsd ?? 0,
        effectiveAt,
      }));
    }

    return models.map((model) => ({
      pricingRuleId: this.toPricingRuleId(model.provider, model.model),
      provider: model.provider,
      model: model.model,
      pricingVersion: this.toPricingVersion(model.provider, now),
      currency: 'USD',
      unit: 'token',
      promptTokenMicroUsd: model.model.includes('fast') ? 1 : 2,
      completionTokenMicroUsd: model.model.includes('fast') ? 2 : 3,
      effectiveAt,
    }));
  }

  private resolveHashing(): RuntimeConfigHashingDto {
    return {
      canonicalJson: 'utf8_json_sorted_keys_no_extra_whitespace',
      usesSecret: false,
      configHashSourceFields: [
        'tenantId',
        'projectId',
        'applicationId',
        'providers',
        'models',
        'rateLimit',
        'budgetPolicy',
        'safetyPolicy',
        'cachePolicy',
        'promptCapturePolicy',
        'responseCapturePolicy',
        'routingPolicy',
        'pricingRules',
      ],
      routingPolicyHashSourceFields: ['routingPolicy'],
      securityPolicyHashSourceFields: [
        'safetyPolicy.mode',
        'safetyPolicy.detectors',
      ],
      requestBodyHash:
        'sha256(canonical_json(openai_request_body_without_credentials))',
      promptHash: 'sha256(normalized_redacted_prompt_utf8)',
      cacheKeyHash: 'sha256(canonical_json(cache_key_material))',
      cacheKeyFields: [
        'tenantId',
        'projectId',
        'applicationId',
        'resolvedModelRef',
        'normalizedRedactedPrompt',
        'securityPolicyHash',
        'routingPolicyHash',
      ],
    };
  }

  private resolveCosting(): RuntimeConfigCostingDto {
    return {
      unit: 'micro_usd',
      formula:
        'ceil(promptTokens * promptTokenMicroUsd + completionTokens * completionTokenMicroUsd)',
      savedCostMicroUsdFormula:
        'sourceRequestCostMicroUsd_on_exact_cache_hit_else_0',
      usdStringFormat: 'fixed_6_decimal_places',
      missingPricingRule: 'provider_error',
    };
  }

  private toRuntimeProvider(
    provider: ProviderConnection,
    models: RuntimeConfigModelResponseDto[],
  ): RuntimeConfigProviderDto {
    const adapterType = this.toProviderConnectionAdapterType(provider);
    return {
      providerId: provider.id,
      provider: provider.provider,
      displayName: provider.displayName,
      status: this.toProviderStatus(provider.status),
      adapterType,
      baseUrl: this.toSafeProviderBaseUrl(provider.baseUrl),
      timeoutMs: provider.timeoutMs,
      credentialRequired:
        this.toProviderConnectionCredentialRequired(provider),
      credentialRef: this.toProviderCredentialRef(provider),
      secretRef: provider.secretRef,
      credentialPreview: this.toProviderCredentialPreview(provider),
      resolver: this.toResolver(provider.resolver),
      adapterConfig: this.toProviderConnectionAdapterConfig(
        provider,
        adapterType,
      ),
      models: models
        .filter((model) => model.provider === provider.provider)
        .map((model) => model.model),
      failureMode: this.toFailureMode(provider.providerConfig),
    };
  }

  private toProviderConnectionsForRouting(
    providers: RuntimeConfigProviderDto[],
  ): RoutingProvider[] {
    return providers.map((provider) => ({
      id: provider.providerId,
      provider: provider.provider,
      status:
        provider.status === 'active'
          ? ProviderConnectionStatus.ACTIVE
          : ProviderConnectionStatus.DISABLED,
    }));
  }

  private toRuntimeSnapshotResponse(
    runtimeConfig: RuntimeConfig,
    document: ActiveRuntimeConfigResponseDto,
  ): RuntimeSnapshotResponseDto {
    const runtimeSnapshotVersion = this.toRuntimeSnapshotVersion(
      runtimeConfig,
      document,
    );
    const providerCatalog = this.toProviderCatalogResponse(
      runtimeConfig,
      document,
    );
    const providerCatalogRef = {
      catalogId: providerCatalog.catalogId,
      catalogVersion: providerCatalog.catalogVersion,
      contentHash: providerCatalog.contentHash,
    };

    const snapshotWithoutContentHash = {
      schemaVersion: 'gatelm.runtime-snapshot.v2',
      runtimeSnapshotId: runtimeConfig.id,
      runtimeSnapshotVersion,
      contentHash: undefined,
      runtimeState: 'snapshot_active',
      publishedAt:
        runtimeConfig.publishedAt?.toISOString() ?? document.publishedAt,
      publishedBy: DEFAULT_PUBLISHED_BY,
      gatewayInstanceId: DEFAULT_GATEWAY_INSTANCE_ID,
      lookupKey: {
        tenantId: document.tenantId,
        projectId: document.projectId,
        applicationId: document.applicationId,
      },
      budgetResolution: {
        budgetScopeType: 'application',
        budgetScopeId: document.applicationId,
        resolvedBy: 'default_application',
        warningThresholdPercent:
          document.budgetPolicy.warningThresholdPercent,
      },
      providerCatalogRef,
      policies: {
        safety: {
          enabled: document.safetyPolicy.detectors.some(
            (detector) => detector.enabled,
          ),
          mode: document.safetyPolicy.detectors.some(
            (detector) => detector.enabled,
          )
            ? 'enforce'
            : 'disabled',
          requestSideRequired: true,
          policyHash: document.safetyPolicy.securityPolicyHash,
          detectorSet: document.safetyPolicy.detectors.map((detector) => ({
            detectorType: detector.type,
            action: detector.enabled ? detector.action : 'allow',
          })),
        },
        routing: {
          mode: document.routingPolicy.mode,
          bootstrapState: document.routingPolicy.bootstrapState,
          routes: document.routingPolicy.routes,
          routingPolicyHash: document.routingPolicy.routingPolicyHash,
        },
        cache: {
          exactCacheEnabled: document.cachePolicy.enabled,
          semanticCacheMode: document.cachePolicy.enabled
            ? 'evidence_only'
            : 'disabled',
          cachePolicyHash: this.sha256(
            this.canonicalJson(document.cachePolicy),
          ),
        },
        promptCapture: {
          enabled: document.promptCapturePolicy.enabled,
          mode: document.promptCapturePolicy.mode,
          maxChars: document.promptCapturePolicy.maxChars,
        },
        responseCapture: {
          enabled: document.responseCapturePolicy.enabled,
          mode: document.responseCapturePolicy.mode,
          maxChars: document.responseCapturePolicy.maxChars,
        },
        rateLimit: {
          enabled: document.rateLimit.enabled,
          scope: document.rateLimit.scope,
          windowSeconds: document.rateLimit.windowSeconds,
          limit: document.rateLimit.limit,
        },
        budget: {
          enabled: document.budgetPolicy.enabled,
          enforcementMode: document.budgetPolicy.enforcementMode,
          warningThresholdPercent:
            document.budgetPolicy.warningThresholdPercent,
        },
        streaming: {
          enabled: document.models.some((model) => model.supportsStreaming),
          thinSliceOnly: true,
        },
      },
      legacyHashes: {
        configHash: document.configHash,
        securityPolicyHash: document.safetyPolicy.securityPolicyHash,
        routingPolicyHash: document.routingPolicy.routingPolicyHash,
      },
    } satisfies Omit<RuntimeSnapshotResponseDto, 'contentHash'> & {
      contentHash?: string;
    };

    return {
      ...snapshotWithoutContentHash,
      contentHash: this.sha256(
        this.canonicalJson(snapshotWithoutContentHash),
      ),
    };
  }

  private toPersistedRuntimeSnapshotResponse(
    runtimeSnapshot: RuntimeSnapshot,
  ): RuntimeSnapshotResponseDto {
    if (
      !runtimeSnapshot.snapshotBody ||
      typeof runtimeSnapshot.snapshotBody !== 'object' ||
      Array.isArray(runtimeSnapshot.snapshotBody)
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is invalid.',
      );
    }

    const document =
      runtimeSnapshot.snapshotBody as unknown as RuntimeSnapshotResponseDto;
    const routingPolicy = document.policies?.routing as unknown;
    if (
      document.schemaVersion !== 'gatelm.runtime-snapshot.v2' ||
      !this.isRecord(routingPolicy) ||
      (routingPolicy.mode !== 'auto' && routingPolicy.mode !== 'manual') ||
      !this.isRoutingPolicyHash(routingPolicy.routingPolicyHash) ||
      !this.isRoutingRoutesShape(routingPolicy.routes) ||
      LEGACY_ROUTING_FIELDS.some(
        (legacyField) => legacyField in routingPolicy,
      )
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is invalid.',
      );
    }
    const persistedVersion = Number(runtimeSnapshot.version);
    if (!Number.isSafeInteger(persistedVersion)) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }
    if (
      document.runtimeSnapshotId !== runtimeSnapshot.id ||
      document.runtimeSnapshotVersion !== persistedVersion ||
      document.contentHash !== runtimeSnapshot.contentHash
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }
    this.assertNoForbiddenRuntimeConfigKeys(document);

    return document;
  }

  private isPersistedLegacyRuntimeSnapshot(
    runtimeSnapshot: Pick<RuntimeSnapshot, 'snapshotBody'>,
  ): boolean {
    return (
      this.isRecord(runtimeSnapshot.snapshotBody) &&
      runtimeSnapshot.snapshotBody.schemaVersion ===
        'gatelm.runtime-snapshot.v1'
    );
  }

  private toLegacyRuntimeSnapshotCompatibilityResponse(
    runtimeSnapshot: RuntimeSnapshot & {
      runtimeConfig?: RuntimeConfig | null;
    },
  ): {
    runtimeConfig: RuntimeConfig;
    document: ActiveRuntimeConfigResponseDto;
    snapshot: RuntimeSnapshotResponseDto;
  } {
    const snapshotBody = runtimeSnapshot.snapshotBody;
    const persistedVersion = Number(runtimeSnapshot.version);
    if (
      !this.isRecord(snapshotBody) ||
      snapshotBody.schemaVersion !== 'gatelm.runtime-snapshot.v1' ||
      !Number.isSafeInteger(persistedVersion) ||
      snapshotBody.runtimeSnapshotId !== runtimeSnapshot.id ||
      snapshotBody.runtimeSnapshotVersion !== persistedVersion ||
      snapshotBody.contentHash !== runtimeSnapshot.contentHash ||
      !this.isRecord(snapshotBody.lookupKey) ||
      snapshotBody.lookupKey.tenantId !== runtimeSnapshot.tenantId ||
      snapshotBody.lookupKey.projectId !== runtimeSnapshot.projectId ||
      snapshotBody.lookupKey.applicationId !== runtimeSnapshot.applicationId
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }
    this.assertNoForbiddenRuntimeConfigKeys(snapshotBody);

    const runtimeConfig = runtimeSnapshot.runtimeConfig;
    if (
      !runtimeConfig ||
      runtimeConfig.id !== runtimeSnapshot.runtimeConfigId ||
      runtimeConfig.tenantId !== runtimeSnapshot.tenantId ||
      runtimeConfig.projectId !== runtimeSnapshot.projectId ||
      runtimeConfig.applicationId !== runtimeSnapshot.applicationId
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }

    const compatibility = this.readRuntimeConfigDocument(runtimeConfig);
    const snapshot = this.toRuntimeSnapshotResponse(
      compatibility.runtimeConfig,
      compatibility.document,
    );
    if (
      snapshot.runtimeSnapshotId !== runtimeSnapshot.id ||
      snapshot.runtimeSnapshotVersion !== persistedVersion
    ) {
      throw new InternalServerErrorException(
        'RuntimeSnapshot body is inconsistent.',
      );
    }
    return {
      runtimeConfig: compatibility.runtimeConfig,
      document: compatibility.document,
      snapshot,
    };
  }

  private toPersistedProviderCatalogResponse(
    runtimeSnapshot: RuntimeSnapshot & {
      runtimeConfig?: RuntimeConfig | null;
    },
  ): ProviderCatalogResponseDto | null {
    const snapshot = this.toPersistedRuntimeSnapshotResponse(
      runtimeSnapshot,
    );
    const runtimeConfig = runtimeSnapshot.runtimeConfig;
    if (!runtimeConfig) {
      return null;
    }

    const document = this.withProviderCredentialRefBridge(
      this.toRuntimeConfigDocument(runtimeConfig.document),
    );
    const catalog = this.toProviderCatalogResponse(runtimeConfig, document);

    if (
      !this.providerCatalogMatchesRef(
        catalog,
        snapshot.providerCatalogRef,
      )
    ) {
      throw new InternalServerErrorException(
        'Provider Catalog body is inconsistent.',
      );
    }

    return catalog;
  }

  private toProviderCatalogResponse(
    runtimeConfig: RuntimeConfig,
    document: ActiveRuntimeConfigResponseDto,
  ): ProviderCatalogResponseDto {
    const catalogVersion = this.toRuntimeSnapshotVersion(
      runtimeConfig,
      document,
    );
    const updatedAt =
      runtimeConfig.publishedAt?.toISOString() ?? document.publishedAt;
    const providers = document.providers
      .filter((provider) =>
        this.isProviderCatalogProviderExecutable(provider),
      )
      .map((provider) =>
        this.toProviderCatalogProvider(provider, document),
      );
    if (providers.length === 0) {
      throw new ConflictException(
        'Provider Catalog has no executable providers.',
      );
    }

    const catalogBodyWithoutHash = {
      catalogId: this.toProviderCatalogId(
        document.applicationId,
        catalogVersion,
      ),
      catalogVersion,
      updatedAt,
      providers,
    };

    return {
      ...catalogBodyWithoutHash,
      contentHash: this.sha256(this.canonicalJson(catalogBodyWithoutHash)),
    };
  }

  private providerCatalogMatchesRef(
    catalog: ProviderCatalogResponseDto,
    ref: RuntimeSnapshotResponseDto['providerCatalogRef'],
  ): boolean {
    return (
      catalog.catalogId === ref.catalogId &&
      catalog.catalogVersion === ref.catalogVersion &&
      catalog.contentHash === ref.contentHash
    );
  }

  private isProviderCatalogProviderExecutable(
    provider: RuntimeConfigProviderDto,
  ): boolean {
    if (provider.status !== 'active') {
      return false;
    }

    const credentialRequired =
      provider.credentialRequired ?? provider.resolver !== 'none';
    if (!credentialRequired) {
      return true;
    }

    return provider.credentialRef?.credentialState === 'active';
  }

  private toProviderCatalogProvider(
    provider: RuntimeConfigProviderDto,
    document: ActiveRuntimeConfigResponseDto,
  ): ProviderCatalogResponseDto['providers'][number] {
    const adapterType = this.toRuntimeProviderAdapterType(provider);
    const credentialRequired =
      provider.credentialRequired ?? provider.resolver !== 'none';

    return {
      providerId: provider.providerId,
      providerName: provider.provider,
      adapterType,
      enabled: provider.status === 'active',
      baseUrl: this.toSafeProviderBaseUrl(provider.baseUrl),
      timeoutMs: provider.timeoutMs,
      credentialRequired,
      credentialRef: credentialRequired
        ? this.toProviderCatalogCredentialRef(provider)
        : null,
      adapterConfig:
        provider.adapterConfig ??
        this.toRuntimeProviderAdapterConfig(adapterType),
      fallbackEligible: provider.failureMode === 'fail_open_to_fallback',
      models: document.models
        .filter((model) => model.provider === provider.provider)
        .map((model) =>
          this.toProviderCatalogModel(model, provider, document),
        ),
    };
  }

  private toProviderCatalogCredentialRef(
    provider: RuntimeConfigProviderDto,
  ): NonNullable<
    ProviderCatalogResponseDto['providers'][number]['credentialRef']
  > {
    if (!provider.credentialRef) {
      throw new ConflictException(MISSING_PROVIDER_CREDENTIAL_BINDING_MESSAGE);
    }

    return {
      credentialRefId: provider.credentialRef.credentialRefId,
      credentialVersion: provider.credentialRef.credentialVersion,
      credentialState: provider.credentialRef.credentialState,
    };
  }

  private toProviderCatalogModel(
    model: RuntimeConfigModelResponseDto,
    provider: RuntimeConfigProviderDto,
    document: ActiveRuntimeConfigResponseDto,
  ): ProviderCatalogResponseDto['providers'][number]['models'][number] {
    const modelId = `${provider.providerId}:${model.model}`;
    const modelRef =
      provider.provider === BUILTIN_MOCK_PROVIDER_NAME &&
      model.model === BUILTIN_MOCK_MODEL_REF
        ? BUILTIN_MOCK_MODEL_REF
        : modelId;
    return {
      modelId,
      modelRef,
      modelName: model.model,
      displayName: model.displayName,
      enabled: model.status === 'active',
      capabilities: {
        streamingSupported: model.supportsStreaming,
        supportsJsonMode: model.supportsJsonMode,
        maxInputTokens: model.contextWindowTokens,
        maxOutputTokens: this.toMaxOutputTokens(model),
      },
      routing: {
        autoRoutingEligible: this.isModelSelectedForRouting(modelRef, document),
        costTier: this.toModelCostTier(modelRef, document),
        fallbackPriority: this.toModelFallbackPriority(modelRef, document),
      },
    };
  }

  private toProviderCatalogId(
    applicationId: string,
    catalogVersion: number,
  ): string {
    return `${PROVIDER_CATALOG_ID_PREFIX}:${applicationId}:${catalogVersion}`;
  }

  private parseProviderCatalogId(catalogId: string): {
    applicationId: string;
    catalogVersion: number;
  } {
    const parts = catalogId.split(':');
    if (parts.length !== 3 || parts[0] !== PROVIDER_CATALOG_ID_PREFIX) {
      throw new NotFoundException('Provider Catalog not found.');
    }

    const applicationId = parts[1] ?? '';
    const catalogVersionValue = parts[2] ?? '';
    if (
      !UUID_PATTERN.test(applicationId) ||
      !POSITIVE_INTEGER_PATTERN.test(catalogVersionValue)
    ) {
      throw new NotFoundException('Provider Catalog not found.');
    }

    const catalogVersion = Number.parseInt(catalogVersionValue, 10);
    if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1) {
      throw new NotFoundException('Provider Catalog not found.');
    }

    return {
      applicationId,
      catalogVersion,
    };
  }

  private toRuntimeProviderAdapterType(
    provider: RuntimeConfigProviderDto,
  ): string {
    if (this.isSafeCatalogToken(provider.adapterType)) {
      return provider.adapterType.trim();
    }

    return provider.provider === 'mock' ? 'mock' : 'openai_compatible';
  }

  private toProviderConnectionAdapterType(
    provider: ProviderConnection,
  ): string {
    const adapterType = this.toRecordOrNull(provider.providerConfig)
      ?.adapterType;
    if (this.isSafeCatalogToken(adapterType)) {
      return adapterType.trim();
    }

    return provider.provider === 'mock' ? 'mock' : 'openai_compatible';
  }

  private toProviderConnectionCredentialRequired(
    provider: ProviderConnection,
  ): boolean {
    const credentialRequired = this.toRecordOrNull(provider.providerConfig)
      ?.credentialRequired;
    if (typeof credentialRequired === 'boolean') {
      return credentialRequired;
    }

    return provider.resolver !== 'none';
  }

  private toProviderConnectionAdapterConfig(
    provider: ProviderConnection,
    adapterType: string,
  ): ProviderCatalogResponseDto['providers'][number]['adapterConfig'] {
    const providerConfig = this.toRecordOrNull(provider.providerConfig);
    const requestFormat = this.toAdapterRequestFormat(
      providerConfig?.requestFormat,
      adapterType,
    );
    const apiVersion = this.toAdapterApiVersion(providerConfig?.apiVersion);

    return apiVersion ? { requestFormat, apiVersion } : { requestFormat };
  }

  private toRuntimeProviderAdapterConfig(
    adapterType: string,
  ): ProviderCatalogResponseDto['providers'][number]['adapterConfig'] {
    if (adapterType === 'anthropic') {
      return { requestFormat: 'anthropic_messages' };
    }

    return {
      requestFormat:
        adapterType === 'mock'
          ? 'mock_chat_completions'
          : 'openai_chat_completions',
    };
  }

  private toAdapterRequestFormat(
    value: unknown,
    adapterType: string,
  ):
    | 'openai_chat_completions'
    | 'anthropic_messages'
    | 'mock_chat_completions' {
    if (
      value === 'openai_chat_completions' ||
      value === 'anthropic_messages' ||
      value === 'mock_chat_completions'
    ) {
      return value;
    }

    if (adapterType === 'anthropic') {
      return 'anthropic_messages';
    }

    return adapterType === 'mock'
      ? 'mock_chat_completions'
      : 'openai_chat_completions';
  }

  private toAdapterApiVersion(value: unknown): string | undefined {
    if (
      typeof value === 'string' &&
      /^[A-Za-z0-9._-]{1,80}$/.test(value)
    ) {
      return value;
    }

    return undefined;
  }

  private toSafeProviderBaseUrl(baseUrl: string): string {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new ConflictException('Provider baseUrl is not executable.');
    }

    if (parsedUrl.username || parsedUrl.password) {
      throw new ConflictException(
        'Provider baseUrl must not contain credential material.',
      );
    }

    const forbiddenQueryKeys = new Set([
      'api_key',
      'apikey',
      'key',
      'token',
      'access_token',
      'authorization',
    ]);
    for (const key of parsedUrl.searchParams.keys()) {
      if (forbiddenQueryKeys.has(key.toLowerCase())) {
        throw new ConflictException(
          'Provider baseUrl must not contain credential material.',
        );
      }
    }

    return baseUrl;
  }

  private toMaxOutputTokens(model: RuntimeConfigModelResponseDto): number {
    return Math.max(
      1,
      Math.min(4096, Math.floor(model.contextWindowTokens / 4)),
    );
  }

  private isModelSelectedForRouting(
    modelRef: string,
    document: ActiveRuntimeConfigResponseDto,
  ): boolean {
    return this.routingModelRefs(document.routingPolicy.routes).includes(
      modelRef,
    );
  }

  private toModelFallbackPriority(
    modelRef: string,
    document: ActiveRuntimeConfigResponseDto,
  ): number {
    const indexes = RUNTIME_CONFIG_ROUTING_CATEGORIES.flatMap((category) =>
      ROUTING_DIFFICULTIES.map((difficulty) =>
        document.routingPolicy.routes[category][difficulty].modelRefs.indexOf(
          modelRef,
        ),
      ),
    ).filter((index) => index >= 0);
    return indexes.length > 0 ? Math.min(...indexes) : 100;
  }

  private toModelCostTier(
    modelRef: string,
    document: ActiveRuntimeConfigResponseDto,
  ): 'low' | 'balanced' | 'premium' {
    if (modelRef === BUILTIN_MOCK_MODEL_REF) return 'balanced';

    let simplePrimary = false;
    let complexPrimary = false;
    let configuredFallback = false;
    for (const category of RUNTIME_CONFIG_ROUTING_CATEGORIES) {
      for (const difficulty of ROUTING_DIFFICULTIES) {
        const index = document.routingPolicy.routes[category][difficulty].modelRefs.indexOf(modelRef);
        if (index < 0) continue;
        if (index > 0) configuredFallback = true;
        if (index === 0 && difficulty === 'simple') simplePrimary = true;
        if (index === 0 && difficulty === 'complex') complexPrimary = true;
      }
    }
    if (configuredFallback || (simplePrimary && complexPrimary)) return 'balanced';
    if (simplePrimary) return 'low';
    return 'premium';
  }

  private isSafeCatalogToken(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[A-Za-z0-9._-]{1,80}$/.test(value.trim())
    );
  }

  private toRuntimeSnapshotVersion(
    runtimeConfig: RuntimeConfig,
    document: ActiveRuntimeConfigResponseDto,
  ): number {
    const fromVersion =
      this.trailingPositiveInteger(runtimeConfig.configVersion) ??
      this.trailingPositiveInteger(document.configVersion);
    if (fromVersion) {
      return fromVersion;
    }

    const publishedAt =
      runtimeConfig.publishedAt ?? new Date(document.publishedAt);
    if (!Number.isNaN(publishedAt.getTime())) {
      return Math.max(1, publishedAt.getTime());
    }

    return 1;
  }

  private trailingPositiveInteger(value: string): number | null {
    const match = value.match(/(\d+)$/);
    if (!match?.[1]) {
      return null;
    }
    const parsed = Number.parseInt(match[1], 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  // Bridges legacy provider.secretRef into v2-facing credentialRef metadata without exposing credential material.
  private withProviderCredentialRefBridge(
    document: ActiveRuntimeConfigResponseDto,
  ): ActiveRuntimeConfigResponseDto {
    return {
      ...document,
      providers: document.providers.map((provider) => ({
        ...provider,
        credentialRef:
          provider.credentialRef ??
          (provider.secretRef
            ? {
                credentialRefId: provider.secretRef,
                credentialVersion: 1,
                credentialState:
                  provider.status === 'active' ? 'active' : 'disabled',
              }
            : null),
      })),
    };
  }

  private toCredentialRef(
    credential: GatewayApiKey | AppToken,
    type: 'api_key' | 'app_token',
  ): RuntimeConfigCredentialRefDto {
    return {
      id: credential.id,
      type,
      status: this.toCredentialStatus(credential.status),
      prefix: credential.prefix,
      last4: credential.last4,
      scopes: credential.scopes,
      expiresAt: credential.expiresAt?.toISOString() ?? null,
      verification: 'prefix_then_hash_compare',
    };
  }

  private toProviderCredentialRef(
    provider: ProviderConnection,
  ): RuntimeConfigProviderDto['credentialRef'] {
    if (!provider.secretRef) {
      return null;
    }
    return {
      credentialRefId: provider.secretRef,
      credentialVersion: 1,
      credentialState:
        provider.status === ProviderConnectionStatus.ACTIVE
          ? 'active'
          : 'disabled',
    };
  }

  private toProviderCredentialPreview(
    provider: ProviderConnection,
  ): RuntimeConfigProviderDto['credentialPreview'] {
    if (!provider.credentialPrefix && !provider.credentialLast4) {
      return null;
    }

    if (
      !provider.credentialPrefix ||
      !provider.credentialLast4 ||
      provider.credentialLast4.length !== 4
    ) {
      throw new ConflictException(
        'Provider credential preview must include prefix and 4-character last4.',
      );
    }

    return {
      prefix: provider.credentialPrefix,
      last4: provider.credentialLast4,
    };
  }

  private assertPricingRuleModelExists(
    rule: NonNullable<UpsertRuntimeConfigDraftDto['pricingRules']>[number],
    models: RuntimeConfigModelResponseDto[],
  ): Pick<RuntimeConfigPricingRuleResponseDto, 'provider' | 'model'> {
    if (
      models.some(
        (model) =>
          model.provider === rule.provider && model.model === rule.model,
      )
    ) {
      return {
        provider: rule.provider,
        model: rule.model,
      };
    }

    throw new ConflictException(
      'Runtime Config pricing rule model is not available.',
    );
  }

  private toDraftDto(
    document: ActiveRuntimeConfigResponseDto,
    effectiveAt: string | undefined,
  ): UpsertRuntimeConfigDraftDto {
    return {
      effectiveAt: effectiveAt ?? document.effectiveAt,
      rateLimit: {
        enabled: document.rateLimit.enabled,
        limit: document.rateLimit.limit,
        windowSeconds: document.rateLimit.windowSeconds,
      },
      budgetPolicy: {
        enabled: document.budgetPolicy.enabled,
        enforcementMode: document.budgetPolicy.enforcementMode,
        warningThresholdPercent:
          document.budgetPolicy.warningThresholdPercent,
      },
      cachePolicy: {
        enabled: document.cachePolicy.enabled,
        ttlSeconds: document.cachePolicy.ttlSeconds,
      },
      promptCapturePolicy: {
        enabled: document.promptCapturePolicy.enabled,
        mode: document.promptCapturePolicy.mode,
        maxChars: document.promptCapturePolicy.maxChars,
      },
      responseCapturePolicy: {
        enabled: document.responseCapturePolicy.enabled,
        mode: document.responseCapturePolicy.mode,
        maxChars: document.responseCapturePolicy.maxChars,
      },
      routingPolicy: {
        mode: document.routingPolicy.mode,
        routes: document.routingPolicy.routes,
      },
      safetyPolicy: {
        detectors: document.safetyPolicy.detectors,
      },
      models: document.models,
      pricingRules: document.pricingRules.map((rule) => ({
        provider: rule.provider,
        model: rule.model,
        pricingVersion: rule.pricingVersion,
        promptTokenMicroUsd: rule.promptTokenMicroUsd,
        completionTokenMicroUsd: rule.completionTokenMicroUsd,
      })),
    };
  }

  private toDraftResponse(
    runtimeConfig: RuntimeConfig,
  ): RuntimeConfigDraftResponseDto {
    return {
      id: runtimeConfig.id,
      tenantId: runtimeConfig.tenantId,
      projectId: runtimeConfig.projectId,
      applicationId: runtimeConfig.applicationId,
      configVersion: runtimeConfig.configVersion,
      configHash: runtimeConfig.configHash,
      publishState: 'draft',
      effectiveAt: runtimeConfig.effectiveAt?.toISOString() ?? null,
      publishedAt: runtimeConfig.publishedAt?.toISOString() ?? null,
      createdAt: runtimeConfig.createdAt.toISOString(),
      updatedAt: runtimeConfig.updatedAt.toISOString(),
      runtimeConfig: this.toRuntimeConfigDocument(runtimeConfig.document),
    };
  }

  private readRuntimeConfigDocument<
    T extends { configHash: string; document: Prisma.JsonValue },
  >(
    runtimeConfig: T,
  ): {
    runtimeConfig: T;
    document: ActiveRuntimeConfigResponseDto;
  } {
    const isV2 = this.isPersistedRoutingV2(runtimeConfig.document);
    if (this.declaresRoutingV2(runtimeConfig.document) && !isV2) {
      throw new ConflictException(
        'Runtime Config routing policy v2 is invalid.',
      );
    }
    const normalized = this.withProviderCredentialRefBridge(
      this.toRuntimeConfigDocument(runtimeConfig.document),
    );
    if (isV2) {
      return { runtimeConfig, document: normalized };
    }

    const migratedDocument = {
      ...normalized,
      configHash: this.sha256(
        this.canonicalJson({
          ...normalized,
          configHash: undefined,
        }),
      ),
    };
    return {
      runtimeConfig: {
        ...runtimeConfig,
        configHash: migratedDocument.configHash,
      },
      document: migratedDocument,
    };
  }

  private isPersistedRoutingV2(value: Prisma.JsonValue): boolean {
    if (!this.isRecord(value)) {
      return false;
    }
    const routingPolicy = value.routingPolicy;
    return (
      value.schemaVersion === 'gatelm.active-runtime-config.v2' &&
      this.isRecord(routingPolicy) &&
      Object.keys(routingPolicy).length === 5 &&
      routingPolicy.schemaVersion === 'gatelm.routing-policy.v2' &&
      (routingPolicy.mode === 'auto' || routingPolicy.mode === 'manual') &&
      (routingPolicy.bootstrapState === 'mock_bootstrap' ||
        routingPolicy.bootstrapState === 'configured') &&
      this.isRoutingPolicyHash(routingPolicy.routingPolicyHash) &&
      this.isRoutingRoutesShape(routingPolicy.routes) &&
      !LEGACY_ROUTING_FIELDS.some(
        (legacyField) =>
          legacyField in value || legacyField in routingPolicy,
      )
    );
  }

  private declaresRoutingV2(value: Prisma.JsonValue): boolean {
    if (!this.isRecord(value)) {
      return false;
    }
    const routingPolicy = value.routingPolicy;
    return (
      value.schemaVersion === 'gatelm.active-runtime-config.v2' ||
      (this.isRecord(routingPolicy) &&
        routingPolicy.schemaVersion === 'gatelm.routing-policy.v2')
    );
  }

  private toRuntimeConfigHistoryItem(
    runtimeConfig: Pick<
      RuntimeConfig,
      | 'id'
      | 'configVersion'
      | 'configHash'
      | 'publishState'
      | 'effectiveAt'
      | 'publishedAt'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): RuntimeConfigHistoryItemDto {
    return {
      id: runtimeConfig.id,
      configVersion: runtimeConfig.configVersion,
      configHash: runtimeConfig.configHash,
      publishState: this.toRuntimeConfigPublishState(
        runtimeConfig.publishState,
      ),
      effectiveAt: runtimeConfig.effectiveAt?.toISOString() ?? null,
      publishedAt: runtimeConfig.publishedAt?.toISOString() ?? null,
      createdAt: runtimeConfig.createdAt.toISOString(),
      updatedAt: runtimeConfig.updatedAt.toISOString(),
      canRollback:
        runtimeConfig.publishState === RuntimeConfigPublishState.SUPERSEDED ||
        runtimeConfig.publishState === RuntimeConfigPublishState.ROLLED_BACK,
    };
  }

  private toRuntimeConfigDocument(
    value: Prisma.JsonValue,
  ): ActiveRuntimeConfigResponseDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConflictException('Runtime Config document is invalid.');
    }

    const runtimeDocument = value as Record<string, unknown>;
    const {
      defaultProvider: _defaultProvider,
      defaultModel: _defaultModel,
      lowCostProvider: _lowCostProvider,
      lowCostModel: _lowCostModel,
      highQualityProvider: _highQualityProvider,
      highQualityModel: _highQualityModel,
      fallbackProvider: _fallbackProvider,
      fallbackModel: _fallbackModel,
      routingPolicy: _routingPolicy,
      ...documentWithoutLegacyRouting
    } = runtimeDocument;
    const providers = Array.isArray(runtimeDocument.providers)
      ? (runtimeDocument.providers as unknown as RuntimeConfigProviderDto[])
      : [];
    const models = this.withBuiltinMockModel(
      Array.isArray(runtimeDocument.models)
        ? (runtimeDocument.models as unknown as RuntimeConfigModelResponseDto[])
        : [],
    );
    const runtimeProviders = this.withBuiltinMockRuntimeProvider(providers);

    return {
      ...(documentWithoutLegacyRouting as unknown as ActiveRuntimeConfigResponseDto),
      schemaVersion: 'gatelm.active-runtime-config.v2',
      providers: runtimeProviders,
      models,
      budgetPolicy: this.normalizeRuntimeConfigBudgetPolicy(
        runtimeDocument,
      ),
      promptCapturePolicy:
        this.normalizeRuntimeConfigPromptCapturePolicy(runtimeDocument),
      responseCapturePolicy:
        this.normalizeRuntimeConfigResponseCapturePolicy(runtimeDocument),
      routingPolicy: this.normalizeStoredRoutingPolicy(
        runtimeDocument,
        runtimeProviders,
        models,
      ),
    };
  }

  private normalizeStoredRoutingPolicy(
    runtimeDocument: Record<string, unknown>,
    providers: RuntimeConfigProviderDto[],
    models: RuntimeConfigModelResponseDto[],
  ): RuntimeConfigRoutingPolicyResponseDto {
    const rawPolicy = this.isRecord(runtimeDocument.routingPolicy)
      ? runtimeDocument.routingPolicy
      : null;
    const routingProviders = this.toProviderConnectionsForRouting(providers);
    if (
      rawPolicy?.schemaVersion === 'gatelm.routing-policy.v2' &&
      (rawPolicy.mode === 'auto' || rawPolicy.mode === 'manual') &&
      (rawPolicy.bootstrapState === 'mock_bootstrap' ||
        rawPolicy.bootstrapState === 'configured') &&
      this.isRoutingRoutesShape(rawPolicy.routes) &&
      this.isRoutingPolicyHash(rawPolicy.routingPolicyHash)
    ) {
      return {
        schemaVersion: 'gatelm.routing-policy.v2',
        mode: rawPolicy.mode,
        bootstrapState: rawPolicy.bootstrapState,
        routes: rawPolicy.routes,
        routingPolicyHash: rawPolicy.routingPolicyHash,
      };
    }

    const legacyModelRef = (
      providerField: (typeof LEGACY_ROUTING_FIELDS)[number],
      modelField: (typeof LEGACY_ROUTING_FIELDS)[number],
    ): string | null => {
      const providerName =
        this.toNonEmptyTrimmedString(rawPolicy?.[providerField]) ??
        this.toNonEmptyTrimmedString(runtimeDocument[providerField]);
      const modelName =
        this.toNonEmptyTrimmedString(rawPolicy?.[modelField]) ??
        this.toNonEmptyTrimmedString(runtimeDocument[modelField]);
      if (!modelName) {
        return null;
      }

      const matchedProvider = providers
        .filter(
          (provider) =>
            provider.status === 'active' &&
            (!providerName || provider.provider === providerName) &&
            models.some(
              (model) =>
                model.status === 'active' &&
                model.provider === provider.provider &&
                model.model === modelName,
            ),
        )
        .sort((left, right) =>
          left.providerId.localeCompare(right.providerId),
        )[0];
      if (!matchedProvider) {
        return null;
      }

      return matchedProvider.provider === BUILTIN_MOCK_PROVIDER_NAME &&
        modelName === BUILTIN_MOCK_MODEL_REF
        ? BUILTIN_MOCK_MODEL_REF
        : `${matchedProvider.providerId}:${modelName}`;
    };

    const simpleModelRef =
      legacyModelRef('lowCostProvider', 'lowCostModel') ??
      legacyModelRef('defaultProvider', 'defaultModel') ??
      BUILTIN_MOCK_MODEL_REF;
    const complexModelRef =
      legacyModelRef('highQualityProvider', 'highQualityModel') ??
      simpleModelRef;
    const legacyFallbackModelRef = legacyModelRef(
      'fallbackProvider',
      'fallbackModel',
    );
    const fallbackModelRef =
      legacyFallbackModelRef &&
      legacyFallbackModelRef !== simpleModelRef &&
      legacyFallbackModelRef !== complexModelRef
        ? legacyFallbackModelRef
        : undefined;
    const routes = this.buildRoutingAuthoringRoutes(
      simpleModelRef,
      complexModelRef,
      fallbackModelRef,
    );
    const policyWithoutHash = {
      schemaVersion: 'gatelm.routing-policy.v2',
      mode: 'auto',
      bootstrapState: this.toRoutingBootstrapState(
        routes,
        models,
        routingProviders,
      ),
      routes,
    } as const;
    return {
      ...policyWithoutHash,
      routingPolicyHash: this.sha256Tagged(
        this.canonicalJson(policyWithoutHash),
      ),
    };
  }

  private toNonEmptyTrimmedString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private defaultRuntimeConfigBudgetPolicy(): RuntimeConfigBudgetPolicyResponseDto {
    return {
      enabled: false,
      enforcementMode: 'disabled',
      warningThresholdPercent: DEFAULT_BUDGET_WARNING_THRESHOLD_PERCENT,
    };
  }

  private isExecutableBudgetPolicy(
    budgetPolicy: RuntimeConfigBudgetPolicyResponseDto,
  ): boolean {
    return (
      Boolean(budgetPolicy) &&
      typeof budgetPolicy.enabled === 'boolean' &&
      ['warn', 'block', 'disabled'].includes(
        budgetPolicy.enforcementMode,
      ) &&
      Number.isInteger(budgetPolicy.warningThresholdPercent) &&
      budgetPolicy.warningThresholdPercent >= 0 &&
      budgetPolicy.warningThresholdPercent <= 100 &&
      (budgetPolicy.enabled
        ? budgetPolicy.enforcementMode !== 'disabled'
        : budgetPolicy.enforcementMode === 'disabled')
    );
  }

  private isExecutablePromptCapturePolicy(
    policy: RuntimeConfigPromptCapturePolicyResponseDto,
  ): boolean {
    return (
      Boolean(policy) &&
      typeof policy.enabled === 'boolean' &&
      Number.isInteger(policy.maxChars) &&
      policy.maxChars >= 1 &&
      policy.maxChars <= 20000 &&
      (policy.enabled
        ? policy.mode === 'log_safe_full'
        : policy.mode === 'disabled')
    );
  }

  private isExecutableResponseCapturePolicy(
    policy: RuntimeConfigResponseCapturePolicyResponseDto,
  ): boolean {
    return (
      Boolean(policy) &&
      typeof policy.enabled === 'boolean' &&
      Number.isInteger(policy.maxChars) &&
      policy.maxChars >= 1 &&
      policy.maxChars <= 20000 &&
      (policy.enabled
        ? policy.mode === 'raw_full'
        : policy.mode === 'disabled')
    );
  }

  private normalizeRuntimeConfigBudgetPolicy(
    runtimeDocument: Record<string, unknown>,
  ): RuntimeConfigBudgetPolicyResponseDto {
    if (
      !Object.prototype.hasOwnProperty.call(
        runtimeDocument,
        'budgetPolicy',
      )
    ) {
      return this.defaultRuntimeConfigBudgetPolicy();
    }

    const budgetPolicy = runtimeDocument.budgetPolicy;
    if (
      !budgetPolicy ||
      typeof budgetPolicy !== 'object' ||
      Array.isArray(budgetPolicy)
    ) {
      throw new ConflictException(ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE);
    }

    const candidate = budgetPolicy as Record<string, unknown>;
    const warningThresholdPercent = Object.prototype.hasOwnProperty.call(
      candidate,
      'warningThresholdPercent',
    )
      ? candidate.warningThresholdPercent
      : DEFAULT_BUDGET_WARNING_THRESHOLD_PERCENT;
    const normalized: RuntimeConfigBudgetPolicyResponseDto = {
      enabled:
        candidate.enabled as RuntimeConfigBudgetPolicyResponseDto['enabled'],
      enforcementMode:
        candidate.enforcementMode as RuntimeConfigBudgetPolicyResponseDto['enforcementMode'],
      warningThresholdPercent:
        warningThresholdPercent as RuntimeConfigBudgetPolicyResponseDto['warningThresholdPercent'],
    };

    if (!this.isExecutableBudgetPolicy(normalized)) {
      throw new ConflictException(ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE);
    }

    return normalized;
  }

  private normalizeRuntimeConfigPromptCapturePolicy(
    runtimeDocument: Record<string, unknown>,
  ): RuntimeConfigPromptCapturePolicyResponseDto {
    if (
      !Object.prototype.hasOwnProperty.call(
        runtimeDocument,
        'promptCapturePolicy',
      )
    ) {
      return this.defaultRuntimeConfigPromptCapturePolicy();
    }

    const policy = runtimeDocument.promptCapturePolicy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new ConflictException(ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE);
    }

    const candidate = policy as Record<string, unknown>;
    const enabled = candidate.enabled === true;
    const mode = enabled ? candidate.mode ?? 'log_safe_full' : 'disabled';
    const normalized: RuntimeConfigPromptCapturePolicyResponseDto = {
      enabled,
      mode: mode as RuntimeConfigPromptCapturePolicyResponseDto['mode'],
      maxChars:
        typeof candidate.maxChars === 'number'
          ? candidate.maxChars
          : DEFAULT_PROMPT_CAPTURE_MAX_CHARS,
    };

    if (!this.isExecutablePromptCapturePolicy(normalized)) {
      throw new ConflictException(ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE);
    }

    return normalized;
  }

  private defaultRuntimeConfigPromptCapturePolicy(): RuntimeConfigPromptCapturePolicyResponseDto {
    return {
      enabled: false,
      mode: 'disabled',
      maxChars: DEFAULT_PROMPT_CAPTURE_MAX_CHARS,
    };
  }

  private normalizeRuntimeConfigResponseCapturePolicy(
    runtimeDocument: Record<string, unknown>,
  ): RuntimeConfigResponseCapturePolicyResponseDto {
    if (
      !Object.prototype.hasOwnProperty.call(
        runtimeDocument,
        'responseCapturePolicy',
      )
    ) {
      return this.defaultRuntimeConfigResponseCapturePolicy();
    }

    const policy = runtimeDocument.responseCapturePolicy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new ConflictException(ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE);
    }

    const candidate = policy as Record<string, unknown>;
    const enabled = candidate.enabled === true;
    const mode = enabled ? candidate.mode ?? 'raw_full' : 'disabled';
    const normalized: RuntimeConfigResponseCapturePolicyResponseDto = {
      enabled,
      mode: mode as RuntimeConfigResponseCapturePolicyResponseDto['mode'],
      maxChars:
        typeof candidate.maxChars === 'number'
          ? candidate.maxChars
          : DEFAULT_RESPONSE_CAPTURE_MAX_CHARS,
    };

    if (!this.isExecutableResponseCapturePolicy(normalized)) {
      throw new ConflictException(ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE);
    }

    return normalized;
  }

  private defaultRuntimeConfigResponseCapturePolicy(): RuntimeConfigResponseCapturePolicyResponseDto {
    return {
      enabled: false,
      mode: 'disabled',
      maxChars: DEFAULT_RESPONSE_CAPTURE_MAX_CHARS,
    };
  }

  private toInputJsonObject(value: object): Prisma.InputJsonObject {
    return value as unknown as Prisma.InputJsonObject;
  }

  private toRecordOrNull(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return null;
  }

  private toResolver(
    resolver: string,
  ): 'none' | 'control_plane_secret_store' | 'environment' {
    if (resolver === 'credential_store') {
      return 'control_plane_secret_store';
    }

    if (
      resolver === 'none' ||
      resolver === 'control_plane_secret_store' ||
      resolver === 'environment'
    ) {
      return resolver;
    }

    throw new ConflictException(
      'Provider resolver is not supported by Runtime Config.',
    );
  }

  private toFailureMode(
    providerConfig: Prisma.JsonValue,
  ): 'fail_closed' | 'fail_open_to_fallback' {
    const value = this.toRecordOrNull(providerConfig)?.failureMode;
    if (value === 'fail_open_to_fallback') {
      return 'fail_open_to_fallback';
    }

    return 'fail_closed';
  }

  private toProviderStatus(
    status: ProviderConnectionStatus,
  ): 'active' | 'disabled' | 'degraded' {
    return status.toLowerCase() as 'active' | 'disabled' | 'degraded';
  }

  private toCredentialStatus(
    status: CredentialStatus,
  ): 'active' | 'revoked' | 'expired' | 'disabled' {
    return status.toLowerCase() as
      | 'active'
      | 'revoked'
      | 'expired'
      | 'disabled';
  }

  private toResourceStatus(status: ResourceStatus): ResourceStatusDto {
    return status.toLowerCase() as ResourceStatusDto;
  }

  private toRuntimeConfigPublishState(
    status: RuntimeConfigPublishState,
  ): RuntimeConfigHistoryItemDto['publishState'] {
    return status.toLowerCase() as RuntimeConfigHistoryItemDto['publishState'];
  }

  private toPricingRuleId(provider: string, model: string): string {
    return `price_${provider}_${model}_v1`.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private toPricingVersion(provider: string, now: Date): string {
    return `${now.toISOString().slice(0, 10)}.${provider}.v1`;
  }

  private createPublishedConfigVersion(now: Date): string {
    return `runtime_config_${now.getTime()}`;
  }

  private toRuntimeConfigVersionForLookup(value: string): string | null {
    const configVersion = value.trim();
    if (
      !configVersion ||
      !RUNTIME_CONFIG_VERSION_PATTERN.test(configVersion)
    ) {
      return null;
    }

    return configVersion;
  }

  private createRollbackConfigVersion(
    targetConfigVersion: string,
    now: Date,
  ): string {
    const safeTarget = targetConfigVersion
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 80);
    return `runtime_config_rollback_${safeTarget}_${now.getTime()}`;
  }

  private defaultSafetyDetectors(): RuntimeConfigSafetyDetectorResponseDto[] {
    return [
      {
        type: 'email',
        enabled: true,
        action: 'redact',
        placeholder: '[EMAIL_REDACTED]',
      },
      {
        type: 'phone_number',
        enabled: true,
        action: 'redact',
        placeholder: '[PHONE_NUMBER_REDACTED]',
      },
      {
        type: 'person_name',
        enabled: true,
        action: 'redact',
        placeholder: '[PERSON_NAME_REDACTED]',
      },
      {
        type: 'postal_address',
        enabled: true,
        action: 'redact',
        placeholder: '[POSTAL_ADDRESS_REDACTED]',
      },
      {
        type: 'organization_name',
        enabled: true,
        action: 'redact',
        placeholder: '[ORGANIZATION_NAME_REDACTED]',
      },
      {
        type: 'resident_registration_number',
        enabled: true,
        action: 'block',
        placeholder: '[RESIDENT_REGISTRATION_NUMBER_REDACTED]',
      },
      {
        type: 'api_key',
        enabled: true,
        action: 'block',
        placeholder: '[API_KEY_REDACTED]',
      },
      {
        type: 'authorization_header',
        enabled: true,
        action: 'block',
        placeholder: '[AUTHORIZATION_HEADER_REDACTED]',
      },
      {
        type: 'jwt',
        enabled: true,
        action: 'block',
        placeholder: '[JWT_REDACTED]',
      },
      {
        type: 'private_key',
        enabled: true,
        action: 'block',
        placeholder: '[SECRET_REDACTED]',
      },
    ];
  }

  private canonicalJson(value: unknown): string {
    if (value === undefined) {
      return '';
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new ConflictException(
          'Runtime Config contains an invalid Date value.',
        );
      }

      return JSON.stringify(value.toISOString());
    }
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }

    const objectValue = value as Record<string, unknown>;
    const entries = Object.entries(objectValue)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => this.compareCanonicalKeys(left, right));

    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${this.canonicalJson(entryValue)}`,
      )
      .join(',')}}`;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private sha256Tagged(value: string): string {
    return `sha256:${this.sha256(value)}`;
  }

  private isRoutingPolicyHash(value: unknown): value is string {
    return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  }

  private toDate(value: string): Date {
    return new Date(value);
  }

  private compareCanonicalKeys(left: string, right: string): number {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }

    return 0;
  }

  private toModelKey(provider: string, model: string): string {
    return `${provider}\u0000${model}`;
  }

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isConcurrentWriteError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }
}
