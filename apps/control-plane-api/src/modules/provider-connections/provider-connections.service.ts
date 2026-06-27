import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProviderConnection } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ListProvidersQueryDto,
  ProviderResponseDto,
  UpsertProviderDto,
} from './dto/provider-connection.dto';

@Injectable()
export class ProviderConnectionsService {
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
    value: Record<string, unknown> | undefined,
  ): Prisma.InputJsonObject | undefined {
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

  private toRecordOrNull(value: Prisma.JsonValue): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return null;
  }
}
