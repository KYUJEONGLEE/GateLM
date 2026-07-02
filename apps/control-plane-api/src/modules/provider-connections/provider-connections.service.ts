import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProviderConnection,
  ProviderConnectionStatus,
  ProviderPreset,
  ResourceStatus,
} from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ListProviderPresetsQueryDto,
  ListProvidersQueryDto,
  ProviderModelDiscoveryItemDto,
  ProviderModelDiscoveryResponseDto,
  ProviderPresetResponseDto,
  ProviderResponseDto,
  UpsertProviderDto,
} from './dto/provider-connection.dto';

type ProviderModelsPayload = {
  data?: unknown;
};

type ProviderModelRecord = {
  created?: unknown;
  id?: unknown;
  object?: unknown;
  owned_by?: unknown;
  ownedBy?: unknown;
};

const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
const SAFE_CATALOG_TOKEN_PATTERN = /^[a-z][a-z0-9_:-]{0,79}$/;
const SAFE_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/;
const FORBIDDEN_BASE_URL_QUERY_KEYS = new Set([
  'api_key',
  'api-key',
  'apikey',
  'key',
  'token',
  'access_token',
  'authorization',
]);

@Injectable()
export class ProviderConnectionsService {
  private readonly logger = new Logger(ProviderConnectionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertProvider(
    projectId: string,
    dto: UpsertProviderDto,
  ): Promise<ProviderResponseDto> {
    const project = await this.getProjectOrThrow(projectId);
    const providerConfig = this.toJsonObject(dto.providerConfig);
    const optionalCredentialUpdate = this.toOptionalCredentialUpdate(dto);

    const providerConnection = await this.prisma.providerConnection.upsert({
      where: {
        projectId_provider: {
          projectId,
          provider: dto.provider,
        },
      },
      create: {
        tenantId: project.tenantId,
        projectId: project.id,
        provider: dto.provider,
        displayName: dto.displayName,
        status: dto.status,
        baseUrl: dto.baseUrl,
        timeoutMs: dto.timeoutMs,
        secretRef: dto.secretRef,
        credentialPrefix: dto.credentialPrefix,
        credentialLast4: dto.credentialLast4,
        resolver: dto.resolver,
        providerConfig,
      },
      update: {
        displayName: dto.displayName,
        status: dto.status,
        baseUrl: dto.baseUrl,
        timeoutMs: dto.timeoutMs,
        resolver: dto.resolver,
        providerConfig,
        ...optionalCredentialUpdate,
      },
    });

    return this.toProviderResponse(providerConnection);
  }

  async listProviders(
    projectId: string,
    query: ListProvidersQueryDto,
  ): Promise<ListEnvelope<ProviderResponseDto>> {
    await this.getProjectOrThrow(projectId);

    const limit = query.limit ?? 50;
    const providers = await this.prisma.providerConnection.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = providers.length > limit;
    const page = providers.slice(0, limit);

    return {
      data: page.map((provider) => this.toProviderResponse(provider)),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async listProviderPresets(
    query: ListProviderPresetsQueryDto,
  ): Promise<ListEnvelope<ProviderPresetResponseDto>> {
    const limit = query.limit ?? 50;
    const status = query.status ?? ResourceStatus.ACTIVE;
    const presets = await this.prisma.providerPreset.findMany({
      where: { status },
      orderBy: [{ sortOrder: 'asc' }, { providerKey: 'asc' }],
      take: limit + 1,
    });
    const hasMore = presets.length > limit;
    const page = presets.slice(0, limit);

    return {
      data: page.map((preset) => this.toProviderPresetResponse(preset)),
      pagination: {
        limit,
        nextCursor: null,
        hasMore,
      },
    };
  }

  async discoverProviderModels(
    projectId: string,
    provider: string,
  ): Promise<ProviderModelDiscoveryResponseDto> {
    await this.getProjectOrThrow(projectId);

    const providerKey = this.toProviderKeyOrThrow(provider);
    const providerConnection = await this.prisma.providerConnection.findUnique({
      where: {
        projectId_provider: {
          projectId,
          provider: providerKey,
        },
      },
    });

    if (!providerConnection) {
      throw new NotFoundException('Provider connection not found.');
    }

    if (providerConnection.status === ProviderConnectionStatus.DISABLED) {
      throw new BadRequestException(
        'Provider model discovery requires an enabled provider connection.',
      );
    }

    const adapterType = this.toAdapterType(providerConnection);
    const credentialRequired = this.toCredentialRequired(
      providerConnection,
      adapterType,
    );
    const credential = credentialRequired
      ? this.resolveProviderCredential(providerConnection)
      : null;
    const endpoint = this.toModelsEndpoint(providerConnection.baseUrl);
    const payload = await this.fetchProviderModels({
      credential,
      endpoint,
      timeoutMs: providerConnection.timeoutMs,
    });
    const models = this.toDiscoveryModels(providerConnection, payload);

    return {
      adapterType,
      baseUrl: this.toSafeBaseUrl(providerConnection.baseUrl),
      credentialRequired,
      discoveredAt: new Date().toISOString(),
      modelCount: models.length,
      models,
      provider: providerConnection.provider,
      providerId: providerConnection.id,
    };
  }

  private async getProjectOrThrow(
    projectId: string,
  ): Promise<{ id: string; tenantId: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, tenantId: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private toProviderKeyOrThrow(provider: string): string {
    const value = provider.trim();

    if (!PROVIDER_KEY_PATTERN.test(value)) {
      throw new BadRequestException('Provider key is invalid.');
    }

    return value;
  }

  private toAdapterType(providerConnection: ProviderConnection): string {
    const adapterType = this.toRecordOrNull(providerConnection.providerConfig)
      ?.adapterType;

    if (
      typeof adapterType === 'string' &&
      SAFE_CATALOG_TOKEN_PATTERN.test(adapterType.trim())
    ) {
      return adapterType.trim();
    }

    return providerConnection.provider === 'mock'
      ? 'mock'
      : 'openai_compatible';
  }

  private toCredentialRequired(
    providerConnection: ProviderConnection,
    adapterType: string,
  ): boolean {
    const credentialRequired = this.toRecordOrNull(
      providerConnection.providerConfig,
    )?.credentialRequired;

    if (typeof credentialRequired === 'boolean') {
      return credentialRequired;
    }

    return adapterType !== 'mock';
  }

  private resolveProviderCredential(
    providerConnection: ProviderConnection,
  ): string {
    if (providerConnection.resolver.trim().toLowerCase() !== 'environment') {
      throw new BadRequestException(
        'Provider model discovery supports environment credential references only.',
      );
    }

    const credentialRefs = this.toCredentialRefCandidates(providerConnection);
    const bindings = this.parseCredentialEnvMap(
      process.env.CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP ??
        process.env.GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP ??
        '',
    );

    for (const credentialRef of credentialRefs) {
      const envName = bindings[credentialRef];

      if (!envName) {
        continue;
      }

      const value = process.env[envName]?.trim();

      if (value) {
        return value;
      }
    }

    for (const credentialRef of credentialRefs) {
      if (!SAFE_ENV_NAME_PATTERN.test(credentialRef)) {
        continue;
      }

      const value = process.env[credentialRef]?.trim();

      if (value) {
        return value;
      }
    }

    throw new BadRequestException(
      'Provider credential reference is not bound to an available environment variable.',
    );
  }

  private toCredentialRefCandidates(
    providerConnection: ProviderConnection,
  ): string[] {
    return [
      providerConnection.secretRef,
      `provider_credential:${providerConnection.id}`,
    ].filter((value): value is string => Boolean(value?.trim()));
  }

  private parseCredentialEnvMap(raw: string): Record<string, string> {
    const bindings: Record<string, string> = {};

    for (const entry of raw.split(',')) {
      const [rawCredentialRef, rawEnvName] = entry.split('=', 2);
      const credentialRef = rawCredentialRef?.trim();
      const envName = rawEnvName?.trim();

      if (!credentialRef || !envName || !SAFE_ENV_NAME_PATTERN.test(envName)) {
        continue;
      }

      bindings[credentialRef] = envName;
    }

    return bindings;
  }

  private toModelsEndpoint(baseUrl: string): string {
    const parsedUrl = this.toSafeParsedBaseUrl(baseUrl);
    parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/+$/, '')}/models`;
    parsedUrl.hash = '';

    return parsedUrl.toString();
  }

  private toSafeBaseUrl(baseUrl: string): string {
    return this.toSafeParsedBaseUrl(baseUrl).toString();
  }

  private toSafeParsedBaseUrl(baseUrl: string): URL {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(baseUrl.trim());
    } catch {
      throw new BadRequestException('Provider baseUrl is invalid.');
    }

    if (parsedUrl.username || parsedUrl.password) {
      throw new BadRequestException(
        'Provider baseUrl must not contain credential material.',
      );
    }

    for (const key of parsedUrl.searchParams.keys()) {
      if (FORBIDDEN_BASE_URL_QUERY_KEYS.has(key.toLowerCase())) {
        throw new BadRequestException(
          'Provider baseUrl must not contain credential material.',
        );
      }
    }

    return parsedUrl;
  }

  private async fetchProviderModels({
    credential,
    endpoint,
    timeoutMs,
  }: {
    credential: string | null;
    endpoint: string;
    timeoutMs: number;
  }): Promise<ProviderModelsPayload> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      if (credential) {
        headers.Authorization = `Bearer ${credential}`;
      }

      const response = await fetch(endpoint, {
        headers,
        method: 'GET',
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new BadGatewayException(
          'Provider model discovery failed because the provider credential was rejected.',
        );
      }

      if (!response.ok) {
        throw new BadGatewayException(
          `Provider model discovery failed with upstream HTTP ${response.status}.`,
        );
      }

      const payload: unknown = await response.json().catch(() => {
        throw new BadGatewayException(
          'Provider model discovery response was not valid JSON.',
        );
      });

      if (!payload || typeof payload !== 'object') {
        throw new BadGatewayException(
          'Provider model discovery response did not include a JSON object.',
        );
      }

      return payload as ProviderModelsPayload;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException(
          'Provider model discovery timed out.',
        );
      }

      this.logger.warn(this.toSafeProviderDiscoveryFailureLog(error));
      throw new BadGatewayException('Provider model discovery failed.');
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private toDiscoveryModels(
    providerConnection: ProviderConnection,
    payload: ProviderModelsPayload,
  ): ProviderModelDiscoveryItemDto[] {
    if (!Array.isArray(payload.data)) {
      throw new BadGatewayException(
        'Provider model discovery response did not include a model list.',
      );
    }

    return payload.data
      .map((value) => this.toDiscoveryModel(providerConnection, value))
      .filter((model): model is ProviderModelDiscoveryItemDto => model !== null)
      .sort((left, right) => left.modelName.localeCompare(right.modelName));
  }

  private toDiscoveryModel(
    providerConnection: ProviderConnection,
    value: unknown,
  ): ProviderModelDiscoveryItemDto | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as ProviderModelRecord;

    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      return null;
    }

    const modelName = record.id.trim();

    return {
      createdAt: this.toUnixTimestampIsoString(record.created),
      displayName: modelName,
      modelName,
      object: typeof record.object === 'string' ? record.object : null,
      ownedBy:
        typeof record.owned_by === 'string'
          ? record.owned_by
          : typeof record.ownedBy === 'string'
            ? record.ownedBy
            : null,
      provider: providerConnection.provider,
      providerId: providerConnection.id,
      source: 'provider_models_endpoint',
    };
  }

  private toUnixTimestampIsoString(value: unknown): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    const timestampInMs = value > 9999999999 ? value : value * 1000;
    const date = new Date(timestampInMs);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }

  private toSafeProviderDiscoveryFailureLog(error: unknown): string {
    const errorName = error instanceof Error ? error.name : typeof error;
    const errorCode = this.toSafeErrorCode(error);

    return `Provider model discovery upstream call failed. errorName=${errorName}; errorCode=${errorCode}`;
  }

  private toSafeErrorCode(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return 'unknown';
    }

    const code = (error as { code?: unknown }).code;

    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(code)) {
      return 'unknown';
    }

    return code;
  }

  private toOptionalCredentialUpdate(
    dto: UpsertProviderDto,
  ): Pick<
    Prisma.ProviderConnectionUpdateInput,
    'secretRef' | 'credentialPrefix' | 'credentialLast4'
  > {
    const update: Pick<
      Prisma.ProviderConnectionUpdateInput,
      'secretRef' | 'credentialPrefix' | 'credentialLast4'
    > = {};

    if (dto.secretRef !== undefined) {
      update.secretRef = dto.secretRef;
    }
    if (dto.credentialPrefix !== undefined) {
      update.credentialPrefix = dto.credentialPrefix;
    }
    if (dto.credentialLast4 !== undefined) {
      update.credentialLast4 = dto.credentialLast4;
    }

    return update;
  }

  private toJsonObject(
    value: Record<string, unknown> | null | undefined,
  ): Prisma.InputJsonObject | typeof Prisma.DbNull | undefined {
    if (value === null) {
      return Prisma.DbNull;
    }

    return value as Prisma.InputJsonObject | undefined;
  }

  private toProviderResponse(
    providerConnection: ProviderConnection,
  ): ProviderResponseDto {
    return {
      id: providerConnection.id,
      tenantId: providerConnection.tenantId,
      projectId: providerConnection.projectId,
      provider: providerConnection.provider,
      displayName: providerConnection.displayName,
      status: providerConnection.status,
      baseUrl: providerConnection.baseUrl,
      timeoutMs: providerConnection.timeoutMs,
      resolver: providerConnection.resolver,
      credentialPreview: {
        prefix: providerConnection.credentialPrefix,
        last4: providerConnection.credentialLast4,
      },
      providerConfig: this.toRecordOrNull(providerConnection.providerConfig),
      createdAt: providerConnection.createdAt.toISOString(),
      updatedAt: providerConnection.updatedAt.toISOString(),
    };
  }

  private toProviderPresetResponse(
    providerPreset: ProviderPreset,
  ): ProviderPresetResponseDto {
    return {
      adapterType: providerPreset.adapterType,
      baseUrl: providerPreset.baseUrl,
      credentialRequired: providerPreset.credentialRequired,
      defaultResolver: providerPreset.defaultResolver,
      defaultTimeoutMs: providerPreset.defaultTimeoutMs,
      displayName: providerPreset.displayName,
      modelsEndpointPath: providerPreset.modelsEndpointPath,
      providerConfig: this.toRecordOrNull(providerPreset.providerConfig),
      providerKey: providerPreset.providerKey,
      sortOrder: providerPreset.sortOrder,
      status: providerPreset.status,
      createdAt: providerPreset.createdAt.toISOString(),
      updatedAt: providerPreset.updatedAt.toISOString(),
    };
  }

  private toRecordOrNull(value: Prisma.JsonValue): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return null;
  }
}
