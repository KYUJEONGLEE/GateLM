import {
  ConflictException,
  Injectable,
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
} from '@prisma/client';
import { createHash } from 'node:crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ActiveRuntimeConfigResponseDto,
  PublishRuntimeConfigDto,
  ProviderCatalogResponseDto,
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
  RuntimeConfigProviderDto,
  RuntimeConfigRateLimitResponseDto,
  RuntimeConfigRoutingPolicyResponseDto,
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

type RuntimeApplicationContext = NonNullable<
  Awaited<ReturnType<PrismaService['application']['findUnique']>>
> & {
  tenant: { id: string; status: ResourceStatus };
  project: { id: string; status: ResourceStatus };
};

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
  ): Promise<RuntimeConfigHistoryResponseDto> {
    await this.getApplicationContextOrThrow(applicationId);
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
        { publishedAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return {
      applicationId,
      items: runtimeConfigs.map((runtimeConfig) =>
        this.toRuntimeConfigHistoryItem(runtimeConfig),
      ),
    };
  }

  async getRuntimeConfigHistoryDetail(
    applicationId: string,
    configVersion: string,
  ): Promise<RuntimeConfigHistoryDetailResponseDto> {
    await this.getApplicationContextOrThrow(applicationId);
    const requestedConfigVersion = configVersion.trim();
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

    const document = this.withProviderCredentialRefBridge(
      this.toRuntimeConfigDocument(runtimeConfig.document),
    );
    this.assertNoForbiddenRuntimeConfigKeys(document);

    return {
      applicationId,
      item: this.toRuntimeConfigHistoryItem(runtimeConfig),
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

  private async getExecutableActiveRuntimeConfig(args: {
    applicationId: string;
    notFoundMessage: string;
  }): Promise<{
    runtimeConfig: RuntimeConfig;
    document: ActiveRuntimeConfigResponseDto;
  }> {
    const { applicationId, notFoundMessage } = args;
    const runtimeConfig = await this.prisma.runtimeConfig.findFirst({
      where: {
        applicationId,
        publishState: RuntimeConfigPublishState.ACTIVE,
      },
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    if (!runtimeConfig) {
      throw new NotFoundException(notFoundMessage);
    }

    const document = this.withProviderCredentialRefBridge(
      this.toRuntimeConfigDocument(runtimeConfig.document),
    );
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

    const draftDocument = this.toRuntimeConfigDocument(draft.document);
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

          await tx.runtimeConfig.create({
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

    const targetDocument = this.withProviderCredentialRefBridge(
      this.toRuntimeConfigDocument(target.document),
    );
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

          await tx.runtimeConfig.create({
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

    const [apiKey, appToken, providers] = await Promise.all([
      this.getActiveApiKeyOrThrow(context.projectId, args.now),
      this.getActiveAppTokenOrThrow(context.id, args.now),
      this.getProvidersOrThrow(context.projectId),
    ]);
    const activeProvider = this.getPrimaryActiveProvider(providers);
    const models = this.resolveModels(args.dto.models, providers);
    const defaultModel = this.resolveModelForProvider(
      models,
      args.dto.routingPolicy?.defaultProvider ?? activeProvider.provider,
      args.dto.routingPolicy?.defaultModel,
    );
    const lowCostModel = this.resolveModelForProvider(
      models,
      args.dto.routingPolicy?.lowCostProvider ?? defaultModel.provider,
      args.dto.routingPolicy?.lowCostModel,
    );
    const fallbackModel = this.resolveModelForProvider(
      models,
      args.dto.routingPolicy?.fallbackProvider ?? defaultModel.provider,
      args.dto.routingPolicy?.fallbackModel,
    );
    this.assertSelectedProviderConnectionsActive(providers, [
      defaultModel.provider,
      lowCostModel.provider,
      fallbackModel.provider,
    ]);
    this.assertSelectedModelsActive([
      defaultModel,
      lowCostModel,
      fallbackModel,
    ]);
    const effectiveAt = args.dto.effectiveAt
      ? new Date(args.dto.effectiveAt)
      : args.now;
    const generatedAt = args.now.toISOString();
    const effectiveAtIso = effectiveAt.toISOString();
    const publishedAtIso = args.publishedAt.toISOString();
    const safetyPolicy = this.resolveSafetyPolicy(args.dto.safetyPolicy);
    const routingPolicy = this.resolveRoutingPolicy({
      dto: args.dto,
      defaultModel,
      lowCostModel,
      fallbackModel,
    });
    const providersResponse = providers.map((provider) =>
      this.toRuntimeProvider(provider, models),
    );
    if (args.publishState === 'active') {
      this.assertRuntimeSnapshotProviderCredentialBindings(
        providersResponse,
        [
          defaultModel.provider,
          lowCostModel.provider,
          fallbackModel.provider,
        ],
      );
    }
    const pricingRules = this.resolvePricingRules(
      args.dto.pricingRules,
      models,
      effectiveAtIso,
      args.now,
    );
    const documentWithoutHash: ActiveRuntimeConfigResponseDto = {
      schemaVersion: 'gatelm.active-runtime-config.v1',
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
      appTokenId: appToken.id,
      appTokenStatus: this.toCredentialStatus(appToken.status),
      apiKey: this.toCredentialRef(apiKey, 'api_key'),
      appToken: this.toCredentialRef(appToken, 'app_token'),
      providers: providersResponse,
      models,
      defaultProvider: defaultModel.provider,
      defaultModel: defaultModel.model,
      lowCostProvider: lowCostModel.provider,
      lowCostModel: lowCostModel.model,
      fallbackProvider: fallbackModel.provider,
      fallbackModel: fallbackModel.model,
      rateLimit: this.resolveRateLimit(args.dto.rateLimit),
      budgetPolicy: this.resolveBudgetPolicy(args.dto.budgetPolicy),
      safetyPolicy,
      cachePolicy: this.resolveCachePolicy(args.dto.cachePolicy),
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
    this.assertRuntimeSnapshotProviderCredentialBindings(
      args.document.providers,
      [
        args.document.defaultProvider,
        args.document.lowCostProvider,
        args.document.fallbackProvider,
      ],
    );
    this.assertNoForbiddenRuntimeConfigKeys(args.document);

    const context = await this.getApplicationContextOrThrow(args.applicationId);
    this.assertActiveContext(context);
    this.assertDocumentMatchesCurrentContext(args.document, context);

    await Promise.all([
      this.assertCurrentApiKeyExecutable(args.document, context, args.now),
      this.assertCurrentAppTokenExecutable(args.document, context, args.now),
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
      document.schemaVersion !== 'gatelm.active-runtime-config.v1' ||
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

  private async assertCurrentAppTokenExecutable(
    document: ActiveRuntimeConfigResponseDto,
    context: RuntimeApplicationContext,
    now: Date,
  ): Promise<void> {
    const appToken = await this.prisma.appToken.findUnique({
      where: { id: document.appTokenId },
    });

    if (
      !appToken ||
      document.appToken.id !== document.appTokenId ||
      document.appToken.type !== 'app_token' ||
      document.appTokenStatus !== 'active' ||
      document.appToken.status !== 'active' ||
      appToken.tenantId !== context.tenantId ||
      appToken.projectId !== context.projectId ||
      appToken.applicationId !== context.id ||
      !this.isCredentialCurrentlyActive(appToken, now)
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
    const selectedProviderNames = new Set([
      document.defaultProvider,
      document.lowCostProvider,
      document.fallbackProvider,
      document.routingPolicy.defaultProvider,
      document.routingPolicy.lowCostProvider,
      document.routingPolicy.fallbackProvider,
    ]);
    const currentProviders = await this.prisma.providerConnection.findMany({
      where: {
        projectId: context.projectId,
        provider: { in: [...selectedProviderNames] },
      },
    });
    const currentByName = new Map(
      currentProviders.map((provider) => [provider.provider, provider]),
    );

    for (const providerName of selectedProviderNames) {
      const documentProvider = document.providers.find(
        (provider) => provider.provider === providerName,
      );
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
    this.assertSelectedModelIsExecutable(
      document,
      document.defaultProvider,
      document.defaultModel,
    );
    this.assertSelectedModelIsExecutable(
      document,
      document.lowCostProvider,
      document.lowCostModel,
    );
    this.assertSelectedModelIsExecutable(
      document,
      document.fallbackProvider,
      document.fallbackModel,
    );
    this.assertSelectedModelIsExecutable(
      document,
      document.routingPolicy.defaultProvider,
      document.routingPolicy.defaultModel,
    );
    this.assertSelectedModelIsExecutable(
      document,
      document.routingPolicy.lowCostProvider,
      document.routingPolicy.lowCostModel,
    );
    this.assertSelectedModelIsExecutable(
      document,
      document.routingPolicy.fallbackProvider,
      document.routingPolicy.fallbackModel,
    );

    if (
      document.rateLimit.scope !== 'application' ||
      document.rateLimit.algorithm !== 'fixed_window' ||
      document.rateLimit.windowSeconds !== 60 ||
      !Number.isInteger(document.rateLimit.limit) ||
      document.rateLimit.limit < 1 ||
      !this.isExecutableBudgetPolicy(document.budgetPolicy) ||
      document.cachePolicy.type !== 'exact' ||
      !Number.isInteger(document.cachePolicy.ttlSeconds) ||
      document.cachePolicy.ttlSeconds < 1 ||
      document.safetyPolicy.mode !== 'rule_based' ||
      !document.safetyPolicy.securityPolicyHash ||
      !Array.isArray(document.safetyPolicy.detectors) ||
      document.safetyPolicy.detectors.length === 0 ||
      document.routingPolicy.type !== 'simple' ||
      document.routingPolicy.autoModel !== 'auto' ||
      !document.routingPolicy.routingPolicyHash ||
      !Array.isArray(document.pricingRules) ||
      document.pricingRules.length === 0
    ) {
      throw new ConflictException(
        ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
      );
    }
  }

  private assertRuntimeConfigRequiredPolicyShape(
    document: ActiveRuntimeConfigResponseDto,
  ): void {
    const runtimeDocument = document as unknown as Record<string, unknown>;
    if (
      !this.isNonEmptyString(runtimeDocument.apiKeyId) ||
      !this.isNonEmptyString(runtimeDocument.appTokenId) ||
      !this.isCredentialRefShape(runtimeDocument.apiKey, 'api_key') ||
      !this.isCredentialRefShape(runtimeDocument.appToken, 'app_token') ||
      !Array.isArray(document.providers) ||
      document.providers.length === 0 ||
      !Array.isArray(document.models) ||
      document.models.length === 0 ||
      !document.rateLimit ||
      !document.budgetPolicy ||
      !document.cachePolicy ||
      !document.safetyPolicy ||
      !document.routingPolicy ||
      !Array.isArray(document.pricingRules)
    ) {
      throw new ConflictException(
        ACTIVE_RUNTIME_CONFIG_NOT_EXECUTABLE_MESSAGE,
      );
    }
  }

  private assertSelectedModelIsExecutable(
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

  private async getActiveAppTokenOrThrow(
    applicationId: string,
    now: Date,
  ): Promise<AppToken> {
    const appToken = await this.prisma.appToken.findFirst({
      where: {
        applicationId,
        status: CredentialStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (!appToken) {
      throw new ConflictException(
        'Runtime Config requires an active App Token.',
      );
    }

    return appToken;
  }

  private async getProvidersOrThrow(
    projectId: string,
  ): Promise<ProviderConnection[]> {
    const providers = await this.prisma.providerConnection.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (providers.length === 0) {
      throw new ConflictException(
        'Runtime Config requires at least one provider connection.',
      );
    }

    return providers;
  }

  private getPrimaryActiveProvider(
    providers: ProviderConnection[],
  ): ProviderConnection {
    const provider = providers.find(
      (candidate) => candidate.status === ProviderConnectionStatus.ACTIVE,
    );
    if (!provider) {
      throw new ConflictException(
        'Runtime Config requires at least one active provider.',
      );
    }

    return provider;
  }

  private assertSelectedProviderConnectionsActive(
    providers: ProviderConnection[],
    selectedProviderNames: string[],
  ): void {
    const providersByName = new Map(
      providers.map((provider) => [provider.provider, provider]),
    );

    for (const providerName of selectedProviderNames) {
      const provider = providersByName.get(providerName);
      if (!provider || provider.status !== ProviderConnectionStatus.ACTIVE) {
        throw new ConflictException(
          'Runtime Config selected providers must be active.',
        );
      }
    }
  }

  private assertSelectedModelsActive(
    selectedModels: RuntimeConfigModelResponseDto[],
  ): void {
    if (selectedModels.some((model) => model.status !== 'active')) {
      throw new ConflictException(
        'Runtime Config selected models must be active.',
      );
    }
  }

  private assertRuntimeSnapshotProviderCredentialBindings(
    providers: RuntimeConfigProviderDto[],
    selectedProviderNames: string[],
  ): void {
    const selectedProviderSet = new Set(selectedProviderNames);
    for (const provider of providers) {
      if (!selectedProviderSet.has(provider.provider)) {
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

    if (dtoModels?.length) {
      const modelKeys = new Set<string>();
      for (const model of dtoModels) {
        if (!providerNames.has(model.provider)) {
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

      const models = dtoModels.map((model) => ({
        provider: model.provider,
        model: model.model,
        displayName: model.displayName ?? model.model,
        status: model.status ?? 'active',
        contextWindowTokens: model.contextWindowTokens ?? 8192,
        supportsStreaming: model.supportsStreaming ?? false,
        supportsJsonMode: model.supportsJsonMode ?? false,
      }));

      for (const provider of providers) {
        if (models.some((model) => model.provider === provider.provider)) {
          continue;
        }

        models.push(
          ...this.resolveProviderModelNames(provider).map((model) => ({
            provider: provider.provider,
            model,
            displayName: model,
            status: 'active' as const,
            contextWindowTokens: 8192,
            supportsStreaming: false,
            supportsJsonMode: false,
          })),
        );
      }

      return models;
    }

    return providers.flatMap((provider) =>
      this.resolveProviderModelNames(provider).map((model) => ({
        provider: provider.provider,
        model,
        displayName: model,
        status: 'active',
        contextWindowTokens: 8192,
        supportsStreaming: false,
        supportsJsonMode: false,
      })),
    );
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

  private resolveModelForProvider(
    models: RuntimeConfigModelResponseDto[],
    provider: string,
    requestedModel: string | undefined,
  ): RuntimeConfigModelResponseDto {
    const matched = requestedModel
      ? models.find(
          (model) =>
            model.provider === provider && model.model === requestedModel,
        )
      : models.find((model) => model.provider === provider);
    if (matched) {
      return matched;
    }

    throw new ConflictException(
      this.toModelUnavailableMessage(provider, requestedModel),
    );
  }

  private resolveRateLimit(
    dto: UpsertRuntimeConfigDraftDto['rateLimit'],
  ): RuntimeConfigRateLimitResponseDto {
    return {
      enabled: dto?.enabled ?? true,
      scope: 'application',
      algorithm: 'fixed_window',
      windowSeconds: 60,
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

  private resolveSafetyPolicy(
    dto: UpsertRuntimeConfigDraftDto['safetyPolicy'],
  ): RuntimeConfigSafetyPolicyResponseDto {
    const detectors = dto?.detectors?.length
      ? dto.detectors
      : this.defaultSafetyDetectors();
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
    defaultModel: RuntimeConfigModelResponseDto;
    lowCostModel: RuntimeConfigModelResponseDto;
    fallbackModel: RuntimeConfigModelResponseDto;
  }): RuntimeConfigRoutingPolicyResponseDto {
    const routingPolicyWithoutHash = {
      type: 'simple',
      autoModel: 'auto',
      defaultProvider: args.defaultModel.provider,
      defaultModel: args.defaultModel.model,
      lowCostProvider: args.lowCostModel.provider,
      lowCostModel: args.lowCostModel.model,
      fallbackProvider: args.fallbackModel.provider,
      fallbackModel: args.fallbackModel.model,
      shortPromptMaxChars:
        args.dto.routingPolicy?.shortPromptMaxChars ?? 500,
    } as const;

    return {
      ...routingPolicyWithoutHash,
      routingPolicyHash: this.sha256(
        this.canonicalJson(routingPolicyWithoutHash),
      ),
    };
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
        'selectedProvider',
        'selectedModel',
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

    return {
      runtimeSnapshotId: runtimeConfig.id,
      runtimeSnapshotVersion,
      contentHash: document.configHash,
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
          autoModelEnabled: true,
          defaultRequestedModel: document.routingPolicy.autoModel,
          defaultProvider: document.routingPolicy.defaultProvider,
          defaultModel: document.routingPolicy.defaultModel,
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
        fallback: {
          enabled: true,
          fallbackProvider: document.routingPolicy.fallbackProvider,
          fallbackModel: document.routingPolicy.fallbackModel,
          allowedReasons: ['provider_timeout', 'provider_error'],
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
    };
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
    return {
      modelId: `${provider.providerId}:${model.model}`,
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
        autoRoutingEligible: model.status === 'active',
        costTier: this.toModelCostTier(model, document),
        fallbackPriority: this.toModelFallbackPriority(model, document),
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
  ): 'openai_chat_completions' | 'mock_chat_completions' {
    if (
      value === 'openai_chat_completions' ||
      value === 'mock_chat_completions'
    ) {
      return value;
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

  private toModelCostTier(
    model: RuntimeConfigModelResponseDto,
    document: ActiveRuntimeConfigResponseDto,
  ): 'low' | 'balanced' | 'premium' {
    if (
      model.provider === document.routingPolicy.lowCostProvider &&
      model.model === document.routingPolicy.lowCostModel
    ) {
      return 'low';
    }

    return 'balanced';
  }

  private toModelFallbackPriority(
    model: RuntimeConfigModelResponseDto,
    document: ActiveRuntimeConfigResponseDto,
  ): number {
    if (
      model.provider === document.routingPolicy.lowCostProvider &&
      model.model === document.routingPolicy.lowCostModel
    ) {
      return 0;
    }
    if (
      model.provider === document.routingPolicy.defaultProvider &&
      model.model === document.routingPolicy.defaultModel
    ) {
      return 1;
    }
    if (
      model.provider === document.routingPolicy.fallbackProvider &&
      model.model === document.routingPolicy.fallbackModel
    ) {
      return 10;
    }

    return 5;
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
                credentialRefId: `provider_credential:${provider.providerId}`,
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
      credentialRefId: `provider_credential:${provider.id}`,
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
      routingPolicy: {
        defaultProvider: document.routingPolicy.defaultProvider,
        defaultModel: document.routingPolicy.defaultModel,
        lowCostProvider: document.routingPolicy.lowCostProvider,
        lowCostModel: document.routingPolicy.lowCostModel,
        fallbackProvider: document.routingPolicy.fallbackProvider,
        fallbackModel: document.routingPolicy.fallbackModel,
        shortPromptMaxChars: document.routingPolicy.shortPromptMaxChars,
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
    const document = value as unknown as ActiveRuntimeConfigResponseDto;

    return {
      ...document,
      budgetPolicy: this.normalizeRuntimeConfigBudgetPolicy(
        runtimeDocument,
      ),
    };
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

  private toInputJsonObject(
    value: ActiveRuntimeConfigResponseDto,
  ): Prisma.InputJsonObject {
    return value as unknown as Prisma.InputJsonObject;
  }

  private toRecordOrNull(value: Prisma.JsonValue): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return null;
  }

  private toResolver(
    resolver: string,
  ): 'none' | 'control_plane_secret_store' | 'environment' {
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

  private toModelUnavailableMessage(
    provider: string,
    requestedModel: string | undefined,
  ): string {
    const providerLabel = this.toDiagnosticValue(provider);
    if (!requestedModel) {
      return `Runtime Config model is not available for provider "${providerLabel}".`;
    }

    return `Runtime Config model is not available for provider "${providerLabel}" and model "${this.toDiagnosticValue(requestedModel)}".`;
  }

  private toDiagnosticValue(value: string): string {
    const normalized = value
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/["\\]/g, '_');

    if (normalized.length === 0) {
      return '<empty>';
    }

    return normalized.length > 80
      ? `${normalized.slice(0, 77)}...`
      : normalized;
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
