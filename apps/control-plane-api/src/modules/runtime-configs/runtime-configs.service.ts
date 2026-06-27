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
  ResourceStatusDto,
  RuntimeConfigCachePolicyResponseDto,
  RuntimeConfigCostingDto,
  RuntimeConfigCredentialRefDto,
  RuntimeConfigDraftResponseDto,
  RuntimeConfigHashingDto,
  RuntimeConfigModelResponseDto,
  RuntimeConfigPricingRuleResponseDto,
  RuntimeConfigProviderDto,
  RuntimeConfigRateLimitResponseDto,
  RuntimeConfigRoutingPolicyResponseDto,
  RuntimeConfigSafetyDetectorResponseDto,
  RuntimeConfigSafetyPolicyResponseDto,
  UpsertRuntimeConfigDraftDto,
} from './dto/runtime-config.dto';

const DEFAULT_DRAFT_CONFIG_VERSION = 'draft';
const CONFIG_HASH_ALGORITHM =
  'sha256(canonical_json(runtimeConfig_without_configHash))';

@Injectable()
export class RuntimeConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveRuntimeConfig(
    applicationId: string,
  ): Promise<ActiveRuntimeConfigResponseDto> {
    const runtimeConfig = await this.prisma.runtimeConfig.findFirst({
      where: {
        applicationId,
        publishState: RuntimeConfigPublishState.ACTIVE,
      },
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    if (!runtimeConfig) {
      throw new NotFoundException('Active Runtime Config not found.');
    }

    const document = this.toRuntimeConfigDocument(runtimeConfig.document);
    if (document.publishState !== 'active') {
      throw new ConflictException(
        'Active Runtime Config document state is invalid.',
      );
    }

    return document;
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

  private async getApplicationContextOrThrow(applicationId: string): Promise<
    NonNullable<
      Awaited<ReturnType<PrismaService['application']['findUnique']>>
    > & {
      tenant: { id: string; status: ResourceStatus };
      project: { id: string; status: ResourceStatus };
    }
  > {
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
    return {
      providerId: provider.id,
      provider: provider.provider,
      displayName: provider.displayName,
      status: this.toProviderStatus(provider.status),
      baseUrl: provider.baseUrl,
      timeoutMs: provider.timeoutMs,
      secretRef: provider.secretRef,
      credentialPreview: this.toProviderCredentialPreview(provider),
      resolver: this.toResolver(provider.resolver),
      models: models
        .filter((model) => model.provider === provider.provider)
        .map((model) => model.model),
      failureMode: this.toFailureMode(provider.providerConfig),
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

  private toRuntimeConfigDocument(
    value: Prisma.JsonValue,
  ): ActiveRuntimeConfigResponseDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConflictException('Runtime Config document is invalid.');
    }

    return value as unknown as ActiveRuntimeConfigResponseDto;
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

  private toPricingRuleId(provider: string, model: string): string {
    return `price_${provider}_${model}_v1`.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private toPricingVersion(provider: string, now: Date): string {
    return `${now.toISOString().slice(0, 10)}.${provider}.v1`;
  }

  private createPublishedConfigVersion(now: Date): string {
    return `runtime_config_${now.getTime()}`;
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
